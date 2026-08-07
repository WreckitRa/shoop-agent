/**
 * In-house outfit deck builder from a curated STYLE list.
 * Looks are mode-agnostic — worn vs wanted is the quiz step, not the asset.
 * Soft formality bias only (everyday vs elevated energy).
 */

import { logAiChat } from "@/lib/ai-chat/observability";
import {
  buildCastingMatrix,
  slotOverlapsWornPicks,
  type CastingArchetype,
  type CastingCell,
  type OutfitGridMode,
} from "@/lib/onboarding/outfit-grid-matrix";
import {
  getInhouseOutfitLooks,
  type OutfitFormality,
  type OutfitGenderBucket,
  type OutfitStyleLook,
} from "@/lib/onboarding/outfit-style-catalog";

export const OUTFIT_DECK_PAGE_SIZE = 9;

export type OutfitDeckContext = {
  /** Quiz step only — does not gate which styles exist in the library. */
  mode: OutfitGridMode;
  genderPresentation?: string;
  styleEra?: string;
  lifestyleTags?: string[];
  valuePhilosophy?: string;
  brandLikes?: string;
  brandAvoids?: string;
  shippingCountry?: string;
  currency?: string;
  wornLabels?: string[];
  wornTasteTags?: string[];
  /** Style ids already picked on worn — hard-exclude on wanted deck. */
  wornLookIds?: string[];
  /** Already-shown style ids (pagination / See more). */
  excludeLookIds?: string[];
};

export type OutfitDeckPage = {
  deck: OutfitGridCard[];
  hasMore: boolean;
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
  archetype: CastingArchetype;
  cell: number;
};

type GenderBucket = "feminine" | "masculine" | "androgynous";

export function genderBucketFromPresentation(
  gender?: string,
): GenderBucket {
  const g = gender?.trim().toLowerCase() ?? "";
  if (g === "masculine") return "masculine";
  if (
    g === "androgynous" ||
    g === "nonbinary" ||
    g === "prefer not to say"
  ) {
    return "androgynous";
  }
  return "feminine";
}

function splitCsv(raw?: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Hard gender gate.
 * - Includes shopper presentation → match
 * - `any` alone → unisex for everyone
 * - `"any"` mixed with feminine/masculine is ignored as a universal key
 *   (old bug: ["feminine","any"] matched men)
 */
function genderMatches(
  look: OutfitStyleLook,
  bucket: GenderBucket,
): boolean {
  if (look.genders.includes(bucket)) return true;
  if (look.genders.length === 1 && look.genders[0] === "any") return true;
  return false;
}

/**
 * Soft fill when hard pool is thin — never show cross-coded binary looks
 * (men do not get feminine-only images as "soft" fallback).
 */
function genderSoftEligible(
  look: OutfitStyleLook,
  bucket: GenderBucket,
): boolean {
  if (genderMatches(look, bucket)) return true;
  if (bucket === "androgynous") return true;

  // Explicitly unisex
  if (look.genders.length === 1 && look.genders[0] === "any") return true;
  if (
    look.genders.includes("androgynous") &&
    !look.genders.includes("feminine") &&
    !look.genders.includes("masculine")
  ) {
    return true;
  }
  // Intentional f+m unisex
  if (
    look.genders.includes("feminine") &&
    look.genders.includes("masculine")
  ) {
    return true;
  }
  return false;
}

/** Reject opposite presentation for binary shoppers in all cascade stages. */
function genderAllowed(
  look: OutfitStyleLook,
  bucket: GenderBucket,
  hardOnly: boolean,
): boolean {
  if (genderMatches(look, bucket)) return true;
  if (hardOnly) return false;
  return genderSoftEligible(look, bucket);
}

/**
 * Soft preference only — a sequin look can still appear on "worn" if it scores
 * high for someone; a hoodie can still appear on "wanted".
 */
const FORMALITY_BIAS: Record<
  OutfitGridMode,
  Record<OutfitFormality, number>
> = {
  worn: {
    casual: 14,
    athletic: 12,
    smart: 10,
    formal: 4,
  },
  aspirational: {
    formal: 14,
    smart: 12,
    athletic: 8,
    casual: 5,
  },
};

export type LookScoreBreakdown = {
  total: number;
  gender: number;
  archetype: number;
  era: number;
  lifestyle: number;
  spend: number;
  brands: number;
  wornConflict: number;
  /** Soft step bias (formality × worn|wanted) — not a hard lock. */
  stepBias: number;
};

export function scoreLookForContext(
  look: OutfitStyleLook,
  ctx: OutfitDeckContext,
  cell: CastingCell,
  opts?: { hardGender?: boolean },
): LookScoreBreakdown {
  const bucket = genderBucketFromPresentation(ctx.genderPresentation);
  const eras = splitCsv(ctx.styleEra);
  const spend = splitCsv(ctx.valuePhilosophy);
  const lifestyles = (ctx.lifestyleTags ?? []).map((t) =>
    t.trim().toLowerCase(),
  );
  const brandLikes = splitCsv(ctx.brandLikes);
  const brandAvoids = splitCsv(ctx.brandAvoids);
  const wornLabels = ctx.wornLabels ?? [];
  const wornTasteTags = ctx.wornTasteTags ?? [];
  const wornLookIds = new Set(
    (ctx.wornLookIds ?? []).map((id) => id.trim()).filter(Boolean),
  );

  const hardGender = opts?.hardGender !== false;
  let gender = 0;
  if (genderMatches(look, bucket)) {
    gender = 40;
  } else if (genderAllowed(look, bucket, /* hardOnly */ false)) {
    gender = 12;
  } else {
    // Never put a binary-opposite look on the other gender's rail
    return {
      total: -10_000,
      gender: -10_000,
      archetype: 0,
      era: 0,
      lifestyle: 0,
      spend: 0,
      brands: 0,
      wornConflict: 0,
      stepBias: 0,
    };
  }
  // Prefer hard-matched assets when hardGender stage runs
  if (hardGender && !genderMatches(look, bucket)) {
    return {
      total: -10_000,
      gender: -10_000,
      archetype: 0,
      era: 0,
      lifestyle: 0,
      spend: 0,
      brands: 0,
      wornConflict: 0,
      stepBias: 0,
    };
  }

  // Hard exclude exact styles already chosen as "worn" when building wanted.
  if (ctx.mode === "aspirational" && wornLookIds.has(look.id)) {
    return {
      total: -10_000,
      gender,
      archetype: 0,
      era: 0,
      lifestyle: 0,
      spend: 0,
      brands: 0,
      wornConflict: -10_000,
      stepBias: 0,
    };
  }

  const stepBias = FORMALITY_BIAS[ctx.mode]?.[look.formality] ?? 8;

  let archetype = 0;
  if (look.archetypes[0] === cell.archetype) archetype = 50;
  else if (look.archetypes.includes(cell.archetype)) archetype = 36;
  else if (cell.archetype === "Wildcard") archetype = 10;
  else archetype = -8;

  let era = 8;
  if (look.eras.length === 0) {
    era = 10;
  } else if (eras.length === 0) {
    era = 6;
  } else {
    const hit = eras.some((e) => look.eras.includes(e as never));
    era = hit ? 28 : -6;
  }

  let lifestyle = 6;
  if (look.lifestyles.length === 0) {
    lifestyle = 8;
  } else if (lifestyles.length === 0) {
    lifestyle = 5;
  } else {
    const hit = lifestyles.some((l) =>
      look.lifestyles.map((x) => x.toLowerCase()).includes(l),
    );
    const hint = cell.lifestyleHint?.toLowerCase();
    const hintHit =
      hint &&
      look.lifestyles.map((x) => x.toLowerCase()).includes(hint);
    lifestyle = hit || hintHit ? 22 : -4;
  }

  let spendScore = 6;
  if (look.spend.length === 0) {
    spendScore = 8;
  } else if (spend.length === 0) {
    spendScore = 5;
  } else {
    const hit = spend.some((s) =>
      look.spend.map((x) => x.toLowerCase()).includes(s),
    );
    spendScore = hit ? 18 : -3;
  }

  let brands = 0;
  const hay = `${look.label} ${look.tasteTags.join(" ")}`.toLowerCase();
  for (const b of brandLikes) {
    if (b && hay.includes(b)) brands += 6;
  }
  for (const b of brandAvoids) {
    if (b && hay.includes(b)) brands -= 20;
  }

  let wornConflict = 0;
  if (ctx.mode === "aspirational") {
    if (
      slotOverlapsWornPicks(
        { label: look.label, tasteTags: look.tasteTags },
        wornLabels,
        wornTasteTags,
      )
    ) {
      wornConflict = -80;
    }
  }

  const total =
    gender +
    stepBias +
    archetype +
    era +
    lifestyle +
    spendScore +
    brands +
    wornConflict;

  return {
    total,
    gender,
    stepBias,
    archetype,
    era,
    lifestyle,
    spend: spendScore,
    brands,
    wornConflict,
  };
}

function cardFromLook(
  look: OutfitStyleLook,
  ctx: OutfitDeckContext,
  cell: CastingCell,
): OutfitGridCard {
  return {
    id: look.id,
    productId: look.id,
    label: look.label,
    title: look.title ?? look.label,
    imageUrl: look.imageUrl,
    tasteTags: [
      ...look.tasteTags,
      cell.archetype.toLowerCase(),
    ].slice(0, 8),
    searchQuery: `inhouse ${cell.archetype} ${look.label}`,
    mode: ctx.mode,
    archetype: cell.archetype,
    cell: cell.cell,
  };
}

type Ranked = { look: OutfitStyleLook; score: number };

function rankPool(
  pool: OutfitStyleLook[],
  ctx: OutfitDeckContext,
  cell: CastingCell,
  hardGender: boolean,
): Ranked[] {
  return pool
    .map((look) => ({
      look,
      score: scoreLookForContext(look, ctx, cell, { hardGender }).total,
    }))
    .filter((r) => r.score > -5_000)
    .sort((a, b) => b.score - a.score || a.look.id.localeCompare(b.look.id));
}

/**
 * Fill 9 matrix cells from the full style library (no worn/wanted asset lock).
 * Pass `excludeLookIds` to page beyond the first screen (See more).
 */
export function selectInhouseDeck(
  ctx: OutfitDeckContext,
  looks: readonly OutfitStyleLook[] = getInhouseOutfitLooks(),
): OutfitGridCard[] {
  const matrix = buildCastingMatrix(ctx.lifestyleTags);
  const used = new Set<string>();
  const usedColors = new Map<string, number>();
  const usedFormality = new Map<string, number>();
  const deck: OutfitGridCard[] = [];
  const excludeIds = new Set(
    (ctx.excludeLookIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const paging = excludeIds.size > 0;

  // Full library, but gender is enforced hard in scoring.
  const pool = [...looks];
  const bucket = genderBucketFromPresentation(ctx.genderPresentation);

  for (const look of pool) {
    if (!excludeIds.has(look.id)) continue;
    used.add(look.id);
    used.add(look.imageUrl);
  }

  for (const cell of matrix) {
    const pickWithDiversity = (ranked: Ranked[]): Ranked | null => {
      for (const row of ranked) {
        if (used.has(row.look.id)) continue;
        if (used.has(row.look.imageUrl)) continue;
        const colorCount = usedColors.get(row.look.colorFamily) ?? 0;
        const formCount = usedFormality.get(row.look.formality) ?? 0;
        if (colorCount >= 3 || formCount >= 4) continue;
        return row;
      }
      for (const row of ranked) {
        if (used.has(row.look.id) || used.has(row.look.imageUrl)) continue;
        return row;
      }
      return null;
    };

    let chosen: Ranked | null = null;

    chosen = pickWithDiversity(rankPool(pool, ctx, cell, true));

    if (!chosen) {
      chosen = pickWithDiversity(rankPool(pool, ctx, cell, false));
    }

    if (!chosen) {
      const loose = pool
        .filter(
          (l) =>
            !used.has(l.id) &&
            !used.has(l.imageUrl) &&
            genderAllowed(l, bucket, false),
        )
        .map((look) => ({
          look,
          score: scoreLookForContext(look, ctx, cell, {
            hardGender: false,
          }).total,
        }))
        .filter((r) => r.score > -5_000)
        .sort((a, b) => b.score - a.score);
      chosen = loose[0] ?? null;
    }

    if (!chosen) {
      const fallback = pool.find(
        (l) =>
          !used.has(l.id) &&
          !used.has(l.imageUrl) &&
          genderAllowed(l, bucket, false),
      );
      if (fallback) chosen = { look: fallback, score: 0 };
    }

    if (!chosen) {
      // Last resort: already-used same-gender look rather than opposite gender
      const wrap = pool.find((l) => genderAllowed(l, bucket, false));
      if (wrap) chosen = { look: wrap, score: -1 };
    }

    if (!chosen) {
      // Don't pad empty tiles on See-more pages — return only real looks.
      if (paging) continue;
      deck.push({
        id: `empty:${ctx.mode}:${cell.cell}`,
        productId: "",
        label: cell.archetype.toLowerCase(),
        title: cell.archetype,
        imageUrl: "",
        tasteTags: [cell.archetype.toLowerCase()],
        searchQuery: `inhouse ${cell.archetype}`,
        mode: ctx.mode,
        archetype: cell.archetype,
        cell: cell.cell,
      });
      continue;
    }

    used.add(chosen.look.id);
    used.add(chosen.look.imageUrl);
    usedColors.set(
      chosen.look.colorFamily,
      (usedColors.get(chosen.look.colorFamily) ?? 0) + 1,
    );
    usedFormality.set(
      chosen.look.formality,
      (usedFormality.get(chosen.look.formality) ?? 0) + 1,
    );
    deck.push(cardFromLook(chosen.look, ctx, cell));
  }

  return deck;
}

function outfitDeckHasMore(
  ctx: OutfitDeckContext,
  shownIds: Iterable<string>,
  looks: readonly OutfitStyleLook[] = getInhouseOutfitLooks(),
): boolean {
  const shown = new Set(
    [...shownIds, ...(ctx.excludeLookIds ?? []), ...(ctx.wornLookIds ?? [])]
      .map((id) => id.trim())
      .filter(Boolean),
  );
  const bucket = genderBucketFromPresentation(ctx.genderPresentation);
  return looks.some(
    (look) => !shown.has(look.id) && genderAllowed(look, bucket, false),
  );
}

export async function buildOutfitGridDeck(
  ctx: OutfitDeckContext,
  options: { signal?: AbortSignal } = {},
): Promise<OutfitDeckPage> {
  if (options.signal?.aborted) {
    throw new Error("Aborted");
  }
  const selected = selectInhouseDeck(ctx);
  const deck = (
    ctx.excludeLookIds?.length
      ? selected.filter((c) => Boolean(c.imageUrl))
      : selected
  ).slice(0, OUTFIT_DECK_PAGE_SIZE);
  const hasMore = outfitDeckHasMore(
    ctx,
    deck.map((c) => c.id),
  );
  logAiChat("info", "onboarding_outfit_deck_built", {
    source: "inhouse_catalog",
    mode: ctx.mode,
    filled: deck.filter((c) => c.imageUrl).length,
    pageExclude: ctx.excludeLookIds?.length ?? 0,
    hasMore,
    gender: ctx.genderPresentation ?? null,
    eras: ctx.styleEra ?? null,
  });
  return { deck, hasMore };
}

/** Count looks eligible for a gender (styles are mode-agnostic). */
export function countInhouseCoverage(params: {
  genderPresentation?: string;
  /** @deprecated ignored — looks are not locked to worn/wanted */
  mode?: OutfitGridMode;
}): number {
  const bucket = genderBucketFromPresentation(params.genderPresentation);
  return getInhouseOutfitLooks().filter((l) =>
    genderAllowed(l, bucket, false),
  ).length;
}
