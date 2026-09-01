/**
 * Casting matrix for onboarding outfit grids.
 * Code owns the 9-cell spread (8 styleMix axes + Wildcard); the LLM fills cells.
 */

import { genderPresentationBucket } from "@/lib/onboarding/form-options";

export const STYLE_MIX_AXES = [
  "Parisian",
  "Minimal",
  "Romantic",
  "Street",
  "Classic",
  "Sporty",
  "Boho",
  "Bold",
] as const;

export type StyleMixAxis = (typeof STYLE_MIX_AXES)[number];
export type CastingArchetype = StyleMixAxis | "Wildcard";

export type OutfitGridMode = "worn" | "aspirational";

export type CastingCell = {
  /** 1-indexed cell id matching the prompt contract. */
  cell: number;
  archetype: CastingArchetype;
  /** Lifestyle context rotated onto this cell (worn everyday / aspirational elevation). */
  lifestyleHint?: string;
};

export type OutfitGridSlot = {
  cell: number;
  archetype: CastingArchetype;
  label: string;
  searchQuery: string;
  tasteTags: string[];
};

const PHOTO_BIAS_RE = /\b(outfit|look|co-?ords?|set|styled|model)\b/i;

const QUERY_STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "with",
  "for",
  "in",
  "on",
  "of",
  "to",
  "women's",
  "womens",
  "men's",
  "mens",
  "gender-neutral",
  "unisex",
  "outfit",
  "look",
  "coord",
  "co-ord",
  "co-ords",
  "set",
  "styled",
  "model",
]);

/** Build the locked 9-cell matrix; lifestyleTags rotate across cells 1–8. */
export function buildCastingMatrix(lifestyleTags?: string[]): CastingCell[] {
  const tags = (lifestyleTags ?? []).map((t) => t.trim()).filter(Boolean);
  const cells: CastingCell[] = STYLE_MIX_AXES.map((archetype, i) => ({
    cell: i + 1,
    archetype,
    lifestyleHint: tags.length ? tags[i % tags.length] : undefined,
  }));
  cells.push({
    cell: 9,
    archetype: "Wildcard",
    lifestyleHint: tags[0],
  });
  return cells;
}

export function isStyleMixAxis(value: string): value is StyleMixAxis {
  return (STYLE_MIX_AXES as readonly string[]).includes(value);
}

export function isCastingArchetype(value: string): value is CastingArchetype {
  return value === "Wildcard" || isStyleMixAxis(value);
}

/** searchQuery must carry audience + 2+ garment words + a photo-bias term. */
export function isPhotoIntentQuery(searchQuery: string): boolean {
  const q = searchQuery.trim();
  if (!q || !PHOTO_BIAS_RE.test(q)) return false;
  const tokens = q
    .toLowerCase()
    .replace(/[^a-z0-9'+-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !QUERY_STOP.has(t));
  // At least two content tokens beyond stop/bias (= garment combination energy).
  return tokens.length >= 2;
}

/** Jaccard overlap of taste tag sets; true when overlap > 50%. */
export function tasteTagsOverlapTooMuch(
  a: string[],
  b: string[],
  threshold = 0.5,
): boolean {
  const left = new Set(
    a.map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  const right = new Set(
    b.map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  if (!left.size || !right.size) return false;
  let inter = 0;
  for (const t of left) {
    if (right.has(t)) inter += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union > 0 && inter / union > threshold;
}

export function slotOverlapsWornPicks(
  slot: Pick<OutfitGridSlot, "tasteTags" | "label">,
  wornLabels: string[],
  wornTasteTags: string[],
): boolean {
  const labelLc = slot.label.trim().toLowerCase();
  if (
    wornLabels.some((w) => {
      const wl = w.trim().toLowerCase();
      return wl && (wl === labelLc || labelLc.includes(wl) || wl.includes(labelLc));
    })
  ) {
    return true;
  }
  return tasteTagsOverlapTooMuch(slot.tasteTags, wornTasteTags);
}

type GenderBucket = "feminine" | "masculine" | "androgynous";

function genderBucket(gender?: string): GenderBucket {
  return genderPresentationBucket(gender) || "feminine";
}

type FallbackRow = {
  label: string;
  searchQuery: string;
  tasteTags: string[];
};

/** Nine rows in matrix order (Parisian…Bold, Wildcard). */
function fallbackTable(
  mode: OutfitGridMode,
  bucket: GenderBucket,
): FallbackRow[] {
  if (mode === "worn") {
    if (bucket === "masculine") return WORN_MASCULINE;
    if (bucket === "androgynous") return WORN_ANDROGYNOUS;
    return WORN_FEMININE;
  }
  if (bucket === "masculine") return ASPIRATIONAL_MASCULINE;
  if (bucket === "androgynous") return ASPIRATIONAL_ANDROGYNOUS;
  return ASPIRATIONAL_FEMININE;
}

export function fallbackSlotsForMatrix(params: {
  mode: OutfitGridMode;
  genderPresentation?: string;
  lifestyleTags?: string[];
}): OutfitGridSlot[] {
  const matrix = buildCastingMatrix(params.lifestyleTags);
  const rows = fallbackTable(params.mode, genderBucket(params.genderPresentation));
  return matrix.map((cell, i) => {
    const row = rows[i] ?? rows[rows.length - 1]!;
    return {
      cell: cell.cell,
      archetype: cell.archetype,
      label: row.label,
      searchQuery: row.searchQuery,
      tasteTags: [...row.tasteTags, cell.archetype.toLowerCase()],
    };
  });
}

const WORN_FEMININE: FallbackRow[] = [
  { label: "café trench + knit", searchQuery: "women's trench coat knit sweater café outfit look", tasteTags: ["trench", "knit", "parisian"] },
  { label: "black column dress", searchQuery: "women's black column dress minimal styled outfit", tasteTags: ["black", "column", "minimal"] },
  { label: "soft blouse + skirt", searchQuery: "women's romantic blouse midi skirt soft outfit", tasteTags: ["blouse", "skirt", "romantic"] },
  { label: "denim + sneakers", searchQuery: "women's denim jacket jeans sneakers street look", tasteTags: ["denim", "sneakers", "street"] },
  { label: "blazer + trousers", searchQuery: "women's blazer tailored trousers classic outfit", tasteTags: ["blazer", "trousers", "classic"] },
  { label: "knit + joggers", searchQuery: "women's knit hoodie joggers athleisure set", tasteTags: ["knit", "joggers", "sporty"] },
  { label: "linen shirt set", searchQuery: "women's linen shirt wide pants relaxed set", tasteTags: ["linen", "relaxed", "boho"] },
  { label: "graphic tee + leather", searchQuery: "women's graphic tee leather jacket bold outfit", tasteTags: ["graphic", "leather", "bold"] },
  { label: "hoodie + leggings", searchQuery: "women's hoodie leggings comfort weekend outfit", tasteTags: ["hoodie", "leggings", "comfort"] },
];

const WORN_MASCULINE: FallbackRow[] = [
  { label: "trench + knit polo", searchQuery: "men's trench coat knit polo café outfit look", tasteTags: ["trench", "polo", "parisian"] },
  { label: "black tee + trousers", searchQuery: "men's black tee tailored trousers minimal outfit", tasteTags: ["black", "trousers", "minimal"] },
  { label: "soft shirt + chinos", searchQuery: "men's soft oxford shirt chinos casual outfit", tasteTags: ["oxford", "chinos", "romantic"] },
  { label: "denim on denim", searchQuery: "men's denim jacket jeans sneakers street look", tasteTags: ["denim", "jeans", "street"] },
  { label: "blazer + chinos", searchQuery: "men's blazer chinos classic smart casual outfit", tasteTags: ["blazer", "chinos", "classic"] },
  { label: "hoodie + joggers", searchQuery: "men's hoodie joggers athleisure set styled", tasteTags: ["hoodie", "joggers", "sporty"] },
  { label: "linen shirt shorts", searchQuery: "men's linen shirt shorts coastal set look", tasteTags: ["linen", "shorts", "boho"] },
  { label: "statement jacket + tee", searchQuery: "men's statement jacket graphic tee bold outfit", tasteTags: ["jacket", "tee", "bold"] },
  { label: "hoodie + jeans", searchQuery: "men's hoodie jeans comfort weekend outfit look", tasteTags: ["hoodie", "jeans", "comfort"] },
];

const WORN_ANDROGYNOUS: FallbackRow[] = [
  { label: "boxy trench + tee", searchQuery: "gender-neutral boxy trench tee café outfit look", tasteTags: ["trench", "tee", "parisian"] },
  { label: "black column layers", searchQuery: "gender-neutral black layered column minimal outfit", tasteTags: ["black", "layers", "minimal"] },
  { label: "soft shirt + wide pants", searchQuery: "gender-neutral soft shirt wide pants outfit look", tasteTags: ["shirt", "wide-pants", "romantic"] },
  { label: "denim + sneakers", searchQuery: "gender-neutral denim jacket jeans sneakers street look", tasteTags: ["denim", "sneakers", "street"] },
  { label: "blazer + trousers", searchQuery: "gender-neutral blazer trousers classic outfit styled", tasteTags: ["blazer", "trousers", "classic"] },
  { label: "knit + track pants", searchQuery: "gender-neutral knit set track pants athleisure look", tasteTags: ["knit", "track", "sporty"] },
  { label: "linen co-ord set", searchQuery: "gender-neutral linen co-ord shirt pants set", tasteTags: ["linen", "coord", "boho"] },
  { label: "leather + graphic", searchQuery: "gender-neutral leather jacket graphic tee bold outfit", tasteTags: ["leather", "graphic", "bold"] },
  { label: "hoodie + easy pants", searchQuery: "gender-neutral hoodie easy pants comfort outfit", tasteTags: ["hoodie", "pants", "comfort"] },
];

const ASPIRATIONAL_FEMININE: FallbackRow[] = [
  { label: "quiet-luxury airport", searchQuery: "women's quiet luxury cashmere travel outfit look", tasteTags: ["quiet-luxury", "travel", "parisian"] },
  { label: "gallery black column", searchQuery: "women's minimalist black gallery outfit styled", tasteTags: ["gallery", "black", "minimal"] },
  { label: "garden party dress", searchQuery: "women's romantic garden party dress outfit look", tasteTags: ["garden", "dress", "romantic"] },
  { label: "street-sharp night", searchQuery: "women's street style sharp leather outfit look", tasteTags: ["street", "leather", "sharp"] },
  { label: "tailored suit day", searchQuery: "women's classic tailored suit styled outfit", tasteTags: ["suit", "tailored", "classic"] },
  { label: "clean athleisure set", searchQuery: "women's elevated clean athleisure matching set", tasteTags: ["athleisure", "clean", "sporty"] },
  { label: "boho festival layers", searchQuery: "women's boho festival layered outfit look", tasteTags: ["boho", "festival", "layers"] },
  { label: "sequin evening hit", searchQuery: "women's sequin evening party dress bold look", tasteTags: ["sequin", "evening", "bold"] },
  { label: "architect coat moment", searchQuery: "women's architectural statement coat outfit styled", tasteTags: ["coat", "statement", "stretch"] },
];

const ASPIRATIONAL_MASCULINE: FallbackRow[] = [
  { label: "quiet-luxury airport", searchQuery: "men's quiet luxury cashmere travel outfit look", tasteTags: ["quiet-luxury", "travel", "parisian"] },
  { label: "gallery black kit", searchQuery: "men's minimalist black gallery outfit styled", tasteTags: ["gallery", "black", "minimal"] },
  { label: "soft evening shirt", searchQuery: "men's soft evening shirt trousers outfit look", tasteTags: ["evening", "shirt", "romantic"] },
  { label: "street-sharp night", searchQuery: "men's streetwear sharp leather outfit look", tasteTags: ["street", "leather", "sharp"] },
  { label: "tailored suit day", searchQuery: "men's classic tailored suit styled outfit", tasteTags: ["suit", "tailored", "classic"] },
  { label: "clean athleisure set", searchQuery: "men's elevated clean athleisure matching set", tasteTags: ["athleisure", "clean", "sporty"] },
  { label: "coastal linen set", searchQuery: "men's coastal linen shirt trousers set look", tasteTags: ["linen", "coastal", "boho"] },
  { label: "black-tie adjacent", searchQuery: "men's dinner jacket tuxedo formal outfit look", tasteTags: ["dinner", "formal", "bold"] },
  { label: "architect coat moment", searchQuery: "men's architectural statement coat outfit styled", tasteTags: ["coat", "statement", "stretch"] },
];

const ASPIRATIONAL_ANDROGYNOUS: FallbackRow[] = [
  { label: "quiet-luxury airport", searchQuery: "gender-neutral quiet luxury cashmere travel outfit look", tasteTags: ["quiet-luxury", "travel", "parisian"] },
  { label: "gallery black column", searchQuery: "gender-neutral minimalist black gallery outfit styled", tasteTags: ["gallery", "black", "minimal"] },
  { label: "soft evening layers", searchQuery: "gender-neutral soft evening shirt wide pants outfit", tasteTags: ["evening", "soft", "romantic"] },
  { label: "street-sharp night", searchQuery: "gender-neutral street sharp leather outfit look", tasteTags: ["street", "leather", "sharp"] },
  { label: "tailored suit day", searchQuery: "gender-neutral classic tailored suit styled outfit", tasteTags: ["suit", "tailored", "classic"] },
  { label: "clean athleisure set", searchQuery: "gender-neutral elevated clean athleisure set look", tasteTags: ["athleisure", "clean", "sporty"] },
  { label: "linen resort set", searchQuery: "gender-neutral linen resort co-ord set look", tasteTags: ["linen", "resort", "boho"] },
  { label: "statement evening", searchQuery: "gender-neutral statement evening jacket bold outfit", tasteTags: ["evening", "jacket", "bold"] },
  { label: "architect coat moment", searchQuery: "gender-neutral architectural statement coat outfit styled", tasteTags: ["coat", "statement", "stretch"] },
];
