/**
 * Builds a compact, imperative `<search_query_profile>` block that is injected
 * directly adjacent to the search tool description in the system prompt.
 *
 * Unlike the full `<user_shopping_context>` XML (which is rich and descriptive),
 * this block is written in COMMAND form so the model is forced to embed the
 * user's stored attributes into every catalog query rather than merely observing
 * them. It also surfaces active shopping intents as automatic `intent` field
 * candidates (W8).
 *
 * Keeps its own targeted DB queries to avoid coupling to the larger
 * `buildShoppingMemoryPromptXml` pipeline.
 */

import { prisma } from "../db";
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

/** Returned alongside the XML for callers that need the raw active intents. */
export type SearchQueryHints = {
  /** Ready-to-inject XML block (empty string if the user has no stored data). */
  xml: string;
  /**
   * Active intents ordered by priority. The first one whose category overlaps
   * the current query is the best candidate for the `intent` field of
   * `search_shopify_catalog`.
   */
  activeIntents: Array<{
    intentName: string;
    category: string | null;
    constraints: unknown;
    priority: "low" | "medium" | "high";
  }>;
};

export async function buildSearchQueryHints(
  userId: string,
  queryHint: string,
): Promise<SearchQueryHints> {
  const detectedCategories = detectShoppingCategoryFromQuery(queryHint.trim());

  const [profile, sizing, budgetPrefs, brandPrefs, hardNegatives, intents] =
    await Promise.all([
      prisma.userProfile.findUnique({
        where: { userId },
        select: {
          shippingCountry: true,
          country: true,
          currency: true,
          language: true,
          genderPresentation: true,
        },
      }),
      prisma.sizingProfile.findUnique({
        where: { userId },
        select: {
          shoeEU: true,
          shoeUS: true,
          shoeWidth: true,
          topUsualSize: true,
          topPreferredFit: true,
          bottomUsualSize: true,
          bottomWaist: true,
          bottomInseam: true,
          ringSize: true,
        },
      }),
      prisma.categoryPreference.findMany({
        where: detectedCategories.length
          ? { userId, category: { in: detectedCategories } }
          : { userId },
        select: {
          category: true,
          budgetMin: true,
          budgetMax: true,
          budgetTypical: true,
          currency: true,
        },
        orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
        take: 4,
      }),
      prisma.brandPreference.findMany({
        where: detectedCategories.length
          ? {
              userId,
              sentiment: { in: ["love", "hate", "avoid"] },
              OR: [
                { category: { in: detectedCategories } },
                { category: "" },
              ],
            }
          : { userId, sentiment: { in: ["love", "hate", "avoid"] } },
        select: { brand: true, sentiment: true, category: true },
        orderBy: [{ strength: "desc" }],
        take: 16,
      }),
      prisma.hardNegative.findMany({
        where: detectedCategories.length
          ? {
              userId,
              OR: [
                { category: { in: detectedCategories } },
                { category: "" },
              ],
            }
          : { userId },
        select: { scope: true, value: true, category: true },
        orderBy: [{ createdAt: "desc" }],
        take: 16,
      }),
      prisma.shoppingIntent.findMany({
        where: { userId, status: "active", priority: { in: ["high", "medium"] } },
        select: {
          intentName: true,
          category: true,
          constraints: true,
          priority: true,
        },
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
        take: 4,
      }),
    ]);

  const lines: string[] = [];

  // ── Sizing ────────────────────────────────────────────────────────────────
  const sizeParts: string[] = [];
  if (sizing) {
    if (sizing.shoeEU != null)
      sizeParts.push(`shoes EU ${sizing.shoeEU}${sizing.shoeWidth ? ` width ${sizing.shoeWidth}` : ""}`);
    else if (sizing.shoeUS != null)
      sizeParts.push(`shoes US ${sizing.shoeUS}${sizing.shoeWidth ? ` width ${sizing.shoeWidth}` : ""}`);
    if (sizing.topUsualSize)
      sizeParts.push(`tops ${sizing.topUsualSize}${sizing.topPreferredFit ? ` (${sizing.topPreferredFit} fit)` : ""}`);
    if (sizing.bottomUsualSize)
      sizeParts.push(`bottoms ${sizing.bottomUsualSize}`);
    else if (sizing.bottomWaist || sizing.bottomInseam)
      sizeParts.push(`bottoms W${sizing.bottomWaist ?? "?"}${sizing.bottomInseam ? ` L${sizing.bottomInseam}` : ""}`);
    if (sizing.ringSize) sizeParts.push(`ring ${sizing.ringSize}`);
  }
  if (sizeParts.length) {
    lines.push(
      `SIZING (auto-apply into variant_constraints.size for the buyer's OWN matching-category searches, and say so briefly e.g. "size M, as usual"): ${sizeParts.join(" · ")}`,
    );
  }

  // ── Shipping / location ───────────────────────────────────────────────────
  const shipsToLoc = resolveCatalogLocalization(
    profile?.shippingCountry,
    profile?.country,
  );
  if (shipsToLoc.shipsTo) {
    lines.push(
      `SHIPS_TO: set ships_to_country="${shipsToLoc.shipsTo}" unless the user specifies otherwise`,
    );
  }

  // ── Gender scope (self requests only) ────────────────────────────────────
  if (profile?.genderPresentation) {
    lines.push(
      `GENDER SCOPE (set gender_scope for the buyer's OWN searches — NEVER for gifts to someone else): presents as "${profile.genderPresentation}"`,
    );
  }

  // ── Budget defaults per category ──────────────────────────────────────────
  const budgetLines = budgetPrefs
    .filter((b) => b.budgetMax != null || b.budgetTypical != null)
    .map((b) => {
      const cur = b.currency ?? profile?.currency ?? "";
      const parts: string[] = [];
      if (b.budgetMin != null) parts.push(`min ${b.budgetMin}`);
      if (b.budgetMax != null) parts.push(`max ${b.budgetMax}`);
      if (b.budgetTypical != null) parts.push(`typical ${b.budgetTypical}`);
      return `${b.category}: ${parts.join("/")}${cur ? ` ${cur}` : ""}`;
    });
  if (budgetLines.length) {
    lines.push(`BUDGET DEFAULTS: ${budgetLines.join(" · ")}`);
  }

  // ── Brand loves / avoids ──────────────────────────────────────────────────
  const brandLoves = brandPrefs
    .filter((b) => b.sentiment === "love")
    .map((b) => b.brand);
  const brandAvoids = brandPrefs
    .filter((b) => b.sentiment === "hate" || b.sentiment === "avoid")
    .map((b) => b.brand);
  if (brandLoves.length) {
    lines.push(
      `BRAND LOVES (bias toward these when relevant): ${brandLoves.slice(0, 8).join(", ")}`,
    );
  }
  if (brandAvoids.length) {
    lines.push(
      `BRAND NEVER (never recommend, exclude from queries): ${brandAvoids.slice(0, 8).join(", ")}`,
    );
  }

  // ── Hard negatives ────────────────────────────────────────────────────────
  const hardLines = hardNegatives.map((h) => {
    const cat = h.category ? ` in ${h.category}` : "";
    return `${h.scope}="${h.value}"${cat}`;
  });
  if (hardLines.length) {
    lines.push(
      `HARD AVOIDS (add NOT <value> to queries when relevant, never recommend): ${hardLines.slice(0, 10).join("; ")}`,
    );
  }

  // ── Active intents (W8) ───────────────────────────────────────────────────
  if (intents.length) {
    const intentLines = intents.map((i) => {
      const cs = (i.constraints ?? {}) as Record<string, unknown>;
      const bits = Object.entries(cs)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .slice(0, 4);
      return `${i.intentName}${i.category ? ` [${i.category}]` : ""}${bits.length ? ` (${bits.join(", ")})` : ""}`;
    });
    lines.push(
      `ACTIVE INTENTS (use as intent= field when category matches the current search): ${intentLines.join(" | ")}`,
    );
  }

  if (lines.length === 0) {
    return { xml: "", activeIntents: intents };
  }

  const xml =
    `<search_query_profile>\n` +
    `You MUST embed the applicable attributes below into every search_shopify_catalog call. ` +
    `Do not make the user repeat information that is already known. ` +
    `Map stored SIZING into the tool's variant_constraints (size/color), NOT into the query text. ` +
    `When shopping for a known recipient, set recipient={kind:"other", label, known_interests} from memory and do NOT apply the buyer's own sizing or gender scope.\n` +
    lines.join("\n") +
    `\n</search_query_profile>`;

  return { xml, activeIntents: intents };
}

/**
 * Returns the set of clarification question IDs whose answers are already
 * reliably stored in the user's shopping memory, so the clarification tool
 * can suppress them (W7).
 *
 * Convention: question IDs that match a key here are skipped; the known
 * value is injected into the search query automatically via the search
 * profile hints above.
 */
export async function getKnownClarificationAttributes(
  userId: string,
): Promise<Set<string>> {
  const known = new Set<string>();

  const [profile, sizing, brandLoves, savedAddress] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: { shippingCountry: true, country: true, currency: true },
    }),
    prisma.sizingProfile.findUnique({
      where: { userId },
      select: {
        shoeEU: true,
        shoeUS: true,
        topUsualSize: true,
        bottomUsualSize: true,
        bottomWaist: true,
      },
    }),
    prisma.brandPreference.findFirst({
      where: { userId, sentiment: "love" },
      select: { id: true },
    }),
    loadDefaultSavedAddressLocale(userId),
  ]);

  // Ship-to / country questions
  if (
    profile?.shippingCountry ||
    profile?.country ||
    savedAddress?.addressCountry
  ) {
    known.add("country");
    known.add("location");
    known.add("shipping_country");
    known.add("ships_to");
    known.add("ship_to");
  }

  // Currency / budget questions (if currency is known, budget slider bounds apply)
  if (profile?.currency) {
    known.add("currency");
  }

  // Shoe size
  if (sizing?.shoeEU != null || sizing?.shoeUS != null) {
    known.add("shoe_size");
    known.add("size_shoes");
    known.add("footwear_size");
  }

  // Top / clothing size
  if (sizing?.topUsualSize) {
    known.add("size");
    known.add("clothing_size");
    known.add("top_size");
    known.add("shirt_size");
  }

  // Bottom size
  if (sizing?.bottomUsualSize || sizing?.bottomWaist) {
    known.add("bottom_size");
    known.add("pants_size");
    known.add("jeans_size");
  }

  if (brandLoves) {
    for (const id of [
      "brands",
      "brand",
      "brand_preference",
      "brand_preferences",
      "preferred_brands",
      "favorite_brands",
    ]) {
      known.add(id);
    }
  }

  return known;
}
