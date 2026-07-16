import {
  getProduct,
  type CatalogMediaItem,
  type CatalogProductDetail,
  type CatalogSearchContext,
  type SelectedOption,
} from "@/lib/shopify/catalog";
import { resolveGetProduct } from "@/lib/shopify/catalog-client-override";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import { logAiChat } from "@/lib/ai-chat/observability";
import { consumeQaFault } from "@/lib/qa/faults";
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
import { isTransientMcpError } from "@/lib/shopify/mcp-retry";
import {
  HYDRATION_CALL_TIMEOUT_MS,
  HYDRATION_TIMEOUT_RETRIES,
  HYDRATION_TRANSIENT_RETRIES,
} from "./config";
import type { ConcurrencyGate } from "./concurrency-gate";
import {
  buildSizeSelection,
  isSizeSelectionFallback,
  recipientExcludedByOfferedSizes,
  relaxationOrder,
  sizeOptionAvailability,
} from "./build-size-selection";
import {
  buildColorSelection,
  colorSelectionFromDetail,
} from "./build-color-selection";
import type {
  HydrateCandidateResult,
  HydratedCandidate,
  HydrationDeathRecord,
} from "./types";
import { classifyOptionName } from "../normalize/option-classifier";

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
  /** Override per-call timeout (ms) for tests. `null` disables the timeout. */
  timeoutMs?: number | null;
  /** Request-scoped cap shared across slots — wraps the get_product call. */
  concurrencyGate?: ConcurrencyGate;
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

function sizeSelectionFromDetail(
  detail: CatalogProductDetail,
  requested?: HydratedCandidate["size_selection"],
): HydratedCandidate["size_selection"] | undefined {
  if (requested?.merchant_label?.trim()) return requested;
  const fromDetail = detail.selected?.find(
    (opt) => classifyOptionName(opt.name) === "size",
  );
  if (!fromDetail?.label?.trim()) return undefined;
  return { option_name: fromDetail.name, merchant_label: fromDetail.label };
}

function resolvedOptionsFromDetail(
  detail: CatalogProductDetail,
): SelectedOption[] | undefined {
  const opts = (detail.selected ?? [])
    .map((o) => ({
      name: o.name?.trim() ?? "",
      label: o.label?.trim() ?? "",
    }))
    .filter((o) => o.name && o.label);
  return opts.length ? opts : undefined;
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
  colorSelection?: HydratedCandidate["color_selection"];
  hydrationFailed?: boolean;
  nativeCheckout: boolean;
}): HydratedCandidate {
  const variant = resolvedVariant(params.detail);
  const price = variant?.price;
  const resolvedOptions = resolvedOptionsFromDetail(params.detail);
  return {
    ...params.product,
    hydrated_at: new Date().toISOString(),
    size_status: params.sizeStatus,
    size_selection: sizeSelectionFromDetail(
      params.detail,
      params.sizeSelection,
    ),
    color_selection: colorSelectionFromDetail(
      params.detail,
      params.colorSelection,
    ),
    resolved_options: resolvedOptions,
    selected_variant_id: variant?.id,
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

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return /abort/i.test(String(err));
}

/** Catalog / network blips worth retrying — not permanent product deaths. */
function isTransientHydrationError(err: unknown): boolean {
  if (isAbortError(err)) return false;
  if (isTransientMcpError(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  if (/hydration_timeout/i.test(msg)) return true;
  if (/fetch failed|network|econnreset|etimedout|econnrefused|socket/i.test(msg)) {
    return true;
  }
  if (/und_err|other side closed|socket hang up/i.test(msg)) return true;
  if (/\b(429|502|503|504)\b/.test(msg)) return true;
  return false;
}

function callWithTimeout<T>(
  fn: (signal: AbortSignal | undefined) => Promise<T>,
  ms: number | null,
  abortScope?: AbortScope,
): Promise<T> {
  const opSignal = abortScope?.fork();
  if (ms == null || ms <= 0) {
    return fn(opSignal);
  }

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
 * get_product with optional per-call timeout + retries for timeouts / transient
 * catalog blips. Parent abort is never retried.
 */
async function callWithTimeoutRetries<T>(
  fn: (signal: AbortSignal | undefined) => Promise<T>,
  ms: number | null,
  retries: number,
  abortScope?: AbortScope,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await callWithTimeout(fn, ms, abortScope);
    } catch (err) {
      lastErr = err;
      if (isAbortError(err) || !isTransientHydrationError(err) || attempt === retries) {
        throw err;
      }
      const backoffMs = Math.min(250 * 2 ** attempt + Math.random() * 100, 2_000);
      logAiChat("info", "fashion_hydration_retry", {
        attempt: attempt + 1,
        retries,
        backoff_ms: Math.round(backoffMs),
        error: String(err).slice(0, 120),
        timeout_ms: ms,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
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
  const colorSelection = buildColorSelection({
    product: params.product,
    garment: params.slot.garment,
    brief: params.brief,
  });
  const selectedForGetProduct = [...selection.selected];
  if (colorSelection) {
    const colorKey = colorSelection.option_name.trim().toLowerCase();
    if (
      !selectedForGetProduct.some(
        (opt) => opt.name.trim().toLowerCase() === colorKey,
      )
    ) {
      selectedForGetProduct.push({
        name: colorSelection.option_name,
        label: colorSelection.merchant_label,
      });
    }
  }

  const timeoutMs =
    params.timeoutMs !== undefined
      ? params.timeoutMs
      : HYDRATION_CALL_TIMEOUT_MS;
  const started = Date.now();

  if (
    consumeQaFault(null, "kill_next_hydration", params.traceId, {
      product_id: params.product.id,
      slot_id: params.slot.slot_id,
    })
  ) {
    return death(
      params.product.id,
      "size_out_of_stock",
      "QA fault: selected variant unavailable at get_product",
    );
  }

  try {
    const fetchProduct = params.getProductFn ?? resolveGetProduct();
    const retries =
      timeoutMs != null && timeoutMs > 0
        ? Math.max(HYDRATION_TIMEOUT_RETRIES, HYDRATION_TRANSIENT_RETRIES)
        : HYDRATION_TRANSIENT_RETRIES;
    const runGet = () =>
      callWithTimeoutRetries(
        (signal) =>
          fetchProduct(
            params.accessToken,
            params.product.id,
            selectedForGetProduct,
            {
              ...(selectedForGetProduct.length
                ? { preferences: relaxationOrder(selectedForGetProduct) }
                : {}),
              context: params.context,
              signal,
            },
          ),
        timeoutMs,
        retries,
        params.abortScope,
      );
    const { product: detail } = params.concurrencyGate
      ? await params.concurrencyGate.run(runGet)
      : await runGet();

    const elapsedMs = Date.now() - started;
    logAiChat("info", "fashion_hydration_get_product", {
      traceId: params.traceId,
      productId: params.product.id,
      slot_id: params.slot.slot_id,
      garment: params.slot.garment,
      shop_domain: params.product.shop_domain ?? null,
      ok: Boolean(detail),
      elapsed_ms: elapsedMs,
      timeout_ms: timeoutMs,
      timeout_enabled: timeoutMs != null && timeoutMs > 0,
    });

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
            colorSelection,
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
          colorSelection,
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
        colorSelection,
        nativeCheckout,
      }),
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const errText = String(err);
    const timedOut = /hydration_timeout/i.test(errText);
    const aborted = isAbortError(err);
    logAiChat("warn", "fashion_hydration_failed", {
      traceId: params.traceId,
      productId: params.product.id,
      slot_id: params.slot.slot_id,
      garment: params.slot.garment,
      shop_domain: params.product.shop_domain ?? null,
      error: errText.slice(0, 160),
      timed_out: timedOut,
      aborted,
      transient: isTransientHydrationError(err),
      elapsed_ms: elapsedMs,
      timeout_ms: timeoutMs,
      timeout_enabled: timeoutMs != null && timeoutMs > 0,
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
