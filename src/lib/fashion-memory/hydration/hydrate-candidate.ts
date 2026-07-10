import {
  getProduct,
  type CatalogMediaItem,
  type CatalogProductDetail,
  type CatalogSearchContext,
} from "@/lib/shopify/catalog";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import { logAiChat } from "@/lib/ai-chat/observability";
import {
  abortSignalWithTimeout,
  type AbortScope,
} from "@/lib/ai-chat/abort-scope";
import {
  resolveDepartmentEvidence,
  resolveSearchDepartment,
} from "../department";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import type { FashionSearchBrief } from "../router/types";
import type { FashionFactRow } from "../types";
import { recipientSizeForGarment } from "../hard-drops/size-match";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import {
  HYDRATION_CALL_TIMEOUT_MS,
  HYDRATION_TIMEOUT_RETRIES,
} from "./config";
import {
  buildSizeSelection,
  isSizeSelectionFallback,
  recipientExcludedByOfferedSizes,
  relaxationOrder,
  sizeOptionAvailability,
} from "./build-size-selection";
import type {
  HydrateCandidateResult,
  HydratedCandidate,
  HydrationDeathRecord,
} from "./types";

export type HydrateCandidateParams = {
  traceId?: string | null;
  slot: FashionSearchPlanSlot;
  product: FashionSlotCatalogProduct;
  brief: FashionSearchBrief;
  recipientFacts: FashionFactRow[];
  accessToken: string;
  context?: CatalogSearchContext;
  abortScope?: AbortScope;
  /** Test injection — defaults to catalog getProduct. */
  getProductFn?: typeof getProduct;
  /** Override per-call timeout (ms) for tests. */
  timeoutMs?: number;
};

function mediaUrl(item: CatalogMediaItem | string | undefined): string | undefined {
  if (!item) return undefined;
  if (typeof item === "string") return item.trim() || undefined;
  return (
    item.url?.trim() ||
    item.src?.trim() ||
    item.href?.trim() ||
    item.preview?.url?.trim() ||
    item.preview?.src?.trim() ||
    undefined
  );
}

function collectMediaUrls(detail: CatalogProductDetail): string[] {
  const urls = new Set<string>();
  for (const item of detail.media ?? []) {
    const url = mediaUrl(item);
    if (url) urls.add(url);
  }
  const featured = mediaUrl(detail.featured_image);
  if (featured) urls.add(featured);
  const image = mediaUrl(detail.image);
  if (image) urls.add(image);
  for (const variant of detail.variants ?? []) {
    for (const item of variant.media ?? []) {
      const url = mediaUrl(item);
      if (url) urls.add(url);
    }
    const vImg = mediaUrl(variant.image);
    if (vImg) urls.add(vImg);
  }
  return [...urls];
}

function resolvedVariant(detail: CatalogProductDetail) {
  return (
    detail.variants?.find((v) => v.checkout_url) ?? detail.variants?.[0]
  );
}

function readNativeCheckoutFlag(
  detail: CatalogProductDetail,
  product: FashionSlotCatalogProduct,
): boolean {
  const variant = resolvedVariant(detail);
  if (variant?.checkout_url) return true;
  if (product.native_checkout === false) return false;
  return Boolean(product.native_checkout);
}

function harvestCandidate(params: {
  product: FashionSlotCatalogProduct;
  detail: CatalogProductDetail;
  sizeStatus: HydratedCandidate["size_status"];
  sizeSelection?: HydratedCandidate["size_selection"];
  hydrationFailed?: boolean;
  nativeCheckout: boolean;
}): HydratedCandidate {
  const variant = resolvedVariant(params.detail);
  const price = variant?.price;
  return {
    ...params.product,
    size_status: params.sizeStatus,
    size_selection: params.sizeSelection,
    hydration_failed: params.hydrationFailed,
    native_checkout: params.nativeCheckout,
    detail: params.detail,
    media_urls: collectMediaUrls(params.detail),
    product_url: params.detail.url,
    variant_url: variant?.url ?? variant?.checkout_url,
    final_price:
      price?.amount != null && price.currency
        ? { amount: price.amount, currency: price.currency }
        : params.product.price,
    option_matrix: params.detail.options?.map((o) => ({
      name: o.name,
      values: o.values.map((v) => ({
        label: v.label,
        available: v.available,
        exists: v.exists,
      })),
    })),
    description_text: params.detail.description?.text,
  };
}

function death(
  productId: string,
  cause: HydrationDeathRecord["cause"],
  evidence: string,
): HydrateCandidateResult {
  return {
    outcome: "death",
    death: { product_id: productId, cause, evidence },
  };
}

/** Last-line check: detail may reveal Target gender absent at search level. */
function departmentDeathFromDetail(
  product: FashionSlotCatalogProduct,
  detail: CatalogProductDetail,
  brief: FashionSearchBrief,
): HydrateCandidateResult | null {
  const department = resolveSearchDepartment({
    knowledgeDepartment: brief.knowledge_state?.department,
    departmentScope: brief.department_scope,
  });
  const evidence = resolveDepartmentEvidence(
    {
      title: detail.title ?? product.title ?? "",
      taxonomyCategory: product.taxonomy_category,
      attributes: extractCatalogAttributes(detail),
      shopGid: product.merchant_id?.startsWith("gid://shopify/Shop/")
        ? product.merchant_id
        : null,
      shopDomain: product.shop_domain,
    },
    department,
  );
  if (evidence.status !== "mismatch") return null;
  return death(
    product.id,
    "department_mismatch",
    `${evidence.source}: ${evidence.evidence}`,
  );
}

function callWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  abortScope?: AbortScope,
): Promise<T> {
  const opSignal = abortScope?.fork();
  const deadline = abortSignalWithTimeout(opSignal, ms);

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("hydration_timeout")), ms);
    fn(deadline)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * get_product with a single retry on timeout. Timeouts under a concurrency
 * stampede are usually transient; a re-attempt after the herd clears recovers
 * the candidate instead of degrading it to a hydration_failed shell. Aborts
 * (user cancellation / global deadline) never retry.
 */
async function callWithTimeoutRetries<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  retries: number,
  abortScope?: AbortScope,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await callWithTimeout(fn, ms, abortScope);
    } catch (err) {
      lastErr = err;
      const timedOut = /hydration_timeout/i.test(String(err));
      const aborted = /abort/i.test(String(err));
      if (!timedOut || aborted || attempt === retries) throw err;
    }
  }
  throw lastErr;
}

export async function hydrateCandidate(
  params: HydrateCandidateParams,
): Promise<HydrateCandidateResult> {
  const recipientSize = recipientSizeForGarment(
    params.recipientFacts,
    params.slot.garment,
  );
  const selection = buildSizeSelection({
    product: params.product,
    garment: params.slot.garment,
    brief: params.brief,
    recipientSize,
  });

  const timeoutMs = params.timeoutMs ?? HYDRATION_CALL_TIMEOUT_MS;
  const started = Date.now();

  try {
    const fetchProduct = params.getProductFn ?? getProduct;
    const { product: detail } = await callWithTimeoutRetries(
      (signal) =>
        fetchProduct(
          params.accessToken,
          params.product.id,
          selection.selected,
          {
            ...(selection.selected.length
              ? { preferences: relaxationOrder(selection.selected) }
              : {}),
            context: params.context,
            signal,
          },
        ),
      timeoutMs,
      HYDRATION_TIMEOUT_RETRIES,
      params.abortScope,
    );

    if (!detail) {
      return death(
        params.product.id,
        "gone",
        "Product not found in catalog (404/removed)",
      );
    }

    const deptDeath = departmentDeathFromDetail(
      params.product,
      detail,
      params.brief,
    );
    if (deptDeath) return deptDeath;

    const nativeCheckout = readNativeCheckoutFlag(detail, params.product);
    const sizeSel = selection.selected.find((o) => /size/i.test(o.name));

    if (selection.hadSizeSelection && sizeSel && recipientSize) {
      const fallback = isSizeSelectionFallback(
        selection.selected,
        detail.selected,
      );
      const avail = sizeOptionAvailability(detail, sizeSel);

      if (!fallback && avail.available === false) {
        return death(
          params.product.id,
          "size_out_of_stock",
          `Size ${sizeSel.label} matched but unavailable at variant level`,
        );
      }

      if (fallback) {
        const sizeOpt = detail.options?.find((o) => /size/i.test(o.name));
        const offeredLabels =
          sizeOpt?.values
            .filter((v) => v.exists !== false)
            .map((v) => v.label) ?? [];
        if (
          recipientExcludedByOfferedSizes({
            product: params.product,
            recipient: recipientSize,
            offeredLabels,
          })
        ) {
          return death(
            params.product.id,
            "size_not_offered",
            `Requested size not offered; offered sizes exclude recipient`,
          );
        }
        const sizeStatus: HydratedCandidate["size_status"] = "unknown";
        return {
          outcome: "verified",
          candidate: harvestCandidate({
            product: params.product,
            detail,
            sizeStatus,
            sizeSelection: {
              merchant_label: sizeSel.label,
              option_name: sizeSel.name,
              converted_from: selection.convertedFrom,
            },
            nativeCheckout,
          }),
        };
      }

      const sizeStatus: HydratedCandidate["size_status"] = selection.convertedFrom
        ? "converted"
        : "confirmed";
      return {
        outcome: "verified",
        candidate: harvestCandidate({
          product: params.product,
          detail,
          sizeStatus,
          sizeSelection: {
            merchant_label: sizeSel.label,
            option_name: sizeSel.name,
            converted_from: selection.convertedFrom,
          },
          nativeCheckout,
        }),
      };
    }

    return {
      outcome: "verified",
      candidate: harvestCandidate({
        product: params.product,
        detail,
        sizeStatus: "unknown",
        nativeCheckout,
      }),
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const errText = String(err);
    const timedOut = /hydration_timeout/i.test(errText);
    const aborted = /abort/i.test(errText);
    logAiChat("warn", "fashion_hydration_failed", {
      traceId: params.traceId,
      productId: params.product.id,
      slot_id: params.slot.slot_id,
      garment: params.slot.garment,
      shop_domain: params.product.shop_domain ?? null,
      error: errText.slice(0, 160),
      timed_out: timedOut,
      aborted,
      elapsed_ms: elapsedMs,
      timeout_ms: timeoutMs,
    });
    // Never admit unhydrated shells as verified — they lack size/media truth.
    return death(
      params.product.id,
      "hydration_failed",
      timedOut
        ? `get_product timed out after ${elapsedMs}ms`
        : aborted
          ? `get_product aborted: ${errText.slice(0, 120)}`
          : `get_product failed: ${errText.slice(0, 120)}`,
    );
  }
}
