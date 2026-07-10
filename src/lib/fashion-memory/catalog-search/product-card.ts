import {
  availabilityFromSearchVariant,
  extractCatalogImageUrl,
  parseCatalogRating,
  searchFeaturedVariantFromProduct,
  type CatalogProductSummary,
} from "@/lib/shopify/catalog";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import type { ProductCard } from "@/lib/ai-chat/types";
import type { FashionSlotCatalogProduct } from "./types";
import type { HydratedCandidate, OverflowItem } from "../hydration/types";

function minimalSlotProductCard(
  p: Pick<
    FashionSlotCatalogProduct,
    "id" | "title" | "image_urls" | "price" | "product_url" | "rating_value" | "review_count" | "rating_scale_max"
  > & {
    media_urls?: string[];
    final_price?: { amount: number; currency: string };
    variant_url?: string;
    size_selection?: HydratedCandidate["size_selection"];
  },
): ProductCard {
  const displayPrice = p.final_price ?? p.price;
  const imageUrl = p.media_urls?.[0] ?? p.image_urls[0];
  const featuredVariant =
    p.variant_url || p.size_selection
      ? {
          id: p.id,
          price: displayPrice,
          checkoutUrl: p.variant_url,
          options: p.size_selection
            ? [
                {
                  name: p.size_selection.option_name,
                  label: p.size_selection.merchant_label,
                },
              ]
            : undefined,
        }
      : undefined;

  return {
    id: p.id,
    title: p.title,
    imageUrl,
    featuredVariant,
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
export function hydratedCandidateToProductCard(p: HydratedCandidate): ProductCard {
  const card = p.raw?.id
    ? fashionSlotProductToProductCard(p)
    : minimalSlotProductCard(p);
  if (p.media_urls[0]) card.imageUrl = p.media_urls[0];
  if (p.final_price) card.displayPrice = p.final_price;
  if (p.detail?.rating) card.rating = p.detail.rating;
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
