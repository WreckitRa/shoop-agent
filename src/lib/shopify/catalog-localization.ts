/**
 * Buyer catalog localization for Shopify Global Catalog (UCP).
 *
 * Every search/hydration call sends the same ISO country in two places:
 *   - `filters.ships_to.country` — hard filter (must ship here)
 *   - `catalog.context.address_country` — buyer relevance / pricing context
 *
 * `catalog.context.currency` is always set (profile → country hint → USD).
 *
 * Source (in priority order):
 *   profile.shippingCountry → profile.country → default saved address country.
 */
import { normalizeShopifyCountryInput, shopifyCountryLabel } from "@/lib/cart/countries";
import { COUNTRY_CURRENCY_HINT } from "@/lib/onboarding/form-options";
import type { CatalogSearchContext } from "./catalog";

/** Saved address fields that refine buyer catalog context (region, postal code). */
export type SavedAddressLocaleHint = {
  addressCountry: string;
  addressRegion?: string | null;
  postalCode?: string | null;
};

export type CatalogLocalization = {
  /** Raw value stored on the profile (label or code). */
  profileRaw: string | null;
  /** Normalized ISO-3166-1 alpha-2 sent to Shopify in both fields. */
  countryCode: string | null;
  /** Value for `filters.ships_to.country`. */
  shipsTo: string | null;
  /** Value for `catalog.context.address_country`. */
  addressCountry: string | null;
  /** Human label for the chip (e.g. "Lebanon"). */
  countryLabel: string | null;
  /** ISO 4217 code from profile (may be null until the user sets one). */
  currency: string | null;
};

export function resolveCatalogLocalization(
  shippingCountry?: string | null,
  country?: string | null,
): CatalogLocalization {
  const profileRaw = (shippingCountry ?? country)?.trim() || null;
  if (!profileRaw) {
    return {
      profileRaw: null,
      countryCode: null,
      shipsTo: null,
      addressCountry: null,
      countryLabel: null,
      currency: null,
    };
  }

  const countryCode = normalizeShopifyCountryInput(profileRaw);
  const invalid =
    !countryCode ||
    countryCode === "UNKNOWN__" ||
    countryCode === "ZZ" ||
    countryCode.length !== 2;

  if (invalid) {
    return {
      profileRaw,
      countryCode: null,
      shipsTo: null,
      addressCountry: null,
      countryLabel: profileRaw,
      currency: null,
    };
  }

  return {
    profileRaw,
    countryCode,
    shipsTo: countryCode,
    addressCountry: countryCode,
    countryLabel: shopifyCountryLabel(countryCode),
    currency: null,
  };
}

/** Resolve ISO currency for catalog.context (profile → country hint → USD). */
export function resolveCatalogCurrency(
  profileCurrency?: string | null,
  countryCode?: string | null,
): string {
  const fromProfile = profileCurrency?.trim().toUpperCase().slice(0, 6);
  if (fromProfile) return fromProfile;
  if (countryCode && COUNTRY_CURRENCY_HINT[countryCode]) {
    return COUNTRY_CURRENCY_HINT[countryCode]!;
  }
  return "USD";
}

type ProfileLocaleFields = {
  shippingCountry?: string | null;
  country?: string | null;
  currency?: string | null;
};

/** Fill missing profile ship-to from the user's default saved address. */
export function profileWithAddressFallback(
  profile: ProfileLocaleFields,
  savedAddress?: SavedAddressLocaleHint | null,
): ProfileLocaleFields {
  if (profile.shippingCountry?.trim() || profile.country?.trim()) {
    return profile;
  }
  const code = savedAddress?.addressCountry?.trim();
  if (!code) return profile;
  const label = shopifyCountryLabel(code) ?? code;
  return { ...profile, shippingCountry: label };
}

export function catalogLocalizationFromProfile(
  profile: ProfileLocaleFields,
  savedAddress?: SavedAddressLocaleHint | null,
): CatalogLocalization {
  const merged = profileWithAddressFallback(profile, savedAddress);
  const loc = resolveCatalogLocalization(
    merged.shippingCountry,
    merged.country,
  );
  const currency = merged.currency?.trim().toUpperCase().slice(0, 6) || null;
  return { ...loc, currency };
}

/** Locale fields copied onto a new Conversation from profile + saved address. */
export function localeSnapshotFromProfile(
  profile: ProfileLocaleFields | null | undefined,
  savedAddress?: SavedAddressLocaleHint | null,
): {
  shippingCountry: string | null;
  currency: string | null;
} {
  const loc = catalogLocalizationFromProfile(profile ?? {}, savedAddress);
  const shippingCountry = loc.profileRaw;
  const currency =
    loc.currency ??
    (loc.countryCode ? resolveCatalogCurrency(null, loc.countryCode) : null);
  return { shippingCountry, currency };
}

function enrichCatalogContextWithAddress(
  context: CatalogSearchContext,
  savedAddress?: SavedAddressLocaleHint | null,
): CatalogSearchContext {
  if (!savedAddress) return context;
  const next = { ...context };
  if (!next.address_country && savedAddress.addressCountry?.trim()) {
    const code = normalizeShopifyCountryInput(savedAddress.addressCountry.trim());
    if (code && code.length === 2 && code !== "UNKNOWN__" && code !== "ZZ") {
      next.address_country = code;
    }
  }
  if (!next.address_region && savedAddress.addressRegion?.trim()) {
    next.address_region = savedAddress.addressRegion.trim();
  }
  if (!next.postal_code && savedAddress.postalCode?.trim()) {
    next.postal_code = savedAddress.postalCode.trim();
  }
  return next;
}

/** Per-chat override wins over profile defaults for display + catalog calls. */
export function resolveEffectiveCatalogLocalization(
  profile: {
    shippingCountry?: string | null;
    country?: string | null;
    currency?: string | null;
  },
  conversation?: {
    shippingCountry?: string | null;
    currency?: string | null;
  } | null,
): CatalogLocalization {
  const profileLoc = catalogLocalizationFromProfile(profile);
  const convCountry = conversation?.shippingCountry?.trim() || null;
  const convCurrency = conversation?.currency?.trim().toUpperCase().slice(0, 6) || null;

  if (!convCountry && !convCurrency) {
    return profileLoc;
  }

  const countryLoc = resolveCatalogLocalization(
    convCountry ?? profile.shippingCountry,
    convCountry ? null : profile.country,
  );
  const currency =
    convCurrency ??
    profileLoc.currency ??
    (countryLoc.countryCode
      ? resolveCatalogCurrency(null, countryLoc.countryCode)
      : null);

  return { ...countryLoc, currency };
}

export function buyerCatalogContextFromSources(
  profile: {
    shippingCountry?: string | null;
    country?: string | null;
    currency?: string | null;
    language?: string | null;
  },
  conversation?: {
    shippingCountry?: string | null;
    currency?: string | null;
  } | null,
  savedAddress?: SavedAddressLocaleHint | null,
): {
  shipsToCountry?: string;
  context: CatalogSearchContext;
} {
  const mergedProfile = profileWithAddressFallback(profile, savedAddress);
  const effective = resolveEffectiveCatalogLocalization(mergedProfile, conversation);
  let context: CatalogSearchContext = {
    currency: resolveCatalogCurrency(
      effective.currency,
      effective.countryCode,
    ),
  };
  if (effective.addressCountry) {
    context.address_country = effective.addressCountry;
  }
  if (profile.language?.trim()) {
    context.language = profile.language.trim();
  }
  context = enrichCatalogContextWithAddress(context, savedAddress);
  return {
    shipsToCountry: effective.shipsTo ?? undefined,
    context,
  };
}

/** Server-side helper: same resolver the chat/search pipeline uses. */
export function buyerCatalogLocalizationFromProfile(profile: {
  shippingCountry?: string | null;
  country?: string | null;
  currency?: string | null;
  language?: string | null;
}): {
  shipsToCountry?: string;
  context?: CatalogSearchContext;
} {
  const loc = resolveCatalogLocalization(
    profile.shippingCountry,
    profile.country,
  );
  const context: CatalogSearchContext = {
    currency: resolveCatalogCurrency(profile.currency, loc.countryCode),
  };
  if (loc.addressCountry) context.address_country = loc.addressCountry;
  if (profile.language?.trim()) context.language = profile.language.trim();

  return {
    shipsToCountry: loc.shipsTo ?? undefined,
    context,
  };
}

/** ISO currency for UI formatting from a resolved localization snapshot. */
export function displayCurrencyFromLocalization(
  loc: CatalogLocalization | null | undefined,
): string | null {
  if (!loc) return null;
  return loc.currency ?? resolveCatalogCurrency(null, loc.countryCode);
}

type PriceLike = { amount: number; currency: string };

/** Align card price fields to the buyer currency (amounts unchanged). */
export function alignProductCardCurrency<
  T extends {
    displayPrice?: PriceLike;
    priceRange?: { min: PriceLike; max: PriceLike };
    featuredVariant?: { price?: PriceLike };
  },
>(card: T, buyerCurrency?: string | null): T {
  const currency = buyerCurrency?.trim().toUpperCase();
  if (!currency) return card;
  if (card.displayPrice) {
    card.displayPrice = { ...card.displayPrice, currency };
  }
  if (card.priceRange) {
    card.priceRange = {
      min: { ...card.priceRange.min, currency },
      max: { ...card.priceRange.max, currency },
    };
  }
  if (card.featuredVariant?.price) {
    card.featuredVariant = {
      ...card.featuredVariant,
      price: { ...card.featuredVariant.price, currency },
    };
  }
  return card;
}
