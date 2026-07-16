import {
  availabilityFromSearchVariant,
  extractCatalogImageUrl,
  parseCatalogRating,
  searchFeaturedVariantFromProduct,
  type CatalogProductSummary,
  type SelectedOption,
} from "@/lib/shopify/catalog";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import type { ProductCard } from "@/lib/ai-chat/types";
import type { FashionSlotCatalogProduct } from "./types";
import { findColorOptionNameForCandidate } from "../hydration/build-color-selection";
import { classifyOptionName } from "../normalize/option-classifier";
import type { HydratedCandidate, OverflowItem } from "../hydration/types";

export type HydratedProductCardHints = {
  correctedColor?: string;
};

export function preferredOptionsFromHydratedCandidate(
  candidate: HydratedCandidate,
  hints?: HydratedProductCardHints,
): ProductCard["preferredOptions"] {
  const out: NonNullable<ProductCard["preferredOptions"]> = [];
  const seen = new Set<string>();

  const push = (name: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const key = name.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, label: trimmed });
  };

  // Prefer get_product's resolved selection (survives detail slim).
  if (candidate.resolved_options?.length) {
    for (const opt of candidate.resolved_options) {
      if (
        hints?.correctedColor?.trim() &&
        classifyOptionName(opt.name) === "color"
      ) {
        push(opt.name, hints.correctedColor);
      } else {
        push(opt.name, opt.label);
      }
    }
    return out.length ? out : undefined;
  }

  if (candidate.size_selection) {
    push(
      candidate.size_selection.option_name,
      candidate.size_selection.merchant_label,
    );
  }

  if (hints?.correctedColor?.trim()) {
    push(findColorOptionNameForCandidate(candidate), hints.correctedColor);
  } else if (candidate.color_selection) {
    push(
      candidate.color_selection.option_name,
      candidate.color_selection.merchant_label,
    );
  }

  return out.length ? out : undefined;
}

function featuredVariantForPreferred(
  p: Pick<
    HydratedCandidate,
    | "id"
    | "selected_variant_id"
    | "final_price"
    | "price"
    | "variant_url"
  >,
  preferredOptions: SelectedOption[] | undefined,
  existing?: ProductCard["featuredVariant"],
): ProductCard["featuredVariant"] | undefined {
  if (!preferredOptions?.length && !p.variant_url && !existing) return undefined;
  const variantId =
    p.selected_variant_id && p.selected_variant_id !== p.id
      ? p.selected_variant_id
      : existing?.id && existing.id !== p.id
        ? existing.id
        : undefined;
  if (!variantId && !preferredOptions?.length && !p.variant_url) {
    return existing;
  }
  const displayPrice = p.final_price ?? p.price ?? existing?.price;
  return {
    id: variantId ?? existing?.id ?? p.id,
    price: displayPrice,
    checkoutUrl: p.variant_url ?? existing?.checkoutUrl,
    options: preferredOptions ?? existing?.options,
  };
}

function minimalSlotProductCard(
  p: Pick<
    FashionSlotCatalogProduct,
    "id" | "title" | "image_urls" | "price" | "product_url" | "rating_value" | "review_count" | "rating_scale_max"
  > & {
    media_urls?: string[];
    final_price?: { amount: number; currency: string };
    variant_url?: string;
    size_selection?: HydratedCandidate["size_selection"];
    color_selection?: HydratedCandidate["color_selection"];
    resolved_options?: HydratedCandidate["resolved_options"];
    selected_variant_id?: HydratedCandidate["selected_variant_id"];
  },
  hints?: HydratedProductCardHints,
): ProductCard {
  const displayPrice = p.final_price ?? p.price;
  const imageUrl = p.media_urls?.[0] ?? p.image_urls[0];
  const preferredOptions = preferredOptionsFromHydratedCandidate(
    p as HydratedCandidate,
    hints,
  );
  const featuredVariant = featuredVariantForPreferred(
    p,
    preferredOptions,
  );

  return {
    id: p.id,
    title: p.title,
    imageUrl,
    featuredVariant,
    preferredOptions,
    displayPrice: displayPrice
      ? { amount: displayPrice.amount, currency: displayPrice.currency }
      : undefined,
    ...(p.rating_value != null && p.review_count != null
      ? {
          rating: {
            value: p.rating_value,
            count: p.review_count,
            scaleMax: p.rating_scale_max ?? 5,
          },
        }
      : {}),
  };
}

export function catalogSummaryToProductCard(p: CatalogProductSummary): ProductCard {
  if (!p?.id) {
    return { id: "", title: "" };
  }
  const featuredVariant = searchFeaturedVariantFromProduct(p);
  const offerVariant =
    p.variants?.find((v) => featuredVariant?.id && v.id === featuredVariant.id) ??
    p.variants?.[0];
  const displayPrice = featuredVariant?.price ?? offerVariant?.price;
  const catalogAttributes = extractCatalogAttributes(p);
  const rating = parseCatalogRating(p.rating);
  const availability = availabilityFromSearchVariant(offerVariant);

  return {
    id: p.id,
    title: p.title,
    imageUrl: extractCatalogImageUrl(p) ?? undefined,
    featuredVariant,
    displayPrice: displayPrice
      ? { amount: displayPrice.amount, currency: displayPrice.currency }
      : undefined,
    priceRange: p.price_range
      ? {
          min: {
            amount: p.price_range.min.amount,
            currency: p.price_range.min.currency,
          },
          max: {
            amount: p.price_range.max.amount,
            currency: p.price_range.max.currency,
          },
        }
      : undefined,
    options: p.options?.map((opt) => ({
      name: opt.name,
      values: opt.values.slice(0, 8).map((v) => ({ label: v.label })),
    })),
    ...(catalogAttributes.length ? { catalogAttributes } : {}),
    ...(rating ? { rating } : {}),
    ...(availability ? { availability } : {}),
  };
}

/** Post-funnel slot product (scored survivors) → chat card. */
export function fashionSlotProductToProductCard(
  p: FashionSlotCatalogProduct,
): ProductCard {
  if (!p.raw?.id) {
    return minimalSlotProductCard(p);
  }
  const card = catalogSummaryToProductCard(p.raw);
  if (p.image_urls[0]) card.imageUrl = p.image_urls[0];
  if (p.price) card.displayPrice = p.price;
  if (p.rating_value != null && p.review_count != null && !card.rating) {
    card.rating = {
      value: p.rating_value,
      count: p.review_count,
      scaleMax: p.rating_scale_max ?? 5,
    };
  }
  return card;
}

/** Hydrated verified candidate → chat card (prefers live get_product fields). */
export function hydratedCandidateToProductCard(
  p: HydratedCandidate,
  hints?: HydratedProductCardHints,
): ProductCard {
  const card = p.raw?.id
    ? fashionSlotProductToProductCard(p)
    : minimalSlotProductCard(p, hints);
  if (p.media_urls[0]) card.imageUrl = p.media_urls[0];
  if (p.final_price) card.displayPrice = p.final_price;
  if (p.detail?.rating) card.rating = p.detail.rating;
  const preferredOptions = preferredOptionsFromHydratedCandidate(p, hints);
  if (preferredOptions?.length) {
    card.preferredOptions = preferredOptions;
  }
  card.featuredVariant = featuredVariantForPreferred(
    p,
    preferredOptions ?? card.preferredOptions,
    card.featuredVariant,
  );
  if (p.variant_url && card.featuredVariant) {
    card.featuredVariant = { ...card.featuredVariant, checkoutUrl: p.variant_url };
  }
  return card;
}

export function overflowItemToProductCard(item: OverflowItem): ProductCard {
  return {
    id: item.product_id,
    title: item.title,
    imageUrl: item.image_url,
    displayPrice: item.price,
  };
}
