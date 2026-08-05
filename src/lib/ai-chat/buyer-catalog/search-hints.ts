/**
 * Builds a compact, imperative `<search_query_profile>` block that is injected
 * directly adjacent to the search tool description in the system prompt.
 *
 * Compact buyer localization + avoid-terms for catalog / fashion search.
 * Keeps its own targeted Prisma profile queries.
 */

import { prisma } from "@/lib/ai-chat/db";
import {
  buyerCatalogContextFromSources,
  resolveCatalogLocalization,
} from "@/lib/shopify/catalog-localization";
import { loadDefaultSavedAddressLocale } from "@/lib/shopify/default-saved-address";
import type { CatalogSearchContext } from "@/lib/shopify/catalog";
import { detectShoppingCategoryFromQuery } from "./category-detector";

/** Resolved buyer localization + shipping destination for catalog calls. */
export type BuyerCatalogContext = {
  /** ISO-3166-1 alpha-2 the buyer ships to (shippingCountry ?? country). */
  shipsToCountry?: string;
  /** Localization context (country, currency, language) for catalog relevance. */
  context?: CatalogSearchContext;
  /** Brand names + free-text terms the buyer never wants recommended. */
  avoidTerms: string[];
};

/**
 * Single source of truth for "where does this buyer ship and in what
 * currency/language", plus their hard avoid terms. Loaded once per turn and
 * applied server-side so search + hydration always honor it regardless of
 * what the model remembers to pass.
 */
export async function loadBuyerCatalogContext(
  userId: string,
  queryHint: string,
  conversationId?: string | null,
): Promise<BuyerCatalogContext> {
  if (!userId) return { avoidTerms: [] };
  try {
    const detectedCategories = detectShoppingCategoryFromQuery(
      queryHint.trim(),
    );
    const [profile, brandPrefs, hardNegatives, conversation, savedAddress] =
      await Promise.all([
      prisma.userProfile.findUnique({
        where: { userId },
        select: {
          shippingCountry: true,
          country: true,
          currency: true,
          language: true,
        },
      }),
      prisma.brandPreference.findMany({
        where: { userId, sentiment: { in: ["hate", "avoid"] } },
        select: { brand: true },
        take: 32,
      }),
      prisma.hardNegative.findMany({
        where: detectedCategories.length
          ? { userId, OR: [{ category: { in: detectedCategories } }, { category: "" }] }
          : { userId },
        select: { scope: true, value: true },
        take: 32,
      }),
      conversationId
        ? prisma.conversation.findFirst({
            where: { id: conversationId, userId },
            select: { shippingCountry: true, currency: true },
          })
        : Promise.resolve(null),
      loadDefaultSavedAddressLocale(userId),
    ]);

    const { shipsToCountry, context } = buyerCatalogContextFromSources(
      profile ?? {},
      conversation,
      savedAddress,
    );

    const avoidTerms = new Set<string>();
    for (const b of brandPrefs) {
      if (b.brand?.trim()) avoidTerms.add(b.brand.trim());
    }
    // Brand / material / color hard negatives are the ones that map to a
    // product title or text match; other scopes stay prompt-only.
    for (const h of hardNegatives) {
      if (
        ["brand", "material", "color", "colour", "feature"].includes(
          h.scope.toLowerCase(),
        ) &&
        h.value?.trim()
      ) {
        avoidTerms.add(h.value.trim());
      }
    }

    return {
      shipsToCountry,
      context,
      avoidTerms: [...avoidTerms],
    };
  } catch {
    return { avoidTerms: [] };
  }
}
