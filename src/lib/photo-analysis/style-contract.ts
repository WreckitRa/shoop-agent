/**
 * Shared vocabulary between the verdict, catalog search, and try-on.
 * Colour families are the existing COLOR_BUCKETS (minus unknown) — never
 * merchant Color attribute strings.
 */

import { COLOR_BUCKETS, type ColorBucket } from "@/lib/fashion-memory/normalize/types";
import {
  displayHexForFamily,
  isLegacySilentFallback,
  parseHexOrNull,
} from "./family-hex";

export type ColorFamily = Exclude<ColorBucket, "unknown">;

export const COLOR_FAMILIES = COLOR_BUCKETS.filter(
  (b): b is ColorFamily => b !== "unknown",
);

/** Verdict page always generates and shows this many looks. */
export const FITTING_LOOK_COUNT = 5;

export const SLOTS = [
  "top",
  "bottom",
  "outerwear",
  "shoes",
  "one_piece",
] as const;
export type Slot = (typeof SLOTS)[number];

export const GARMENT_TYPES = [
  "tee",
  "polo",
  "shirt",
  "overshirt",
  "knit",
  "sweatshirt",
  "hoodie",
  "blouse",
  "tank",
  "bodysuit",
  "jeans",
  "chinos",
  "trousers",
  "shorts",
  "skirt",
  "blazer",
  "jacket",
  "coat",
  "trench",
  "cardigan",
  "dress",
  "jumpsuit",
  "shirt_dress",
  "sneakers",
  "loafers",
  "boots",
  "sandals",
  "heels",
  "dress_shoes",
] as const;
export type GarmentType = (typeof GARMENT_TYPES)[number];

export const TOP_FITS = ["close", "regular", "relaxed", "oversized"] as const;
export type TopFit = (typeof TOP_FITS)[number];

export const BOTTOM_FITS = ["slim", "straight", "relaxed", "wide"] as const;
export type BottomFit = (typeof BOTTOM_FITS)[number];

export const RISES = ["mid", "high"] as const;
export type Rise = (typeof RISES)[number];

export const STRUCTURES = ["soft", "medium", "sharp"] as const;
export type Structure = (typeof STRUCTURES)[number];

export const NECKLINES = [
  "crew",
  "v",
  "henley",
  "collar",
  "polo",
  "mock",
  "scoop",
  "square",
  "boat",
] as const;
export type Neckline = (typeof NECKLINES)[number];

export const PATTERN_SCALES = ["none", "small", "medium", "bold"] as const;
export type PatternScale = (typeof PATTERN_SCALES)[number];

const GARMENT_SLOT: Record<GarmentType, Slot> = {
  tee: "top",
  polo: "top",
  shirt: "top",
  overshirt: "top",
  knit: "top",
  sweatshirt: "top",
  hoodie: "top",
  blouse: "top",
  tank: "top",
  bodysuit: "top",
  jeans: "bottom",
  chinos: "bottom",
  trousers: "bottom",
  shorts: "bottom",
  skirt: "bottom",
  blazer: "outerwear",
  jacket: "outerwear",
  coat: "outerwear",
  trench: "outerwear",
  cardigan: "outerwear",
  dress: "one_piece",
  jumpsuit: "one_piece",
  shirt_dress: "one_piece",
  sneakers: "shoes",
  loafers: "shoes",
  boots: "shoes",
  sandals: "shoes",
  heels: "shoes",
  dress_shoes: "shoes",
};

export function slotForGarment(type: GarmentType): Slot {
  return GARMENT_SLOT[type];
}

const FAMILY_SET = new Set<string>(COLOR_FAMILIES);
const GARMENT_SET = new Set<string>(GARMENT_TYPES);
const SLOT_SET = new Set<string>(SLOTS);
const NECKLINE_SET = new Set<string>(NECKLINES);

const FAMILY_ALIAS: Record<string, ColorFamily> = {
  gray: "grey",
  grey: "grey",
  multicolor: "multi",
  multicolour: "multi",
  cream: "white",
  ivory: "white",
  ecru: "white",
  offwhite: "white",
  "off-white": "white",
  camel: "beige",
  tan: "beige",
  khaki: "beige",
  chocolate: "brown",
  rust: "orange",
  terracotta: "orange",
  "ink navy": "navy",
  inknavy: "navy",
};

export function coerceColorFamily(raw: string | null | undefined): ColorFamily | null {
  if (!raw?.trim()) return null;
  const t = raw.trim().toLowerCase().replace(/[_]+/g, " ").trim();
  const compact = t.replace(/\s+/g, "");
  const aliased = FAMILY_ALIAS[t] ?? FAMILY_ALIAS[compact];
  if (aliased) return aliased;
  const underscored = t.replace(/\s+/g, "_");
  if (FAMILY_SET.has(underscored)) return underscored as ColorFamily;
  return null;
}

export type PaletteSwatch = {
  family: ColorFamily;
  shade: string;
  /** Filled from a valid model hex, else from family+shade. Never a silent camel. */
  hex: string | null;
};

export type AvoidSwatch = PaletteSwatch & {
  why: string;
  fix: string;
};

export type ContractPiece = {
  slot: Slot;
  garment_type: GarmentType;
  color_family: ColorFamily;
  shade: string;
  fallback_family: ColorFamily | null;
  fit: TopFit | BottomFit | null;
  neckline: Neckline | null;
  must_have: string[];
  must_not: string[];
};

export type ContractLook = {
  name: string;
  occasion_from: string;
  pieces: ContractPiece[];
};

export type StyleContract = {
  palette: {
    near_face: PaletteSwatch[];
    core: PaletteSwatch[];
    neutrals: PaletteSwatch[];
    accents: PaletteSwatch[];
    avoid_near_face: AvoidSwatch[];
  };
  silhouette: {
    top_fit: TopFit;
    bottom_fit: BottomFit;
    rise: Rise;
    structure: Structure;
    length_notes: string[];
  };
  necklines: { yes: Neckline[]; no: Neckline[] };
  fabrics: { yes: string[]; no: string[] };
  patterns: { scale: PatternScale; yes: string[]; no: string[] };
  vetoes: string[];
  looks: ContractLook[];
};

export type FittingReading = {
  headline: string;
  who_you_are: string;
  the_shift: string;
  rules: Array<{ rule: string; why: string }>;
  this_week: string;
  full_profile: string;
};

export type FittingVerdict = {
  reading: FittingReading;
  contract: StyleContract;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStrs(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = asStr(item);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function asEnum<T extends string>(
  v: unknown,
  allowed: ReadonlySet<string>,
): T | null {
  const s = asStr(v).toLowerCase().replace(/\s+/g, "_");
  return allowed.has(s) ? (s as T) : null;
}

function parseSwatch(raw: unknown): PaletteSwatch | null {
  if (!isRecord(raw)) return null;
  const family = coerceColorFamily(asStr(raw.family) || asStr(raw.color_family));
  const shade = asStr(raw.shade) || asStr(raw.name);
  if (!family || !shade) return null;
  const parsed = parseHexOrNull(asStr(raw.hex) || asStr(raw.representative_hex));
  const hex =
    parsed && !isLegacySilentFallback(family, parsed)
      ? parsed
      : displayHexForFamily(family, shade);
  return { family, shade, hex };
}

function parseAvoid(raw: unknown): AvoidSwatch | null {
  const base = parseSwatch(raw);
  if (!base || !isRecord(raw)) return null;
  return {
    ...base,
    why: asStr(raw.why),
    fix: asStr(raw.fix),
  };
}

function parsePiece(raw: unknown): ContractPiece | null {
  if (!isRecord(raw)) return null;
  const garment = asEnum<GarmentType>(raw.garment_type, GARMENT_SET);
  if (!garment) return null;
  const slot =
    asEnum<Slot>(raw.slot, SLOT_SET) ?? slotForGarment(garment);
  const family = coerceColorFamily(asStr(raw.color_family));
  const shade = asStr(raw.shade);
  if (!family || !shade) return null;
  const fallbackRaw = asStr(raw.fallback_family);
  const neckline = asEnum<Neckline>(raw.neckline, NECKLINE_SET);
  const fitRaw = asStr(raw.fit).toLowerCase();
  const fit =
    (TOP_FITS as readonly string[]).includes(fitRaw) ||
    (BOTTOM_FITS as readonly string[]).includes(fitRaw)
      ? (fitRaw as TopFit | BottomFit)
      : null;
  return {
    slot,
    garment_type: garment,
    color_family: family,
    shade,
    fallback_family: fallbackRaw ? coerceColorFamily(fallbackRaw) : null,
    fit,
    neckline,
    must_have: asStrs(raw.must_have, 3),
    must_not: asStrs(raw.must_not, 12),
  };
}

function parseLook(raw: unknown): ContractLook | null {
  if (!isRecord(raw)) return null;
  const name = asStr(raw.name);
  if (!name) return null;
  const pieces = Array.isArray(raw.pieces)
    ? raw.pieces.map(parsePiece).filter((p): p is ContractPiece => Boolean(p))
    : [];
  if (!pieces.length) return null;
  return {
    name,
    occasion_from: asStr(raw.occasion_from),
    pieces,
  };
}

export function parseFittingReading(raw: unknown): FittingReading | null {
  if (!isRecord(raw)) return null;
  const headline = asStr(raw.headline);
  const who = asStr(raw.who_you_are);
  const shift = asStr(raw.the_shift);
  if (!headline || !who) return null;
  const rulesRaw = Array.isArray(raw.rules) ? raw.rules : [];
  const rules: Array<{ rule: string; why: string }> = [];
  for (const item of rulesRaw) {
    if (!isRecord(item)) continue;
    const rule = asStr(item.rule);
    if (!rule) continue;
    rules.push({ rule, why: asStr(item.why) });
    if (rules.length >= 3) break;
  }
  return {
    headline,
    who_you_are: who,
    the_shift: shift,
    rules,
    this_week: asStr(raw.this_week),
    full_profile: asStr(raw.full_profile),
  };
}

export function parseStyleContract(raw: unknown): StyleContract | null {
  if (!isRecord(raw)) return null;
  const palette = isRecord(raw.palette) ? raw.palette : null;
  if (!palette) return null;
  const near = Array.isArray(palette.near_face)
    ? palette.near_face.map(parseSwatch).filter((s): s is PaletteSwatch => Boolean(s))
    : [];
  const core = Array.isArray(palette.core)
    ? palette.core.map(parseSwatch).filter((s): s is PaletteSwatch => Boolean(s))
    : [];
  const neutrals = Array.isArray(palette.neutrals)
    ? palette.neutrals.map(parseSwatch).filter((s): s is PaletteSwatch => Boolean(s))
    : [];
  const accents = Array.isArray(palette.accents)
    ? palette.accents.map(parseSwatch).filter((s): s is PaletteSwatch => Boolean(s))
    : [];
  const avoid = Array.isArray(palette.avoid_near_face)
    ? palette.avoid_near_face.map(parseAvoid).filter((s): s is AvoidSwatch => Boolean(s))
    : [];
  const sil = isRecord(raw.silhouette) ? raw.silhouette : {};
  const neck = isRecord(raw.necklines) ? raw.necklines : {};
  const fab = isRecord(raw.fabrics) ? raw.fabrics : {};
  const pat = isRecord(raw.patterns) ? raw.patterns : {};
  const looks = Array.isArray(raw.looks)
    ? raw.looks.map(parseLook).filter((l): l is ContractLook => Boolean(l))
    : [];
  const yesNeck = asStrs(neck.yes)
    .map((n) => asEnum<Neckline>(n, NECKLINE_SET))
    .filter((n): n is Neckline => Boolean(n));
  const noNeck = asStrs(neck.no)
    .map((n) => asEnum<Neckline>(n, NECKLINE_SET))
    .filter((n): n is Neckline => Boolean(n));
  const scaleRaw = asStr(pat.scale).toLowerCase();
  const scale = (PATTERN_SCALES as readonly string[]).includes(scaleRaw)
    ? (scaleRaw as PatternScale)
    : "none";
  const topFitRaw = asStr(sil.top_fit).toLowerCase();
  const bottomFitRaw = asStr(sil.bottom_fit).toLowerCase();
  const riseRaw = asStr(sil.rise).toLowerCase();
  const structureRaw = asStr(sil.structure).toLowerCase();
  return {
    palette: {
      near_face: near,
      core,
      neutrals,
      accents,
      avoid_near_face: avoid,
    },
    silhouette: {
      top_fit: (TOP_FITS as readonly string[]).includes(topFitRaw)
        ? (topFitRaw as TopFit)
        : "regular",
      bottom_fit: (BOTTOM_FITS as readonly string[]).includes(bottomFitRaw)
        ? (bottomFitRaw as BottomFit)
        : "straight",
      rise: (RISES as readonly string[]).includes(riseRaw) ? (riseRaw as Rise) : "mid",
      structure: (STRUCTURES as readonly string[]).includes(structureRaw)
        ? (structureRaw as Structure)
        : "medium",
      length_notes: asStrs(sil.length_notes, 4),
    },
    necklines: { yes: yesNeck, no: noNeck },
    fabrics: { yes: asStrs(fab.yes, 8), no: asStrs(fab.no, 8) },
    patterns: {
      scale,
      yes: asStrs(pat.yes, 8),
      no: asStrs(pat.no, 8),
    },
    vetoes: asStrs(raw.vetoes, 12),
    looks,
  };
}

export function parseFittingVerdict(raw: unknown): FittingVerdict | null {
  if (!isRecord(raw)) return null;
  const reading = parseFittingReading(raw.reading);
  const contract = parseStyleContract(raw.contract);
  if (!reading || !contract) return null;
  return { reading, contract };
}

export function isFittingVerdict(raw: unknown): raw is FittingVerdict {
  return parseFittingVerdict(raw) != null;
}

function paletteFamilies(contract: StyleContract): Set<ColorFamily> {
  const out = new Set<ColorFamily>();
  for (const group of [
    contract.palette.near_face,
    contract.palette.core,
    contract.palette.neutrals,
    contract.palette.accents,
  ]) {
    for (const s of group) out.add(s.family);
  }
  return out;
}

function avoidFamilies(contract: StyleContract): Set<ColorFamily> {
  return new Set(contract.palette.avoid_near_face.map((s) => s.family));
}

function canonicalVetoTerms(vetoes: string[]): string[] {
  const out: string[] = [];
  for (const v of vetoes) {
    const t = v.toLowerCase();
    if (/\bcrop/.test(t)) out.push("crop");
    if (/\bheel/.test(t)) out.push("heels");
    if (/\bskinny/.test(t)) out.push("skinny");
    if (/\blogo/.test(t)) out.push("logo");
    if (/\bneon/.test(t)) out.push("neon");
    const trimmed = v.trim().toLowerCase();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function pieceMustNotHay(piece: ContractPiece): string {
  return piece.must_not.join(" ").toLowerCase();
}

/** Deterministic contract checks. Empty = valid enough to render. */
export function validateStyleContract(
  contract: StyleContract,
  opts?: { hasPhoto?: boolean; reading?: FittingReading | null },
): string[] {
  const violations: string[] = [];
  const families = paletteFamilies(contract);
  const avoid = avoidFamilies(contract);
  const hasPhoto = opts?.hasPhoto !== false;
  const looks = contract.looks;

  if (looks.length !== FITTING_LOOK_COUNT) {
    violations.push(`looks:${looks.length} (need ${FITTING_LOOK_COUNT})`);
  }
  if (hasPhoto && contract.palette.near_face.length < 1) {
    violations.push("near_face:empty");
  }
  if (hasPhoto && contract.palette.avoid_near_face.length !== 2) {
    violations.push(
      `avoid_near_face:${contract.palette.avoid_near_face.length} (need 2)`,
    );
  }

  const topKeys = new Set<string>();
  const topColors = new Set<string>();
  const vetoTerms = canonicalVetoTerms(contract.vetoes);
  const yesNeck = new Set(contract.necklines.yes);

  looks.forEach((look, i) => {
    const slots = look.pieces.map((p) => p.slot);
    const tops = slots.filter((s) => s === "top").length;
    const ones = slots.filter((s) => s === "one_piece").length;
    const bottoms = slots.filter((s) => s === "bottom").length;
    const shoes = slots.filter((s) => s === "shoes").length;
    if (tops > 1) violations.push(`look[${i}] two tops`);
    if (ones && tops) violations.push(`look[${i}] top + one_piece`);
    if (!ones && (!tops || !bottoms)) {
      violations.push(`look[${i}] needs top+bottom or one_piece`);
    }
    if (!shoes) violations.push(`look[${i}] missing shoes`);

    for (const piece of look.pieces) {
      if (slotForGarment(piece.garment_type) !== piece.slot) {
        violations.push(
          `look[${i}] ${piece.garment_type} is not a ${piece.slot}`,
        );
      }
      if (!families.has(piece.color_family)) {
        violations.push(
          `look[${i}] ${piece.garment_type} colour ${piece.color_family} not in palette`,
        );
      }
      if (
        piece.fallback_family &&
        !families.has(piece.fallback_family)
      ) {
        violations.push(
          `look[${i}] fallback ${piece.fallback_family} not in palette`,
        );
      }
      const nearFace =
        piece.slot === "top" ||
        piece.slot === "outerwear" ||
        piece.slot === "one_piece";
      if (hasPhoto && nearFace && avoid.has(piece.color_family)) {
        violations.push(
          `look[${i}] ${piece.color_family} is avoid_near_face on ${piece.slot}`,
        );
      }
      if (piece.neckline && yesNeck.size && !yesNeck.has(piece.neckline)) {
        violations.push(
          `look[${i}] neckline ${piece.neckline} not in necklines.yes`,
        );
      }
      const hay = pieceMustNotHay(piece);
      for (const term of vetoTerms) {
        if (term.length < 3) continue;
        if (!hay.includes(term)) {
          violations.push(`look[${i}] ${piece.garment_type} missing veto "${term}"`);
          break;
        }
      }
      if (piece.slot === "top" || piece.slot === "one_piece") {
        const key = `${piece.garment_type}:${piece.color_family}`;
        if (topKeys.has(key)) {
          violations.push(`repeated top ${key}`);
        }
        topKeys.add(key);
        topColors.add(piece.color_family);
      }
    }
  });

  if (hasPhoto && topColors.size && topColors.size < 3 && looks.length >= 3) {
    violations.push(`near-face top colours:${topColors.size} (need ≥3)`);
  }

  const reading = opts?.reading;
  if (reading) {
    const allowed = new Set<string>();
    for (const s of [
      ...contract.palette.near_face,
      ...contract.palette.core,
      ...contract.palette.neutrals,
      ...contract.palette.accents,
      ...contract.palette.avoid_near_face,
    ]) {
      allowed.add(s.family);
      allowed.add(s.shade.toLowerCase());
    }
    const text = [
      reading.who_you_are,
      reading.the_shift,
      ...reading.rules.map((r) => `${r.rule} ${r.why}`),
      reading.this_week,
    ]
      .join(" ")
      .toLowerCase();
    for (const family of COLOR_FAMILIES) {
      if (
        family === "multi" ||
        family === "print" ||
        family === "denim" ||
        family === "gold" ||
        family === "silver"
      ) {
        continue;
      }
      const re = new RegExp(`\\b${family}\\b`, "i");
      if (re.test(text) && !allowed.has(family)) {
        violations.push(`reading names ${family} outside the palette`);
      }
    }
  }

  return violations;
}
