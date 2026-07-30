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
import {
  buildCastingMatrix,
  fallbackSlotsForMatrix,
  isCastingArchetype,
  isPhotoIntentQuery,
  slotOverlapsWornPicks,
  type CastingArchetype,
  type CastingCell,
  type OutfitGridMode,
  type OutfitGridSlot,
} from "@/lib/onboarding/outfit-grid-matrix";
import {
  CANDIDATES_PER_SLOT,
  judgeOutfitGridPhotos,
} from "@/lib/onboarding/outfit-grid-vision";

export type { OutfitGridMode, OutfitGridSlot, CastingArchetype };
export type { CastingCell } from "@/lib/onboarding/outfit-grid-matrix";

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
  /** Labels already picked on worn screen — banned territory for aspirational. */
  wornLabels?: string[];
  /** Taste tags from worn picks — hard overlap filter for aspirational. */
  wornTasteTags?: string[];
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
  /** Locked casting-matrix archetype — 1:1 styleMix vote. */
  archetype: CastingArchetype;
  cell: number;
};

const ONBOARDING_SHOP_LIMIT = 100;
const ARCHETYPE_SHOP_LIMIT = 40;

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
    case "prefer not to say":
      return "gender-neutral";
    default:
      return "";
  }
}

export const OUTFIT_GRID_SLOT_SYSTEM = `You fill a 9-cell casting matrix for a fashion onboarding grid. You receive cells as {"cell":n,"archetype":"...","mode":"worn|aspirational","context":{...}}. For EACH cell return {"cell":n,"label":"2-4 words, lowercase-friendly, in the archetype voice","searchQuery":"...","tasteTags":["..."]}. searchQuery RULES: must include the audience (AUD), a COMBINATION of 2+ garment words (outfit energy, never one noun), and one of: outfit, look, co-ord, set, styled, model. LABEL RULES: no two labels may share their first word; labels must read as nine visibly different lives. WORN cells: everyday reality inside the given lifestyleTags... include the unglamorous truth (knitwear, denim, comfort). ASPIRATIONAL cells: one elevation step above worn (occasion, fabric, tailoring)... never a costume leap; banned territory: the wornLabels provided. Respect brandAvoids as aesthetic signals. Formality + color: no two adjacent cells same formality band; at least 4 distinct color families across the deck. Return ONLY JSON {"slots":[...]}. No markdown.`;

function sampleCuratedShopIds(limit: number, offset = 0): string[] {
  if (CURATED_SHOP_IDS.length <= limit) return [...CURATED_SHOP_IDS];
  const stride = Math.ceil(CURATED_SHOP_IDS.length / limit);
  const out: string[] = [];
  const start = offset % CURATED_SHOP_IDS.length;
  for (
    let i = 0;
    i < CURATED_SHOP_IDS.length && out.length < limit;
    i += stride
  ) {
    out.push(CURATED_SHOP_IDS[(start + i) % CURATED_SHOP_IDS.length]!);
  }
  return out;
}

/** Per-archetype shop cohort — structural diversity until affinity tags exist. */
function shopIdsForArchetype(archetype: CastingArchetype): string[] | undefined {
  if (!isCuratedShopAllowlistEnabled()) return undefined;
  let hash = 0;
  for (let i = 0; i < archetype.length; i++) {
    hash = (hash * 31 + archetype.charCodeAt(i)) >>> 0;
  }
  return sampleCuratedShopIds(ARCHETYPE_SHOP_LIMIT, hash % CURATED_SHOP_IDS.length);
}

function catalogFilters(
  ctx: OutfitDeckContext,
  archetype?: CastingArchetype,
): CatalogSearchFilters {
  const filters: CatalogSearchFilters = { available: true };
  const country = guessCountryCode(ctx.shippingCountry);
  if (country) filters.ships_to = { country };
  if (isCuratedShopAllowlistEnabled()) {
    filters.shop_ids =
      (archetype ? shopIdsForArchetype(archetype) : undefined) ??
      sampleCuratedShopIds(ONBOARDING_SHOP_LIMIT);
  }
  return filters;
}

function catalogContext(
  ctx: OutfitDeckContext,
): CatalogSearchContext | undefined {
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

function parseMatrixSlotsJson(
  raw: string,
  matrix: CastingCell[],
): OutfitGridSlot[] | null {
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { slots?: unknown }).slots)
        ? (parsed as { slots: unknown[] }).slots
        : null;
    if (!list) return null;

    const byCell = new Map<number, OutfitGridSlot>();
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const cellNum =
        typeof row.cell === "number" ? row.cell : Number(row.cell);
      if (!Number.isFinite(cellNum)) continue;
      const matrixCell = matrix.find((c) => c.cell === Math.round(cellNum));
      if (!matrixCell) continue;

      const label =
        typeof row.label === "string" ? row.label.trim().slice(0, 48) : "";
      const searchQuery =
        typeof row.searchQuery === "string"
          ? row.searchQuery.trim().slice(0, 160)
          : typeof row.query === "string"
            ? row.query.trim().slice(0, 160)
            : "";
      if (!label || !searchQuery) continue;
      if (!isPhotoIntentQuery(searchQuery)) continue;

      const tasteTags = Array.isArray(row.tasteTags)
        ? row.tasteTags
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim().toLowerCase().slice(0, 40))
            .filter(Boolean)
            .slice(0, 6)
        : [];

      const archetypeFromRow =
        typeof row.archetype === "string" && isCastingArchetype(row.archetype)
          ? row.archetype
          : matrixCell.archetype;

      byCell.set(matrixCell.cell, {
        cell: matrixCell.cell,
        archetype: archetypeFromRow,
        label,
        searchQuery,
        tasteTags,
      });
    }

    if (byCell.size < 6) return null;
    return matrix.map((c) => byCell.get(c.cell)).filter(Boolean) as OutfitGridSlot[];
  } catch {
    return null;
  }
}

async function llmFillMatrixCells(
  ctx: OutfitDeckContext,
  cells: CastingCell[],
  aud: string,
  signal?: AbortSignal,
): Promise<OutfitGridSlot[] | null> {
  if (!cells.length) return [];

  const userPayload = {
    audience: aud,
    AUD: aud,
    mode: ctx.mode,
    cells: cells.map((c) => ({
      cell: c.cell,
      archetype: c.archetype,
      mode: ctx.mode,
      context: {
        lifestyleHint: c.lifestyleHint ?? null,
        lifestyleTags: ctx.lifestyleTags ?? [],
        genderPresentation: ctx.genderPresentation ?? null,
        styleEra: ctx.styleEra ?? null,
        valuePhilosophy: ctx.valuePhilosophy ?? null,
        brandLikes: ctx.brandLikes ?? null,
        brandAvoids: ctx.brandAvoids ?? null,
        wornLabels: ctx.wornLabels ?? [],
        wornTasteTags: ctx.wornTasteTags ?? [],
        constraint:
          c.archetype === "Wildcard"
            ? ctx.mode === "worn"
              ? "comfort-truth slot — the hoodie is safe here"
              : "stretch slot — boldest plausible reach given brandLikes"
            : ctx.mode === "worn"
              ? "everyday reality in the lifestyleHint context"
              : "one elevation step up — occasion/energy, richer fabric, sharper tailoring",
      },
    })),
  };

  const system = OUTFIT_GRID_SLOT_SYSTEM.replace(/\(AUD\)/g, `(${aud})`);

  try {
    const msg = await createLightweightMessage(
      {
        model: AI_CHAT_LIGHTWEIGHT_MODEL,
        max_tokens: 1100,
        temperature: 0.7,
        system,
        messages: [{ role: "user", content: JSON.stringify(userPayload) }],
      },
      { signal },
    );
    const text = msg.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return parseMatrixSlotsJson(text, cells);
  } catch (error) {
    if (signal?.aborted) throw error;
    logAiChat("warn", "onboarding_outfit_slots_failed", {
      mode: ctx.mode,
      cells: cells.map((c) => c.cell),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function mergeSlotsOntoMatrix(
  matrix: CastingCell[],
  filled: OutfitGridSlot[] | null,
  fallback: OutfitGridSlot[],
): OutfitGridSlot[] {
  const byCell = new Map(filled?.map((s) => [s.cell, s]));
  const fb = new Map(fallback.map((s) => [s.cell, s]));
  return matrix.map((cell) => {
    const slot = byCell.get(cell.cell) ?? fb.get(cell.cell);
    if (slot) {
      return { ...slot, cell: cell.cell, archetype: cell.archetype };
    }
    return fb.get(cell.cell)!;
  });
}

async function resolveSlots(
  ctx: OutfitDeckContext,
  signal?: AbortSignal,
): Promise<OutfitGridSlot[]> {
  const matrix = buildCastingMatrix(ctx.lifestyleTags);
  const fallback = fallbackSlotsForMatrix(ctx);
  const aud = audiencePhrase(ctx.genderPresentation) || "unisex";

  const llmSlots = await llmFillMatrixCells(ctx, matrix, aud, signal);
  let slots = mergeSlotsOntoMatrix(matrix, llmSlots, fallback);

  // Hard aspirational dedupe — regenerate overlapping cells once.
  if (ctx.mode === "aspirational") {
    const wornLabels = ctx.wornLabels ?? [];
    const wornTasteTags = ctx.wornTasteTags ?? [];
    const rejected = slots.filter((s) =>
      slotOverlapsWornPicks(s, wornLabels, wornTasteTags),
    );
    if (rejected.length) {
      const regenCells = matrix.filter((c) =>
        rejected.some((r) => r.cell === c.cell),
      );
      const regenerated = await llmFillMatrixCells(
        ctx,
        regenCells,
        aud,
        signal,
      );
      const regenByCell = new Map(regenerated?.map((s) => [s.cell, s]));
      slots = slots.map((s) => {
        if (!rejected.some((r) => r.cell === s.cell)) return s;
        const next = regenByCell.get(s.cell);
        if (
          next &&
          !slotOverlapsWornPicks(next, wornLabels, wornTasteTags) &&
          isPhotoIntentQuery(next.searchQuery)
        ) {
          return { ...next, cell: s.cell, archetype: s.archetype };
        }
        // Fall back to matrix fallback for that cell if still overlapping.
        const fb = fallback.find((f) => f.cell === s.cell)!;
        return { ...fb, cell: s.cell, archetype: s.archetype };
      });
      logAiChat("info", "onboarding_outfit_aspirational_dedupe", {
        regenerated: rejected.map((r) => r.cell),
      });
    }
  }

  return slots;
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
  ctx: OutfitDeckContext,
  context: CatalogSearchContext | undefined,
  signal?: AbortSignal,
): Promise<CatalogProductSummary[]> {
  let filters = catalogFilters(ctx, slot.archetype);
  let products = await searchCandidates(
    accessToken,
    slot.searchQuery,
    filters,
    context,
    `onboarding outfit grid — ${slot.archetype} — ${slot.label}`,
    signal,
  );

  // Thin archetype cohort → widen to full onboarding sample.
  if (
    products.length < CANDIDATES_PER_SLOT &&
    isCuratedShopAllowlistEnabled() &&
    !signal?.aborted
  ) {
    filters = catalogFilters(ctx);
    const wider = await searchCandidates(
      accessToken,
      slot.searchQuery,
      filters,
      context,
      `onboarding outfit grid widen — ${slot.label}`,
      signal,
    );
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const p of wider) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    products = [...byId.values()];
  }

  if (products.length === 0 && !signal?.aborted) {
    const short = slot.searchQuery.split(/\s+/).slice(0, 6).join(" ");
    if (short && short !== slot.searchQuery) {
      products = await searchCandidates(
        accessToken,
        short,
        catalogFilters(ctx),
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
): OutfitGridCard {
  return {
    id: `slot:${ctx.mode}:${slot.cell}:${slot.label}`,
    productId: "",
    label: slot.label,
    title: slot.label,
    imageUrl: "",
    tasteTags: slot.tasteTags,
    searchQuery: slot.searchQuery,
    mode: ctx.mode,
    archetype: slot.archetype,
    cell: slot.cell,
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
    archetype: slot.archetype,
    cell: slot.cell,
  };
}

function simplifiedSlotQuery(
  slot: OutfitGridSlot,
  ctx: OutfitDeckContext,
): string {
  const aud = audiencePhrase(ctx.genderPresentation) || "unisex";
  const tags = slot.tasteTags.filter(Boolean).slice(0, 2).join(" ");
  const base = tags || slot.label;
  // Keep photo-intent words so refill stays outfit-energy.
  return `${aud} ${base} outfit look`.replace(/\s+/g, " ").trim();
}

/** Matrix-filled slots → catalog candidates → vision-judged photos. */
export async function buildOutfitGridDeck(
  ctx: OutfitDeckContext,
  options: { signal?: AbortSignal } = {},
): Promise<OutfitGridCard[]> {
  const signal = options.signal;
  const [slots, accessToken] = await Promise.all([
    resolveSlots(ctx, signal),
    accessTokenForCatalogMcp(),
  ]);

  const context = catalogContext(ctx);
  const seen = new Set<string>();

  const candidateLists = await mapWithConcurrency(slots, 3, (slot) =>
    searchSlotCandidates(accessToken, slot, ctx, context, signal),
  );

  // Dedupe across slots before judging — keep first occurrence order.
  const judgeInputs = slots.map((slot, i) => {
    const list = (candidateLists[i] ?? []).filter((p) => {
      if (seen.has(p.id)) return false;
      return true;
    });
    // Soft-reserve so other slots prefer different products; judge may still pick.
    for (const p of list.slice(0, CANDIDATES_PER_SLOT)) {
      seen.add(p.id);
    }
    return {
      slot: slot.cell,
      label: slot.label,
      candidates: list.slice(0, 10),
    };
  });

  const judged = await judgeOutfitGridPhotos(judgeInputs, { signal });

  const deck: OutfitGridCard[] = slots.map((slot) => {
    const product = judged.winners.get(slot.cell);
    if (!product) return placeholderCard(ctx, slot);
    return cardFromProduct(ctx, slot, product);
  });

  // Refill + re-judge only null / empty slots.
  const emptyIndexes = deck
    .map((card, i) => (card.imageUrl ? -1 : i))
    .filter((i) => i >= 0);

  if (emptyIndexes.length > 0 && !signal?.aborted) {
    const refillSeen = new Set(
      deck.filter((c) => c.productId).map((c) => c.productId),
    );
    const refillCandidates = (
      await mapWithConcurrency(emptyIndexes, 3, async (index) => {
        const slot = slots[index]!;
        const products = await searchCandidates(
          accessToken,
          simplifiedSlotQuery(slot, ctx),
          catalogFilters(ctx),
          context,
          `onboarding outfit grid refill — ${slot.label}`,
          signal,
        );
        return {
          index,
          slot,
          products: products.filter((p) => !refillSeen.has(p.id)),
        };
      })
    ).filter(
      (row): row is { index: number; slot: OutfitGridSlot; products: CatalogProductSummary[] } =>
        row != null,
    );

    const rejudge = await judgeOutfitGridPhotos(
      refillCandidates.map(({ slot, products }) => ({
        slot: slot.cell,
        label: slot.label,
        candidates: products,
      })),
      { signal },
    );

    for (const { index, slot } of refillCandidates) {
      const product = rejudge.winners.get(slot.cell);
      if (!product) continue;
      refillSeen.add(product.id);
      deck[index] = cardFromProduct(ctx, slot, product);
    }
  }

  logAiChat("info", "onboarding_outfit_deck_built", {
    mode: ctx.mode,
    judged: judged.judged,
    killed: judged.killed,
    filled: deck.filter((c) => c.imageUrl).length,
  });

  return deck.slice(0, 9);
}
