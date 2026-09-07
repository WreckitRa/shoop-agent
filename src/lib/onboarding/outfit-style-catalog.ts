/**
 * In-house onboarding style catalog for worn / aspirational grids.
 * Curated STYLE list — not Shopify. Looks are mode-agnostic:
 * worn vs wanted is decided by the quiz step + ranker, not by the asset.
 * Photos: public/onboarding/outfits/{id}.jpg → /onboarding/outfits/{id}.jpg
 */

import {
  STYLE_MIX_AXES,
  type CastingArchetype,
} from "./outfit-grid-matrix";
import type { StyleEraValue } from "./form-options";

export type OutfitGenderBucket =
  | "feminine"
  | "masculine"
  | "androgynous"
  | "any";

export type OutfitFormality = "casual" | "smart" | "formal" | "athletic";

export type StyleFamilyId =
  | "androgynous_tailoring"
  | "athleisure"
  | "body_conscious"
  | "bohemian"
  | "classic_polished"
  | "dressy_occasion"
  | "edgy"
  | "effortless_minimal"
  | "evening_out"
  | "grunge"
  | "layered"
  | "oversized_relaxed"
  | "preppy"
  | "print_pattern"
  | "relaxed_denim"
  | "resort_holiday"
  | "smart_casual"
  | "soft_masc"
  | "sporty"
  | "streetwear"
  | "utility_practical"
  | "vintage_leaning"
  | "workwear_pro";

export type OutfitStyleLook = {
  id: string;
  imageUrl: string;
  family: StyleFamilyId;
  genders: OutfitGenderBucket[];
  eras: StyleEraValue[];
  archetypes: CastingArchetype[];
  label: string;
  title?: string;
  tasteTags: string[];
  lifestyles: string[];
  spend: string[];
  formality: OutfitFormality;
  colorFamily: string;
};

export const OUTFIT_PHOTO_PUBLIC_DIR = "public/onboarding/outfits";
export const OUTFIT_PHOTO_URL_PREFIX = "/onboarding/outfits";

export function outfitPhotoUrl(
  id: string,
  ext: "webp" | "jpg" | "png" = "jpg",
) {
  return `${OUTFIT_PHOTO_URL_PREFIX}/${id}.${ext}`;
}

const photo = (id: string) => outfitPhotoUrl(id, "jpg");

type FamilyDef = {
  label: string;
  archetypes: CastingArchetype[];
  eras: StyleEraValue[];
  lifestyles: string[];
  spend: string[];
  formality: OutfitFormality;
  colorFamily: string;
  tasteTags: string[];
};

const ALL_ADULT: StyleEraValue[] = [
  "18_22",
  "23_29",
  "30s",
  "40s",
];
const YOUNG: StyleEraValue[] = ["15_17", "18_22", "23_29", "30s"];
const CAMPUS: StyleEraValue[] = ["13_14", "15_17", "18_22", "23_29"];
const PRIME: StyleEraValue[] = ["23_29", "30s", "40s"];
const POLISHED: StyleEraValue[] = ["23_29", "30s", "40s", "50s_60s", "65_plus"];
const MATURE: StyleEraValue[] = ["30s", "40s", "50s_60s", "65_plus"];

const FAMILIES: Record<StyleFamilyId, FamilyDef> = {
  effortless_minimal: {
    label: "Effortless minimal",
    archetypes: ["Minimal"],
    eras: POLISHED,
    lifestyles: ["deep_in_career", "first_job", "running_the_show"],
    spend: ["premium", "design_first", "best_value"],
    formality: "smart",
    colorFamily: "grey",
    tasteTags: ["minimal", "clean", "neutral", "quiet"],
  },
  classic_polished: {
    label: "Classic and polished",
    archetypes: ["Classic", "Parisian"],
    eras: POLISHED,
    lifestyles: ["deep_in_career", "running_the_show"],
    spend: ["premium", "luxury"],
    formality: "smart",
    colorFamily: "navy",
    tasteTags: ["classic", "polished", "blazer", "tailored"],
  },
  workwear_pro: {
    label: "Workwear professional",
    archetypes: ["Classic"],
    eras: POLISHED,
    lifestyles: ["deep_in_career", "first_job", "running_the_show"],
    spend: ["premium", "luxury", "best_value"],
    formality: "formal",
    colorFamily: "charcoal",
    tasteTags: ["suit", "tailored", "work", "blazer"],
  },
  smart_casual: {
    label: "Smart casual",
    archetypes: ["Classic", "Parisian"],
    eras: ALL_ADULT,
    lifestyles: ["deep_in_career", "first_job"],
    spend: ["premium", "best_value", "design_first"],
    formality: "smart",
    colorFamily: "navy",
    tasteTags: ["blazer", "smart", "casual", "clean"],
  },
  preppy: {
    label: "Preppy",
    archetypes: ["Classic"],
    eras: [...CAMPUS, "30s"],
    lifestyles: ["campus_life", "first_job"],
    spend: ["premium", "best_value"],
    formality: "smart",
    colorFamily: "navy",
    tasteTags: ["preppy", "polo", "collegiate", "classic"],
  },
  relaxed_denim: {
    label: "Relaxed denim",
    archetypes: ["Street"],
    eras: YOUNG,
    lifestyles: ["campus_life", "kids_in_the_mix", "first_job"],
    spend: ["best_value", "deal_hunter", "design_first"],
    formality: "casual",
    colorFamily: "indigo",
    tasteTags: ["denim", "jeans", "casual", "relaxed"],
  },
  streetwear: {
    label: "Streetwear",
    archetypes: ["Street"],
    eras: [...CAMPUS, "30s"],
    lifestyles: ["campus_life", "first_job"],
    spend: ["best_value", "design_first", "deal_hunter"],
    formality: "casual",
    colorFamily: "black",
    tasteTags: ["street", "hoodie", "sneakers", "urban"],
  },
  grunge: {
    label: "Grunge",
    archetypes: ["Street", "Bold"],
    eras: YOUNG,
    lifestyles: ["campus_life"],
    spend: ["best_value", "deal_hunter", "design_first"],
    formality: "casual",
    colorFamily: "earth",
    tasteTags: ["grunge", "flannel", "denim", "edge"],
  },
  edgy: {
    label: "Edgy",
    archetypes: ["Bold"],
    eras: YOUNG,
    lifestyles: [],
    spend: ["design_first", "premium"],
    formality: "casual",
    colorFamily: "black",
    tasteTags: ["edgy", "leather", "black", "sharp"],
  },
  athleisure: {
    label: "Athleisure",
    archetypes: ["Sporty"],
    eras: [...YOUNG, "40s"],
    lifestyles: ["kids_in_the_mix", "campus_life", "time_is_mine"],
    spend: ["best_value", "deal_hunter", "premium"],
    formality: "athletic",
    colorFamily: "cream",
    tasteTags: ["athleisure", "hoodie", "knit", "easy"],
  },
  sporty: {
    label: "Sporty",
    archetypes: ["Sporty"],
    eras: YOUNG,
    lifestyles: ["campus_life", "kids_in_the_mix", "time_is_mine"],
    spend: ["best_value", "deal_hunter"],
    formality: "athletic",
    colorFamily: "black",
    tasteTags: ["sporty", "hoodie", "joggers", "sneakers"],
  },
  bohemian: {
    label: "Bohemian",
    archetypes: ["Boho"],
    eras: PRIME,
    lifestyles: ["time_is_mine"],
    spend: ["design_first", "premium", "best_value"],
    formality: "casual",
    colorFamily: "earth",
    tasteTags: ["boho", "print", "relaxed", "earth"],
  },
  oversized_relaxed: {
    label: "Oversized and relaxed",
    archetypes: ["Boho", "Wildcard"],
    eras: [...YOUNG, "40s"],
    lifestyles: ["campus_life", "kids_in_the_mix", "time_is_mine"],
    spend: ["best_value", "design_first"],
    formality: "casual",
    colorFamily: "cream",
    tasteTags: ["oversized", "relaxed", "hoodie", "easy"],
  },
  resort_holiday: {
    label: "Resort and holiday",
    archetypes: ["Boho", "Parisian"],
    eras: [...PRIME, "50s_60s"],
    lifestyles: ["time_is_mine"],
    spend: ["premium", "design_first", "luxury"],
    formality: "casual",
    colorFamily: "sand",
    tasteTags: ["linen", "resort", "holiday", "coastal"],
  },
  print_pattern: {
    label: "Print and pattern",
    archetypes: ["Bold", "Romantic"],
    eras: PRIME,
    lifestyles: [],
    spend: ["design_first", "premium"],
    formality: "smart",
    colorFamily: "bright",
    tasteTags: ["print", "pattern", "bold", "statement"],
  },
  vintage_leaning: {
    label: "Vintage-leaning",
    archetypes: ["Romantic", "Wildcard"],
    eras: [...PRIME, "50s_60s"],
    lifestyles: ["time_is_mine"],
    spend: ["design_first", "premium", "best_value"],
    formality: "smart",
    colorFamily: "earth",
    tasteTags: ["vintage", "retro", "texture", "character"],
  },
  layered: {
    label: "Layered",
    archetypes: ["Wildcard", "Minimal"],
    eras: ALL_ADULT,
    lifestyles: [],
    spend: ["design_first", "premium"],
    formality: "smart",
    colorFamily: "cream",
    tasteTags: ["layers", "drape", "texture", "sculptural"],
  },
  utility_practical: {
    label: "Utility and practical",
    archetypes: ["Street", "Wildcard"],
    eras: ALL_ADULT,
    lifestyles: ["kids_in_the_mix", "first_job"],
    spend: ["best_value", "design_first"],
    formality: "casual",
    colorFamily: "olive",
    tasteTags: ["utility", "cargo", "practical", "workwear"],
  },
  body_conscious: {
    label: "Body-conscious",
    archetypes: ["Romantic", "Bold"],
    eras: PRIME,
    lifestyles: [],
    spend: ["premium", "design_first", "luxury"],
    formality: "smart",
    colorFamily: "white",
    tasteTags: ["fitted", "knit", "body", "sculptural"],
  },
  dressy_occasion: {
    label: "Dressy occasion",
    archetypes: ["Bold", "Romantic"],
    eras: [...PRIME, "50s_60s"],
    lifestyles: ["running_the_show"],
    spend: ["luxury", "premium", "design_first"],
    formality: "formal",
    colorFamily: "emerald",
    tasteTags: ["occasion", "dressy", "evening", "formal"],
  },
  evening_out: {
    label: "Evening and going out",
    archetypes: ["Bold", "Parisian"],
    eras: PRIME,
    lifestyles: [],
    spend: ["luxury", "premium", "design_first"],
    formality: "formal",
    colorFamily: "black",
    tasteTags: ["evening", "night", "glam", "sharp"],
  },
  androgynous_tailoring: {
    label: "Androgynous tailoring",
    archetypes: ["Classic", "Minimal"],
    eras: [...ALL_ADULT, "50s_60s"],
    lifestyles: ["deep_in_career", "first_job"],
    spend: ["premium", "design_first", "luxury"],
    formality: "smart",
    colorFamily: "black",
    tasteTags: ["tailored", "androgynous", "suit", "sharp"],
  },
  soft_masc: {
    label: "Soft masc",
    archetypes: ["Minimal", "Street"],
    eras: ALL_ADULT,
    lifestyles: ["first_job"],
    spend: ["design_first", "premium", "best_value"],
    formality: "casual",
    colorFamily: "grey",
    tasteTags: ["soft-masc", "relaxed", "tailored", "neutral"],
  },
};

/** Families that read well on an androgynous / "both" rail. */
const ANDROGYNOUS_FAMILIES = new Set<StyleFamilyId>([
  "androgynous_tailoring",
  "soft_masc",
  "oversized_relaxed",
  "streetwear",
  "effortless_minimal",
  "utility_practical",
  "smart_casual",
  "layered",
]);

export const CAMPUS_STYLE_FAMILIES = new Set<StyleFamilyId>([
  "streetwear",
  "sporty",
  "athleisure",
  "oversized_relaxed",
  "relaxed_denim",
  "grunge",
  "preppy",
]);

export const POLISHED_STYLE_FAMILIES = new Set<StyleFamilyId>([
  "classic_polished",
  "workwear_pro",
  "smart_casual",
  "effortless_minimal",
  "evening_out",
  "dressy_occasion",
]);

const WOMEN_COUNTS: Record<StyleFamilyId, number> = {
  androgynous_tailoring: 3,
  athleisure: 4,
  body_conscious: 3,
  bohemian: 4,
  classic_polished: 4,
  dressy_occasion: 3,
  edgy: 1,
  effortless_minimal: 4,
  evening_out: 2,
  grunge: 4,
  layered: 4,
  oversized_relaxed: 4,
  preppy: 4,
  print_pattern: 4,
  relaxed_denim: 4,
  resort_holiday: 6,
  smart_casual: 4,
  soft_masc: 2,
  sporty: 4,
  streetwear: 4,
  utility_practical: 4,
  vintage_leaning: 4,
  workwear_pro: 4,
};

type MenGroup = {
  uuid: string;
  family: StyleFamilyId;
  n: number;
  start?: number;
};

const MEN_GROUPS: MenGroup[] = [
  { uuid: "c91fa476", family: "sporty", n: 4 },
  { uuid: "4791bb95", family: "utility_practical", n: 4 },
  { uuid: "778f5e74", family: "oversized_relaxed", n: 4 },
  { uuid: "083037f5", family: "resort_holiday", n: 4 },
  { uuid: "ed6f58bd", family: "effortless_minimal", n: 4 },
  { uuid: "c4363126", family: "athleisure", n: 4 },
  { uuid: "64a57eab", family: "resort_holiday", n: 4 },
  { uuid: "a0aade79", family: "oversized_relaxed", n: 4 },
  { uuid: "62dc540e", family: "preppy", n: 4 },
  { uuid: "8725b3dd", family: "vintage_leaning", n: 4 },
  { uuid: "bf10185b", family: "print_pattern", n: 4 },
  { uuid: "da9e8329", family: "resort_holiday", n: 4 },
  { uuid: "c41b0989", family: "smart_casual", n: 4 },
  { uuid: "447f7d7f", family: "effortless_minimal", n: 4 },
  { uuid: "4f9e5537", family: "oversized_relaxed", n: 4 },
  { uuid: "9dab19fd", family: "smart_casual", n: 4 },
  { uuid: "c28eb960", family: "workwear_pro", n: 4 },
  { uuid: "2b726fc9", family: "classic_polished", n: 4 },
  { uuid: "426d685a", family: "smart_casual", n: 4 },
  { uuid: "56bfbfae", family: "effortless_minimal", n: 4 },
  { uuid: "24d523cd", family: "smart_casual", n: 4 },
  { uuid: "296f4575", family: "effortless_minimal", n: 4 },
  { uuid: "d3b14f87", family: "effortless_minimal", n: 4 },
  { uuid: "321fa065", family: "classic_polished", n: 4 },
  { uuid: "845293f1", family: "evening_out", n: 4 },
  { uuid: "05fe44d7", family: "evening_out", n: 4 },
  { uuid: "5ed59845", family: "dressy_occasion", n: 4 },
  { uuid: "58b9ef07", family: "layered", n: 4 },
  { uuid: "9ebdc30f", family: "athleisure", n: 4 },
  { uuid: "594c935f", family: "streetwear", n: 4 },
  { uuid: "8ccf1557", family: "oversized_relaxed", n: 4 },
  { uuid: "77fcd7ac", family: "streetwear", n: 4 },
  { uuid: "b7ba45d8", family: "smart_casual", n: 4 },
  { uuid: "5df0c2c8", family: "oversized_relaxed", n: 4 },
  { uuid: "95905802", family: "edgy", n: 4 },
  { uuid: "685d316f", family: "streetwear", n: 4 },
  { uuid: "a83282fc", family: "streetwear", n: 4 },
  { uuid: "e140c840", family: "effortless_minimal", n: 4 },
  { uuid: "a462d546", family: "smart_casual", n: 4 },
  { uuid: "5ca40f22", family: "preppy", n: 4 },
  { uuid: "5b1f0418", family: "resort_holiday", n: 4 },
  { uuid: "e0040533", family: "athleisure", n: 4 },
  { uuid: "f1653c6a", family: "athleisure", n: 4 },
  { uuid: "5448b4e8", family: "resort_holiday", n: 1, start: 1 },
  { uuid: "5f5d9fc2", family: "sporty", n: 4 },
];

const COLOR_SHIFT = [
  "grey",
  "navy",
  "black",
  "cream",
  "earth",
  "indigo",
  "camel",
] as const;

function gendersFor(
  dept: "feminine" | "masculine",
  family: StyleFamilyId,
): OutfitGenderBucket[] {
  if (ANDROGYNOUS_FAMILIES.has(family)) return [dept, "androgynous"];
  return [dept];
}

function lookOf(params: {
  id: string;
  family: StyleFamilyId;
  dept: "feminine" | "masculine";
  colorShift: number;
}): OutfitStyleLook {
  const fam = FAMILIES[params.family];
  return {
    id: params.id,
    imageUrl: photo(params.id),
    family: params.family,
    genders: gendersFor(params.dept, params.family),
    eras: fam.eras,
    archetypes: fam.archetypes,
    label: fam.label,
    tasteTags: fam.tasteTags,
    lifestyles: fam.lifestyles,
    spend: fam.spend,
    formality: fam.formality,
    colorFamily: COLOR_SHIFT[params.colorShift % COLOR_SHIFT.length]!,
  };
}

function buildLooks(): OutfitStyleLook[] {
  const looks: OutfitStyleLook[] = [];
  for (const family of Object.keys(WOMEN_COUNTS) as StyleFamilyId[]) {
    const count = WOMEN_COUNTS[family];
    for (let i = 1; i <= count; i += 1) {
      const num = String(i).padStart(2, "0");
      looks.push(
        lookOf({
          id: `f-${family}-${num}`,
          family,
          dept: "feminine",
          colorShift: i - 1,
        }),
      );
    }
  }
  for (const group of MEN_GROUPS) {
    const start = group.start ?? 0;
    for (let i = 0; i < group.n; i += 1) {
      const idx = start + i;
      looks.push(
        lookOf({
          id: `m-${group.family}-${group.uuid}-${idx}`,
          family: group.family,
          dept: "masculine",
          colorShift: idx,
        }),
      );
    }
  }
  return looks;
}

export const INHOUSE_OUTFIT_LOOKS: OutfitStyleLook[] = buildLooks();

export function getInhouseOutfitLooks(): readonly OutfitStyleLook[] {
  return INHOUSE_OUTFIT_LOOKS;
}

const AXIS_SLUGS = new Set(
  STYLE_MIX_AXES.map((a) => a.toLowerCase()),
);

/** Map a stored worn/wanted token onto the look label the user picked. */
function styleFamilyLabelFromToken(
  tag: string,
  soup: boolean,
): string | null {
  const raw = tag.trim().toLowerCase();
  if (!raw) return null;
  const slug = raw.replace(/[\s-]+/g, "_");
  const asLabel = raw.replace(/[_-]+/g, " ");
  for (const id of Object.keys(FAMILIES) as StyleFamilyId[]) {
    const fam = FAMILIES[id];
    const labelLc = fam.label.toLowerCase();
    const axisId = AXIS_SLUGS.has(id);
    if (slug === id || raw === id) {
      if (soup && axisId) return null;
      return fam.label;
    }
    if (raw === labelLc || asLabel === labelLc) {
      if (soup && axisId && !labelLc.includes(" ")) return null;
      return fam.label;
    }
  }
  return null;
}

/**
 * Worn/wanted tags sent to the stylist must be the looks they selected,
 * not the catalog crumbs (family id, archetype, tasteTags) exploded onto each card.
 */
export function selectedOutfitLookLabels(tags: string[]): string[] {
  const cleaned: string[] = [];
  const seenRaw = new Set<string>();
  for (const tag of tags) {
    const t = tag.trim();
    if (t.length < 2) continue;
    const k = t.toLowerCase();
    if (seenRaw.has(k)) continue;
    seenRaw.add(k);
    cleaned.push(t);
  }
  const soup =
    cleaned.length > 6 || cleaned.some((t) => t.includes("_"));
  const mapped: string[] = [];
  const seenLabel = new Set<string>();
  for (const tag of cleaned) {
    const label = styleFamilyLabelFromToken(tag, soup);
    if (!label) continue;
    const k = label.toLowerCase();
    if (seenLabel.has(k)) continue;
    seenLabel.add(k);
    mapped.push(label);
  }
  if (soup) return mapped.length ? mapped : cleaned.slice(0, 6);
  return mapped.length === cleaned.length ? mapped : cleaned;
}
