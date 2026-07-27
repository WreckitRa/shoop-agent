import { createLightweightMessage } from "@/lib/ai-chat/anthropic";
import { AI_CHAT_LIGHTWEIGHT_MODEL } from "@/lib/ai-chat/constants";
import { logAiChat } from "@/lib/ai-chat/observability";
import { stripJsonFence } from "@/lib/ai-chat/shopping-memory/llm-json";
import {
  extractCatalogImageUrl,
  searchCatalog,
  type CatalogProductSummary,
  type CatalogSearchContext,
  type CatalogSearchFilters,
} from "@/lib/shopify/catalog";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import {
  CURATED_SHOP_IDS,
  isCuratedShopAllowlistEnabled,
} from "@/lib/shopify/curated-shop-ids";
import { mapWithConcurrency } from "@/lib/onboarding/taste-catalog";

export type OutfitGridMode = "worn" | "aspirational";

export type OutfitDeckContext = {
  mode: OutfitGridMode;
  genderPresentation?: string;
  styleEra?: string;
  lifestyleTags?: string[];
  valuePhilosophy?: string;
  brandLikes?: string;
  brandAvoids?: string;
  shippingCountry?: string;
  currency?: string;
  /** Labels already picked on worn screen — steer aspirational away from duplicates. */
  wornLabels?: string[];
};

export type OutfitGridSlot = {
  label: string;
  searchQuery: string;
  tasteTags: string[];
};

export type OutfitGridCard = {
  id: string;
  productId: string;
  label: string;
  title: string;
  imageUrl: string;
  tasteTags: string[];
  searchQuery: string;
  mode: OutfitGridMode;
};

/** Cap shops so onboarding does one MCP call per query instead of ~5 parallel chunks. */
const ONBOARDING_SHOP_LIMIT = 100;

const COUNTRY_CODES: Record<string, string> = {
  lebanon: "LB",
  "united states": "US",
  usa: "US",
  "united kingdom": "GB",
  uk: "GB",
  france: "FR",
  germany: "DE",
  canada: "CA",
  australia: "AU",
  uae: "AE",
  "united arab emirates": "AE",
};

function guessCountryCode(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const t = raw.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return COUNTRY_CODES[t.toLowerCase()];
}

function audiencePhrase(gender?: string): string {
  switch (gender?.trim().toLowerCase()) {
    case "feminine":
      return "women's";
    case "masculine":
      return "men's";
    case "androgynous":
    case "nonbinary":
      return "gender-neutral";
    default:
      return "";
  }
}

const WORN_FALLBACK_FEMININE: OutfitGridSlot[] = [
  { label: "jeans + knit", searchQuery: "women's jeans knit sweater casual outfit", tasteTags: ["jeans", "knit", "casual"] },
  { label: "blazer day", searchQuery: "women's blazer smart casual outfit", tasteTags: ["blazer", "smart-casual"] },
  { label: "slip skirt", searchQuery: "women's slip skirt satin outfit", tasteTags: ["slip-skirt", "satin"] },
  { label: "all black", searchQuery: "women's all black outfit minimal", tasteTags: ["all-black", "minimal"] },
  { label: "athleisure", searchQuery: "women's athleisure matching set", tasteTags: ["athleisure", "sporty"] },
  { label: "shirt dress", searchQuery: "women's shirt dress casual", tasteTags: ["shirt-dress"] },
  { label: "linen set", searchQuery: "women's linen set summer outfit", tasteTags: ["linen", "relaxed"] },
  { label: "denim on denim", searchQuery: "women's denim jacket jeans outfit", tasteTags: ["denim", "casual"] },
  { label: "romantic blouse", searchQuery: "women's romantic blouse soft outfit", tasteTags: ["romantic", "blouse"] },
];

const WORN_FALLBACK_MASCULINE: OutfitGridSlot[] = [
  { label: "jeans + knit", searchQuery: "men's jeans knit sweater casual outfit", tasteTags: ["jeans", "knit", "casual"] },
  { label: "blazer day", searchQuery: "men's blazer chinos smart casual", tasteTags: ["blazer", "smart-casual"] },
  { label: "tee + chino", searchQuery: "men's t-shirt chinos casual outfit", tasteTags: ["tee", "chinos"] },
  { label: "all black", searchQuery: "men's all black outfit minimal", tasteTags: ["all-black", "minimal"] },
  { label: "athleisure", searchQuery: "men's athleisure joggers hoodie", tasteTags: ["athleisure", "sporty"] },
  { label: "oxford shirt", searchQuery: "men's oxford shirt casual friday", tasteTags: ["oxford", "classic"] },
  { label: "linen set", searchQuery: "men's linen shirt shorts summer", tasteTags: ["linen", "relaxed"] },
  { label: "denim on denim", searchQuery: "men's denim jacket jeans outfit", tasteTags: ["denim", "casual"] },
  { label: "tailored trousers", searchQuery: "men's tailored trousers knit polo", tasteTags: ["tailored", "polished"] },
];

const ASPIRATIONAL_FALLBACK_FEMININE: OutfitGridSlot[] = [
  { label: "quiet-luxury airport", searchQuery: "women's quiet luxury travel outfit cashmere", tasteTags: ["quiet-luxury", "travel"] },
  { label: "French-girl café", searchQuery: "women's french girl chic café outfit", tasteTags: ["parisian", "french"] },
  { label: "sequin party", searchQuery: "women's sequin party dress evening", tasteTags: ["sequin", "party"] },
  { label: "minimalist gallery", searchQuery: "women's minimalist gallery outfit black", tasteTags: ["minimal", "gallery"] },
  { label: "boho festival", searchQuery: "women's boho festival outfit", tasteTags: ["boho", "festival"] },
  { label: "street-sharp", searchQuery: "women's street style sharp outfit", tasteTags: ["street", "sharp"] },
  { label: "classic tailored", searchQuery: "women's classic tailored suit", tasteTags: ["classic", "tailored"] },
  { label: "athleisure-clean", searchQuery: "women's clean athleisure elevated", tasteTags: ["athleisure", "clean"] },
  { label: "romantic garden", searchQuery: "women's romantic garden party dress", tasteTags: ["romantic", "garden"] },
];

const ASPIRATIONAL_FALLBACK_MASCULINE: OutfitGridSlot[] = [
  { label: "quiet-luxury airport", searchQuery: "men's quiet luxury travel outfit cashmere", tasteTags: ["quiet-luxury", "travel"] },
  { label: "Italian café", searchQuery: "men's italian smart casual café outfit", tasteTags: ["italian", "smart-casual"] },
  { label: "black-tie adjacent", searchQuery: "men's tuxedo dinner jacket formal", tasteTags: ["formal", "evening"] },
  { label: "minimalist gallery", searchQuery: "men's minimalist black outfit gallery", tasteTags: ["minimal", "gallery"] },
  { label: "festival weekend", searchQuery: "men's festival casual outfit", tasteTags: ["festival", "casual"] },
  { label: "street-sharp", searchQuery: "men's streetwear sharp outfit", tasteTags: ["street", "sharp"] },
  { label: "classic tailored", searchQuery: "men's classic tailored suit", tasteTags: ["classic", "tailored"] },
  { label: "athleisure-clean", searchQuery: "men's clean elevated athleisure", tasteTags: ["athleisure", "clean"] },
  { label: "coastal linen", searchQuery: "men's coastal linen summer outfit", tasteTags: ["linen", "coastal"] },
];

function fallbackSlots(ctx: OutfitDeckContext): OutfitGridSlot[] {
  const g = ctx.genderPresentation?.trim().toLowerCase() ?? "";
  const masculine = g === "masculine";
  if (ctx.mode === "aspirational") {
    return masculine ? ASPIRATIONAL_FALLBACK_MASCULINE : ASPIRATIONAL_FALLBACK_FEMININE;
  }
  return masculine ? WORN_FALLBACK_MASCULINE : WORN_FALLBACK_FEMININE;
}

function parseSlotsJson(raw: string): OutfitGridSlot[] | null {
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { slots?: unknown }).slots)
        ? (parsed as { slots: unknown[] }).slots
        : null;
    if (!list) return null;
    const slots: OutfitGridSlot[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const label = typeof row.label === "string" ? row.label.trim().slice(0, 48) : "";
      const searchQuery =
        typeof row.searchQuery === "string"
          ? row.searchQuery.trim().slice(0, 160)
          : typeof row.query === "string"
            ? row.query.trim().slice(0, 160)
            : "";
      if (!label || !searchQuery) continue;
      const tasteTags = Array.isArray(row.tasteTags)
        ? row.tasteTags
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim().toLowerCase().slice(0, 40))
            .filter(Boolean)
            .slice(0, 6)
        : [];
      slots.push({ label, searchQuery, tasteTags });
      if (slots.length >= 9) break;
    }
    return slots.length >= 6 ? slots.slice(0, 9) : null;
  } catch {
    return null;
  }
}

async function llmOutfitSlots(
  ctx: OutfitDeckContext,
  signal?: AbortSignal,
): Promise<OutfitGridSlot[] | null> {
  const aud = audiencePhrase(ctx.genderPresentation) || "unisex";
  const purpose =
    ctx.mode === "worn"
      ? "real outfits they actually wear most days — everyday reality, not fantasy"
      : "aspirational closet looks they would steal — elevated, dream wardrobe";

  const system = `You generate fashion outfit search slots for a shopping onboarding grid.
Return ONLY JSON: {"slots":[{"label":"short vibe label","searchQuery":"catalog search query","tasteTags":["tag"]}]}.
Exactly 9 slots. Labels are 2–4 words, lowercase-friendly. searchQuery must include audience (${aud}) and garment words Shopify can match.
No markdown.`;

  const userPayload = {
    mode: ctx.mode,
    purpose,
    audience: aud,
    genderPresentation: ctx.genderPresentation ?? null,
    styleEra: ctx.styleEra ?? null,
    lifestyleTags: ctx.lifestyleTags ?? [],
    valuePhilosophy: ctx.valuePhilosophy ?? null,
    brandLikes: ctx.brandLikes ?? null,
    brandAvoids: ctx.brandAvoids ?? null,
    avoidDuplicateLabels: ctx.wornLabels ?? [],
  };

  try {
    const msg = await createLightweightMessage(
      {
        model: AI_CHAT_LIGHTWEIGHT_MODEL,
        max_tokens: 900,
        temperature: 0.4,
        system,
        messages: [{ role: "user", content: JSON.stringify(userPayload) }],
      },
      { signal },
    );
    const text = msg.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return parseSlotsJson(text);
  } catch (error) {
    if (signal?.aborted) throw error;
    logAiChat("warn", "onboarding_outfit_slots_failed", {
      mode: ctx.mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function sampleCuratedShopIds(limit: number): string[] {
  if (CURATED_SHOP_IDS.length <= limit) return [...CURATED_SHOP_IDS];
  const stride = Math.ceil(CURATED_SHOP_IDS.length / limit);
  const out: string[] = [];
  for (let i = 0; i < CURATED_SHOP_IDS.length && out.length < limit; i += stride) {
    out.push(CURATED_SHOP_IDS[i]!);
  }
  return out;
}

function catalogFilters(ctx: OutfitDeckContext): CatalogSearchFilters {
  const filters: CatalogSearchFilters = { available: true };
  const country = guessCountryCode(ctx.shippingCountry);
  if (country) filters.ships_to = { country };
  // Prefer a single MCP request per query when curated allowlist is large.
  if (isCuratedShopAllowlistEnabled()) {
    filters.shop_ids = sampleCuratedShopIds(ONBOARDING_SHOP_LIMIT);
  }
  return filters;
}

function catalogContext(ctx: OutfitDeckContext): CatalogSearchContext | undefined {
  const country = guessCountryCode(ctx.shippingCountry);
  const ctxOut: CatalogSearchContext = {};
  if (country) ctxOut.address_country = country;
  if (ctx.currency?.trim()) {
    ctxOut.currency = ctx.currency.trim().toUpperCase().slice(0, 6);
  }
  return Object.keys(ctxOut).length ? ctxOut : undefined;
}

function productsWithImages(
  products: CatalogProductSummary[] | undefined,
): CatalogProductSummary[] {
  return (products ?? []).filter((p) => Boolean(extractCatalogImageUrl(p)));
}

async function searchCandidates(
  accessToken: string,
  query: string,
  filters: CatalogSearchFilters,
  context: CatalogSearchContext | undefined,
  intent: string,
  signal?: AbortSignal,
): Promise<CatalogProductSummary[]> {
  if (signal?.aborted || !query.trim()) return [];
  try {
    const result = await searchCatalog(accessToken, query, filters, {
      context: { ...context, intent },
      limit: 10,
      signal,
    });
    return productsWithImages(result.products);
  } catch {
    return [];
  }
}

async function searchSlotCandidates(
  accessToken: string,
  slot: OutfitGridSlot,
  filters: CatalogSearchFilters,
  context: CatalogSearchContext | undefined,
  signal?: AbortSignal,
): Promise<CatalogProductSummary[]> {
  let products = await searchCandidates(
    accessToken,
    slot.searchQuery,
    filters,
    context,
    `onboarding outfit grid — ${slot.label}`,
    signal,
  );
  if (products.length === 0 && !signal?.aborted) {
    const short = slot.searchQuery.split(/\s+/).slice(0, 5).join(" ");
    if (short && short !== slot.searchQuery) {
      products = await searchCandidates(
        accessToken,
        short,
        filters,
        context,
        `onboarding outfit grid fallback — ${slot.label}`,
        signal,
      );
    }
  }
  return products;
}

function placeholderCard(
  ctx: OutfitDeckContext,
  slot: OutfitGridSlot,
  index: number,
): OutfitGridCard {
  return {
    id: `slot:${ctx.mode}:${index}:${slot.label}`,
    productId: "",
    label: slot.label,
    title: slot.label,
    imageUrl: "",
    tasteTags: slot.tasteTags,
    searchQuery: slot.searchQuery,
    mode: ctx.mode,
  };
}

function cardFromProduct(
  ctx: OutfitDeckContext,
  slot: OutfitGridSlot,
  product: CatalogProductSummary,
): OutfitGridCard {
  return {
    id: product.id,
    productId: product.id,
    label: slot.label,
    title: product.title,
    imageUrl: extractCatalogImageUrl(product) ?? "",
    tasteTags: slot.tasteTags,
    searchQuery: slot.searchQuery,
    mode: ctx.mode,
  };
}

function simplifiedSlotQuery(slot: OutfitGridSlot, ctx: OutfitDeckContext): string {
  const aud = audiencePhrase(ctx.genderPresentation);
  const tags = slot.tasteTags.filter(Boolean).slice(0, 2).join(" ");
  const base = tags || slot.label;
  return [aud, base].filter(Boolean).join(" ").trim() || slot.searchQuery;
}

/** LLM-proposed outfit slots → Shopify catalog images for worn/aspirational grids. */
export async function buildOutfitGridDeck(
  ctx: OutfitDeckContext,
  options: { signal?: AbortSignal } = {},
): Promise<OutfitGridCard[]> {
  const signal = options.signal;
  const [llmSlots, accessToken] = await Promise.all([
    llmOutfitSlots(ctx, signal),
    accessTokenForCatalogMcp(),
  ]);
  const slots = (llmSlots ?? fallbackSlots(ctx)).slice(0, 9);

  const filters = catalogFilters(ctx);
  const context = catalogContext(ctx);

  const seen = new Set<string>();
  const deck: OutfitGridCard[] = [];

  const candidateLists = await mapWithConcurrency(slots, 3, (slot) =>
    searchSlotCandidates(accessToken, slot, filters, context, signal),
  );

  const leftovers: CatalogProductSummary[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const list = candidateLists[i] ?? [];
    const product = list.find((p) => !seen.has(p.id));
    if (!product) {
      deck.push(placeholderCard(ctx, slot, i));
      continue;
    }
    seen.add(product.id);
    deck.push(cardFromProduct(ctx, slot, product));
    for (const extra of list) {
      if (!seen.has(extra.id)) leftovers.push(extra);
    }
  }

  // Fill image-less slots from unused search hits (keep the slot's vibe label).
  for (let i = 0; i < deck.length; i++) {
    if (deck[i]!.imageUrl) continue;
    const nextIdx = leftovers.findIndex((p) => !seen.has(p.id));
    if (nextIdx < 0) break;
    const next = leftovers.splice(nextIdx, 1)[0]!;
    seen.add(next.id);
    deck[i] = cardFromProduct(ctx, slots[i]!, next);
  }

  // Last resort: simpler queries for any remaining empties.
  const emptyIndexes = deck
    .map((card, i) => (card.imageUrl ? -1 : i))
    .filter((i) => i >= 0);
  if (emptyIndexes.length > 0 && !signal?.aborted) {
    await mapWithConcurrency(emptyIndexes, 3, async (index) => {
      const slot = slots[index]!;
      const products = await searchCandidates(
        accessToken,
        simplifiedSlotQuery(slot, ctx),
        filters,
        context,
        `onboarding outfit grid refill — ${slot.label}`,
        signal,
      );
      const product = products.find((p) => !seen.has(p.id));
      if (!product) return null;
      seen.add(product.id);
      deck[index] = cardFromProduct(ctx, slot, product);
      return product.id;
    });
  }

  return deck.slice(0, 9);
}
