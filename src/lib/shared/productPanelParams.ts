import type { ProductPriceRangeHint } from "@/lib/ai-chat/curation/preferred-options";
import type { ProductCard } from "@/lib/ai-chat/types";
import {
  type SearchFeaturedVariant,
  type SelectedOption,
} from "@/lib/shopify/catalog";
import { variantMatchesPreferredOptions } from "@/lib/shopify/resolve-display-variant";

export type InlineProductState = {
  messageId: string;
  productId: string;
  featuredVariantId?: string;
  fallbackTitle?: string;
  fallbackImageUrl?: string;
  prefilledOptions?: SelectedOption[];
  chatPriceRange?: ProductPriceRangeHint;
};

function resolveFeaturedVariantId(
  preferred: SelectedOption[],
  featuredVariant?: SearchFeaturedVariant,
): string | undefined {
  if (
    featuredVariant?.id &&
    variantMatchesPreferredOptions(featuredVariant, preferred)
  ) {
    return featuredVariant.id;
  }
  return undefined;
}

function resolveChatPriceRange(options: {
  preferredOptions?: SelectedOption[];
  priceRange?: ProductCard["priceRange"];
  featuredVariant?: SearchFeaturedVariant;
  displayPrice?: ProductCard["displayPrice"];
}): ProductPriceRangeHint | undefined {
  const preferred = options.preferredOptions ?? [];
  const resolvedPrice =
    options.displayPrice ??
    (options.featuredVariant?.price &&
    variantMatchesPreferredOptions(options.featuredVariant, preferred)
      ? options.featuredVariant.price
      : undefined);

  if (resolvedPrice?.amount != null && resolvedPrice.currency) {
    return {
      min: { amount: resolvedPrice.amount, currency: resolvedPrice.currency },
      max: { amount: resolvedPrice.amount, currency: resolvedPrice.currency },
    };
  }

  const range = options.priceRange;
  if (range?.min.amount != null && range.min.currency) {
    return {
      min: range.min,
      max:
        range.max.amount != null && range.max.currency === range.min.currency
          ? range.max
          : range.min,
    };
  }

  return undefined;
}

/** Build inline chat expansion state — mirrors `buildProductPageHref` alignment. */
export function buildInlineProductState(
  productId: string,
  options: {
    messageId: string;
    title?: string;
    imageUrl?: string | null;
    preferredOptions?: SelectedOption[];
    priceRange?: ProductCard["priceRange"];
    featuredVariant?: SearchFeaturedVariant;
    displayPrice?: ProductCard["displayPrice"];
  },
): InlineProductState {
  const preferred =
    options.preferredOptions?.length
      ? options.preferredOptions
      : (options.featuredVariant?.options ?? []);
  return {
    messageId: options.messageId,
    productId,
    featuredVariantId: resolveFeaturedVariantId(preferred, options.featuredVariant),
    fallbackTitle: options.title,
    fallbackImageUrl: options.imageUrl ?? undefined,
    prefilledOptions: preferred.length ? preferred : undefined,
    chatPriceRange: resolveChatPriceRange({ ...options, preferredOptions: preferred }),
  };
}
