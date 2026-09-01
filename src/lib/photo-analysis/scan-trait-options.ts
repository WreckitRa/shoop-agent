/**
 * Canonical Fitting-check options. The photo model writes prose;
 * confirmation is a colour/chip pick, not a paragraph.
 */

export type ScanTraitKind =
  | "skin"
  | "undertone"
  | "contrast"
  | "eyes"
  | "hair"
  | "face"
  | "hair_length"
  | "facial_hair";

export type ScanTraitOption = {
  id: string;
  label: string;
  /** Present on colour traits — swatch in the dropdown. */
  hex?: string;
  keys: string[];
};

const SKIN: ScanTraitOption[] = [
  { id: "fair", label: "Fair", hex: "#F3E0D0", keys: ["porcelain", "ivory", "fair", "very light"] },
  { id: "light", label: "Light", hex: "#E4C3A4", keys: ["light", "beige", "pale"] },
  { id: "medium", label: "Medium", hex: "#C99468", keys: ["medium", "mid-tone", "mid tone"] },
  { id: "olive", label: "Olive", hex: "#B08A5A", keys: ["medium olive", "light olive", "dark olive", "olive"] },
  { id: "tan", label: "Tan", hex: "#A06B3E", keys: ["tan", "golden", "bronze", "sun-kissed", "sunkissed"] },
  { id: "brown", label: "Brown", hex: "#6E4026", keys: ["brown", "caramel", "chestnut"] },
  { id: "deep", label: "Deep", hex: "#3A241C", keys: ["deep", "dark", "ebony", "rich"] },
];

const EYES: ScanTraitOption[] = [
  { id: "black", label: "Black", hex: "#1A1A1A", keys: ["black"] },
  { id: "dark_brown", label: "Dark brown", hex: "#2C1810", keys: ["dark brown", "deep brown"] },
  { id: "brown", label: "Brown", hex: "#5C3317", keys: ["brown"] },
  { id: "hazel", label: "Hazel", hex: "#8E7618", keys: ["hazel"] },
  { id: "amber", label: "Amber", hex: "#B36B1E", keys: ["amber", "honey"] },
  { id: "green", label: "Green", hex: "#3D6B3A", keys: ["green"] },
  { id: "blue", label: "Blue", hex: "#4A6FA5", keys: ["blue"] },
  { id: "grey", label: "Grey", hex: "#7A8490", keys: ["grey", "gray"] },
];

const HAIR: ScanTraitOption[] = [
  { id: "black", label: "Black", hex: "#141414", keys: ["black", "jet"] },
  { id: "dark_brown", label: "Dark brown", hex: "#3B2218", keys: ["dark brown", "deep brown"] },
  { id: "brown", label: "Brown", hex: "#6B3F24", keys: ["brown", "brunette"] },
  { id: "light_brown", label: "Light brown", hex: "#A0673A", keys: ["light brown", "chestnut"] },
  { id: "blonde", label: "Blonde", hex: "#D4B07A", keys: ["blonde", "blond", "golden"] },
  { id: "platinum", label: "Platinum", hex: "#E8E0D0", keys: ["platinum", "white blonde", "silver blonde"] },
  { id: "red", label: "Red", hex: "#A33C22", keys: ["red", "ginger"] },
  { id: "auburn", label: "Auburn", hex: "#7A2E1A", keys: ["auburn"] },
  { id: "grey", label: "Grey", hex: "#9A9A9A", keys: ["grey", "gray", "silver", "salt"] },
];

const UNDERTONE: ScanTraitOption[] = [
  { id: "warm", label: "Warm", keys: ["warm", "golden", "yellow", "peach"] },
  { id: "cool", label: "Cool", keys: ["cool", "pink", "blue", "rosy"] },
  { id: "neutral", label: "Neutral", keys: ["neutral", "balanced"] },
  { id: "olive", label: "Olive", keys: ["olive", "green"] },
];

const CONTRAST: ScanTraitOption[] = [
  { id: "low", label: "Low", keys: ["low", "soft", "muted"] },
  { id: "medium", label: "Medium", keys: ["medium", "moderate"] },
  { id: "high", label: "High", keys: ["high", "strong", "sharp"] },
];

const FACE: ScanTraitOption[] = [
  { id: "oval", label: "Oval", keys: ["oval"] },
  { id: "round", label: "Round", keys: ["round"] },
  { id: "square", label: "Square", keys: ["square", "angular"] },
  { id: "heart", label: "Heart", keys: ["heart"] },
  { id: "oblong", label: "Oblong", keys: ["oblong", "long", "rectangular"] },
  { id: "diamond", label: "Diamond", keys: ["diamond"] },
];

const HAIR_LENGTH: ScanTraitOption[] = [
  { id: "bald", label: "Bald", keys: ["bald", "shaved", "none"] },
  { id: "short", label: "Short", keys: ["short", "crop", "buzz"] },
  { id: "medium", label: "Medium", keys: ["medium", "ear", "chin"] },
  { id: "long", label: "Long", keys: ["long", "shoulder", "past"] },
];

const FACIAL_HAIR: ScanTraitOption[] = [
  { id: "none", label: "None", keys: ["none", "clean", "shaved", "bare", "n/a", "not"] },
  { id: "stubble", label: "Stubble", keys: ["stubble", "scruff", "5 o"] },
  { id: "beard", label: "Beard", keys: ["beard", "full"] },
  { id: "moustache", label: "Moustache", keys: ["moustache", "mustache"] },
];

const BY_KIND: Record<ScanTraitKind, ScanTraitOption[]> = {
  skin: SKIN,
  eyes: EYES,
  hair: HAIR,
  undertone: UNDERTONE,
  contrast: CONTRAST,
  face: FACE,
  hair_length: HAIR_LENGTH,
  facial_hair: FACIAL_HAIR,
};

const PATH_KIND: Array<{ needle: string; kind: ScanTraitKind }> = [
  { needle: "visible_skin_surface_tone", kind: "skin" },
  { needle: "skin_depth", kind: "skin" },
  { needle: "undertone", kind: "undertone" },
  { needle: "facial_contrast", kind: "contrast" },
  { needle: "eye_color", kind: "eyes" },
  { needle: "hair_color", kind: "hair" },
  { needle: "primary_shape", kind: "face" },
  { needle: "hair_length", kind: "hair_length" },
  { needle: "facial_hair", kind: "facial_hair" },
];

export function scanTraitKind(path: string): ScanTraitKind | null {
  for (const row of PATH_KIND) {
    if (path.includes(row.needle)) return row.kind;
  }
  return null;
}

export function optionsForKind(kind: ScanTraitKind): ScanTraitOption[] {
  return BY_KIND[kind];
}

export function kindHasColor(kind: ScanTraitKind): boolean {
  return BY_KIND[kind].some((o) => Boolean(o.hex));
}

/** Longest keyword hit wins so "dark brown" beats "brown". */
export function matchScanTrait(
  kind: ScanTraitKind,
  raw: string,
): ScanTraitOption | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  let best: { option: ScanTraitOption; score: number } | null = null;
  for (const option of BY_KIND[kind]) {
    for (const key of option.keys) {
      if (!t.includes(key)) continue;
      if (!best || key.length > best.score) {
        best = { option, score: key.length };
      }
    }
  }
  return best?.option ?? null;
}

export function canonicalScanLabel(kind: ScanTraitKind, raw: string): string {
  return matchScanTrait(kind, raw)?.label ?? "";
}
