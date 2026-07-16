import type { CatalogProductDetail } from "@/lib/shopify/catalog";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import { resolveColorDeterministic } from "../normalize/color";
import {
  classifyOptionName,
  classifyVariantOption,
  garmentToSizeCategory,
} from "../normalize/option-classifier";
import { preNormalize } from "../normalize/pre-normalize";
import type { ColorBucket } from "../normalize/types";
import type { FashionSearchBrief } from "../router/types";

export type ColorSelection = {
  option_name: string;
  merchant_label: string;
};

function findColorOptionName(
  product: Pick<FashionSlotCatalogProduct, "variant_options">,
  detail?: CatalogProductDetail,
): string {
  for (const opt of product.variant_options) {
    if (classifyOptionName(opt.name) === "color") return opt.name;
  }
  for (const opt of detail?.options ?? []) {
    if (classifyOptionName(opt.name) === "color") return opt.name;
  }
  return "Color";
}

function offeredColorOptions(
  product: FashionSlotCatalogProduct,
  garment: string,
): Array<{ name: string; label: string }> {
  const category = garmentToSizeCategory(garment);
  const seen = new Set<string>();
  const out: Array<{ name: string; label: string }> = [];
  for (const opt of product.variant_options) {
    if (classifyVariantOption(opt.name, opt.value, category) !== "color") continue;
    const key = preNormalize(opt.value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: opt.name, label: opt.value });
  }
  return out;
}

function bucketsOverlap(a: ColorBucket[], b: ColorBucket[]): boolean {
  return a.some((bucket) => b.includes(bucket) && bucket !== "unknown");
}

function matchStatedColor(
  statedColor: string,
  offered: Array<{ name: string; label: string }>,
): { name: string; label: string } | null {
  const statedNorm = preNormalize(statedColor);
  for (const option of offered) {
    if (preNormalize(option.label) === statedNorm) return option;
  }

  const statedBuckets = resolveColorDeterministic(statedColor).buckets.filter(
    (bucket) => bucket !== "unknown",
  );
  if (!statedBuckets.length) return null;

  for (const option of offered) {
    const labelBuckets = resolveColorDeterministic(option.label).buckets;
    if (bucketsOverlap(statedBuckets, labelBuckets)) return option;
  }
  return null;
}

function primaryVariantColor(
  product: FashionSlotCatalogProduct,
): ColorSelection | undefined {
  const variant =
    product.raw?.variants?.find((v) => v.checkout_url) ?? product.raw?.variants?.[0];
  const colorOpt = variant?.options?.find(
    (opt) => classifyOptionName(opt.name) === "color",
  );
  if (!colorOpt?.label?.trim()) return undefined;
  return { option_name: colorOpt.name, merchant_label: colorOpt.label };
}

/** Map brief color intent + search hit metadata to a catalog color option. */
export function buildColorSelection(params: {
  product: FashionSlotCatalogProduct;
  garment: string;
  brief: FashionSearchBrief;
  detail?: CatalogProductDetail;
}): ColorSelection | undefined {
  const offered = offeredColorOptions(params.product, params.garment);
  const stated =
    params.brief.color_direction?.stated_colors?.filter((c) => c.trim()) ?? [];

  for (const statedColor of stated) {
    const match = matchStatedColor(statedColor, offered);
    if (match) {
      return { option_name: match.name, merchant_label: match.label };
    }
  }

  if (params.product.matched_by_color_variant) {
    const fromDetail = params.detail?.selected?.find(
      (opt) => classifyOptionName(opt.name) === "color",
    );
    if (fromDetail?.label?.trim()) {
      return { option_name: fromDetail.name, merchant_label: fromDetail.label };
    }
    return primaryVariantColor(params.product);
  }

  return undefined;
}

export function colorSelectionFromDetail(
  detail: CatalogProductDetail,
  requested?: ColorSelection,
): ColorSelection | undefined {
  if (requested?.merchant_label?.trim()) return requested;
  const fromDetail = detail.selected?.find(
    (opt) => classifyOptionName(opt.name) === "color",
  );
  if (!fromDetail?.label?.trim()) return undefined;
  return { option_name: fromDetail.name, merchant_label: fromDetail.label };
}

export function findColorOptionNameForCandidate(
  candidate: Pick<
    FashionSlotCatalogProduct,
    "variant_options" | "raw"
  > & {
    option_matrix?: Array<{ name: string }>;
    color_selection?: ColorSelection;
  },
): string {
  if (candidate.color_selection?.option_name) {
    return candidate.color_selection.option_name;
  }
  for (const opt of candidate.variant_options) {
    if (classifyOptionName(opt.name) === "color") return opt.name;
  }
  for (const opt of candidate.option_matrix ?? []) {
    if (classifyOptionName(opt.name) === "color") return opt.name;
  }
  for (const opt of candidate.raw?.options ?? []) {
    if (classifyOptionName(opt.name) === "color") return opt.name;
  }
  return findColorOptionName(candidate);
}
