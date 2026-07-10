import {
  extractCatalogImageUrl,
  getProduct,
  summarizePreferredAvailability,
  type CardAvailability,
  type CatalogProductDetail,
  type CatalogProductRating,
  type CatalogSearchContext,
  type CatalogVariantSummary,
  type SearchFeaturedVariant,
  type SelectedOption,
} from "@/lib/shopify/catalog";

export type DisplayPrice = { amount: number; currency: string };

export type ResolveDisplayVariantResult = {
  featuredVariant?: SearchFeaturedVariant;
  displayPrice?: DisplayPrice;
  /** True when every preferred axis matches the resolved variant. */
  confident: boolean;
};

const SEARCH_VARIANT_CAP = 5;
/** Minimum score (of preferred axes) to treat a variant as displayable. */
const MATCH_SCORE_THRESHOLD = 1;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.+/]+/g, " ").trim();
}

function optionLabelsMatch(preferredLabel: string, variantLabel: string): boolean {
  const p = normalize(preferredLabel);
  const v = normalize(variantLabel);
  if (!p || !v) return false;
  if (p === v) return true;
  if (p.length >= 2 && (v.includes(p) || p.includes(v))) return true;
  return false;
}

/** Score how well variant options satisfy preferred selections (higher is better). */
export function scoreVariantAgainstPreferred(
  variantOptions: SelectedOption[],
  preferred: SelectedOption[],
): number {
  if (!preferred.length) return variantOptions.length > 0 ? 1 : 0;
  const variantByName = new Map(
    variantOptions.map((o) => [normalize(o.name), o.label]),
  );
  let score = 0;
  for (const pref of preferred) {
    const key = normalize(pref.name);
    const variantLabel = variantByName.get(key);
    if (variantLabel == null) continue;
    if (optionLabelsMatch(pref.label, variantLabel)) score += 1;
  }
  return score;
}

/** True when resolved variant options align with every preferred axis. */
export function variantMatchesPreferredOptions(
  variant: SearchFeaturedVariant | undefined,
  preferred: SelectedOption[],
): boolean {
  if (!preferred.length) return true;
  if (!variant?.options?.length) return false;
  const score = scoreVariantAgainstPreferred(variant.options, preferred);
  return score >= preferred.length;
}

function variantToFeatured(raw: CatalogVariantSummary): SearchFeaturedVariant {
  const options: SelectedOption[] = [];
  for (const o of raw.options ?? []) {
    if (typeof o.name === "string" && typeof o.label === "string") {
      options.push({ name: o.name, label: o.label });
    }
  }
  return {
    id: raw.id,
    price: raw.price,
    checkoutUrl: raw.checkout_url,
    options: options.length ? options : undefined,
  };
}

function pickBestSearchVariant(
  variants: CatalogVariantSummary[],
  preferred: SelectedOption[],
): { raw: CatalogVariantSummary; score: number } | undefined {
  if (!variants.length) return undefined;

  if (!preferred.length) {
    const raw = variants[0];
    return raw?.id ? { raw, score: 1 } : undefined;
  }

  let best: { raw: CatalogVariantSummary; score: number; index: number } | null =
    null;
  for (let i = 0; i < variants.length; i++) {
    const raw = variants[i];
    if (!raw?.id) continue;
    const opts: SelectedOption[] = (raw.options ?? []).filter(
      (o): o is SelectedOption =>
        typeof o.name === "string" && typeof o.label === "string",
    );
    const score = scoreVariantAgainstPreferred(opts, preferred);
    if (
      !best ||
      score > best.score ||
      (score === best.score && i < best.index)
    ) {
      best = { raw, score, index: i };
    }
  }

  if (!best || best.score < MATCH_SCORE_THRESHOLD) return undefined;
  return { raw: best.raw, score: best.score };
}

/**
 * Pick the search hit variant to display in chat (price, image, PDP link).
 * Uses merged preferredOptions when present; otherwise Shopify's first offer.
 */
export function resolveDisplayVariant(
  searchVariants: CatalogVariantSummary[] | undefined,
  preferredOptions: SelectedOption[],
): ResolveDisplayVariantResult {
  const capped = (searchVariants ?? []).slice(0, SEARCH_VARIANT_CAP);
  const picked = pickBestSearchVariant(capped, preferredOptions);

  if (!picked) {
    return { confident: false };
  }

  const featuredVariant = variantToFeatured(picked.raw);
  const confident =
    !preferredOptions.length ||
    scoreVariantAgainstPreferred(
      featuredVariant.options ?? [],
      preferredOptions,
    ) >= preferredOptions.length;

  const displayPrice = featuredVariant.price
    ? {
        amount: featuredVariant.price.amount,
        currency: featuredVariant.price.currency,
      }
    : undefined;

  return {
    featuredVariant,
    displayPrice: confident ? displayPrice : undefined,
    confident,
  };
}

export function variantImageFromSearch(
  raw: CatalogVariantSummary,
  productImageUrl?: string,
): string | undefined {
  return extractCatalogImageUrl(raw) ?? productImageUrl;
}

export type CardWithVariantFields = {
  featuredVariant?: SearchFeaturedVariant;
  displayPrice?: DisplayPrice;
  imageUrl?: string;
  searchVariants?: CatalogVariantSummary[];
  preferredOptions?: SelectedOption[];
  /** Buyer-aware stock / size / shipping snapshot (set during hydration). */
  availability?: CardAvailability;
  /** Product rating + review count from the catalog (set during hydration). */
  rating?: CatalogProductRating;
};

/** Options that scope the per-card `get_product` verification to the buyer. */
export type HydrateOptions = {
  concurrency?: number;
  productImages?: Map<string, string>;
  /** ISO-3166-1 alpha-2 — verifies the product ships to the buyer. */
  shipsToCountry?: string;
  /** Buyer localization context (currency, language, country). */
  buyerContext?: CatalogSearchContext;
  /**
   * When true, hydrate EVERY passed card (not only sized ones) to capture
   * rating + availability. Used off the critical path (curator) so non-sized
   * featured picks also carry real review/stock signals.
   */
  forceAll?: boolean;
};

/** Apply resolver output onto a product card after preferredOptions are merged. */
export function applyResolvedVariantToCard<
  T extends CardWithVariantFields,
>(card: T, productImageUrl?: string): T {
  const resolved = resolveDisplayVariant(
    card.searchVariants,
    card.preferredOptions ?? [],
  );
  if (resolved.featuredVariant) {
    card.featuredVariant = resolved.featuredVariant;
  } else if (!card.preferredOptions?.length) {
    /* keep normalize-time featuredVariant */
  } else {
    card.featuredVariant = undefined;
  }

  if (resolved.displayPrice) {
    card.displayPrice = resolved.displayPrice;
  } else {
    card.displayPrice = undefined;
  }

  const rawMatch = card.searchVariants?.find(
    (v) => v.id === card.featuredVariant?.id,
  );
  if (rawMatch) {
    const url = variantImageFromSearch(rawMatch, productImageUrl);
    if (url) card.imageUrl = url;
  }

  return card;
}

function featuredFromProductDetail(
  product: CatalogProductDetail,
): SearchFeaturedVariant | undefined {
  const raw = product.variants?.[0];
  if (!raw?.id) return undefined;
  const options =
    product.selected?.length
      ? product.selected
      : raw.options?.filter(
          (o): o is SelectedOption =>
            typeof o.name === "string" && typeof o.label === "string",
        );
  return {
    id: raw.id,
    price: raw.price,
    checkoutUrl: raw.checkout_url,
    options: options?.length ? options : undefined,
  };
}

async function hydrateOneCard<
  T extends CardWithVariantFields & { id: string },
>(
  card: T,
  accessToken: string,
  productImageUrl?: string,
  options?: Pick<HydrateOptions, "shipsToCountry" | "buyerContext">,
): Promise<void> {
  const preferred = card.preferredOptions ?? [];

  try {
    // Scope the lookup to the buyer: only sale-ready variants, shipping to
    // their country, and relax the LEAST important axis last (color before
    // size) when an exact match is gone. This is what makes the resolved
    // variant — and the availability snapshot below — trustworthy.
    const { product } = await getProduct(accessToken, card.id, preferred, {
      ...(preferred.length ? { preferences: relaxationOrder(preferred) } : {}),
      filters: {
        available: true,
        ...(options?.shipsToCountry
          ? { ships_to: { country: options.shipsToCountry } }
          : {}),
      },
      context: options?.buyerContext,
    });
    if (!product) return;

    // Variant resolution only matters when the buyer expressed preferences.
    if (preferred.length) {
      const featured = featuredFromProductDetail(product);
      if (featured) {
        card.featuredVariant = featured;
        if (featured.price) {
          card.displayPrice = {
            amount: featured.price.amount,
            currency: featured.price.currency,
          };
        }
      }
    }

    card.availability = summarizePreferredAvailability(
      product,
      preferred,
      options?.shipsToCountry ? true : null,
    );

    if (product.rating) card.rating = product.rating;

    const variantRaw = product.variants?.[0];
    const url =
      (variantRaw && extractCatalogImageUrl(variantRaw)) ||
      extractCatalogImageUrl(product) ||
      productImageUrl;
    if (url) card.imageUrl = url;
  } catch {
    /* caller logs */
  }
}

/**
 * Relaxation priority for `get_product.preferences`: the catalog drops options
 * from the END of this list first when an exact variant is unavailable. We
 * keep size as the LAST thing dropped (most important to the buyer) and let
 * color/material/finish relax first.
 */
function relaxationOrder(preferred: SelectedOption[]): string[] {
  const sizeish = (name: string) => /size|fit|waist|inseam|length|ring/i.test(name);
  const sized = preferred.filter((o) => sizeish(o.name)).map((o) => o.name);
  const rest = preferred.filter((o) => !sizeish(o.name)).map((o) => o.name);
  // preferences drops from the end → put size last so it survives longest.
  return [...rest, ...sized];
}

/** Bounded `get_product` hydration for chat cards (variant image + exact price + stock). */
export async function hydrateProductCardsFromCatalog<
  T extends CardWithVariantFields & { id: string },
>(cards: T[], accessToken: string, options?: HydrateOptions): Promise<void> {
  const concurrency = Math.max(1, options?.concurrency ?? 3);
  const targets = options?.forceAll
    ? cards
    : cards.filter((c) => (c.preferredOptions?.length ?? 0) > 0);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < targets.length) {
      const i = index++;
      const card = targets[i];
      const fallbackImage = options?.productImages?.get(card.id);
      await hydrateOneCard(card, accessToken, fallbackImage, {
        shipsToCountry: options?.shipsToCountry,
        buyerContext: options?.buyerContext,
      });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () =>
      worker(),
    ),
  );
}

/** Remove server-only search variant list before SSE / persistence. */
export function stripSearchVariantsForClient<T extends CardWithVariantFields>(
  card: T,
): Omit<T, "searchVariants"> {
  const { searchVariants: _sv, ...rest } = card;
  return rest;
}
