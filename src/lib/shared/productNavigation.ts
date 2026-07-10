import {
  productPagePath,
  type SearchFeaturedVariant,
  type SelectedOption,
} from "@/lib/shopify/catalog";
import { variantMatchesPreferredOptions } from "@/lib/shopify/resolve-display-variant";
import { resolveProductBackHref } from "@/lib/shared/chatFocus";

export { resolveProductBackHref };

export function buildProductPageHref(
  productId: string,
  options?: {
    from?: string;
    preferredOptions?: SelectedOption[];
    /** Chat card price range (minor units) — used to align PDP variant with displayed price. */
    priceRange?: {
      min: { amount: number; currency: string };
      max: { amount: number; currency: string };
    };
    /** Featured offer from search — PDP variant id only when aligned with opts. */
    featuredVariant?: SearchFeaturedVariant;
    /** Resolved single price from chat (minor units). */
    displayPrice?: { amount: number; currency: string };
  },
): string {
  const params = new URLSearchParams();
  if (options?.from) params.set("from", options.from);
  const preferred = options?.preferredOptions ?? [];
  const fv = options?.featuredVariant;
  if (
    fv?.id &&
    variantMatchesPreferredOptions(fv, preferred)
  ) {
    params.set("variantId", encodeURIComponent(fv.id));
  }
  if (preferred.length) {
    try {
      params.set("opts", JSON.stringify(preferred));
    } catch {
      /* ignore */
    }
  }
  const resolvedPrice =
    options?.displayPrice ??
    (fv?.price && variantMatchesPreferredOptions(fv, preferred)
      ? fv.price
      : undefined);
  const range = options?.priceRange;
  if (resolvedPrice?.amount != null && resolvedPrice.currency) {
    params.set("priceMin", String(resolvedPrice.amount));
    params.set("currency", resolvedPrice.currency);
  } else if (range?.min.amount != null && range.min.currency) {
    params.set("priceMin", String(range.min.amount));
    params.set("currency", range.min.currency);
    if (
      range.max.amount != null &&
      range.max.currency === range.min.currency &&
      range.max.amount !== range.min.amount
    ) {
      params.set("priceMax", String(range.max.amount));
    }
  }
  const qs = params.toString();
  return qs ? `${productPagePath(productId)}?${qs}` : productPagePath(productId);
}
