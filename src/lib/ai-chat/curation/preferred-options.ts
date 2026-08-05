/**
 * Same shape as Shopify's `SelectedOption`. Re-declared here to keep this
 * module dependency-free from the catalog client (so it can also be used
 * client-side if needed).
 */
export type PreferredOption = { name: string; label: string };

export type ProductOptionForMatching = {
  name: string;
  values: Array<{ label: string }>;
};

export type UserOptionHints = {
  shoeEU?: number | null;
  shoeUS?: number | null;
  shoeUK?: number | null;
  topUsualSize?: string | null;
  bottomUsualSize?: string | null;
  bottomWaist?: string | null;
  bottomInseam?: string | null;
  ringSize?: string | null;
  preferredColors: string[];
  dislikedColors: string[];
  preferredMaterials: string[];
};

export const EMPTY_USER_OPTION_HINTS: UserOptionHints = {
  preferredColors: [],
  dislikedColors: [],
  preferredMaterials: [],
};

export type ProductPriceRangeHint = {
  min: { amount: number; currency: string };
  max: { amount: number; currency: string };
};

/** Lowercased, non-alphanum collapsed to single space. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.+/]+/g, " ").trim();
}

/** Extract numeric tokens (e.g. "44", "10.5") from a label. */
function firstNumber(label: string): number | null {
  const m = label.match(/(\d+(?:\.5)?)/);
  return m ? Number(m[1]) : null;
}

/** True when an option appears to be a shoe-size axis. */
function looksLikeShoeOption(option: ProductOptionForMatching): boolean {
  const n = normalize(option.name);
  if (/(shoe|footwear|eu|us|uk)/.test(n)) return true;
  if (n === "size") {
    // Pure-numeric values in the typical shoe range → likely shoes.
    const numeric = option.values
      .map((v) => firstNumber(v.label))
      .filter((x): x is number => x != null);
    if (numeric.length >= 3) {
      const inRange = numeric.filter((x) => x >= 30 && x <= 52).length;
      if (inRange / numeric.length >= 0.7) return true;
    }
  }
  return false;
}

/** True when an option looks like a clothing letter-size axis. */
function looksLikeClothingSizeOption(
  option: ProductOptionForMatching,
): boolean {
  const n = normalize(option.name);
  if (looksLikeShoeOption(option)) return false;
  if (!/(size|fit)/.test(n)) return false;
  const letterValues = option.values.filter((v) =>
    /^(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl)$/.test(normalize(v.label)),
  );
  return letterValues.length >= 2;
}

function looksLikeColorOption(option: ProductOptionForMatching): boolean {
  const n = normalize(option.name);
  return /(color|colour|colorway|finish|hue)/.test(n);
}

function looksLikeMaterialOption(option: ProductOptionForMatching): boolean {
  const n = normalize(option.name);
  return /(material|fabric|leather|print|frame|framing|finish)/.test(n);
}

/** Size axis with inch/cm dimensions (posters, prints, frames) — not shoes or apparel letters. */
function looksLikeDimensionalSizeOption(
  option: ProductOptionForMatching,
): boolean {
  if (looksLikeShoeOption(option) || looksLikeClothingSizeOption(option)) {
    return false;
  }
  const n = normalize(option.name);
  if (!/(size|dimension)/.test(n)) return false;
  return option.values.some((v) => parseLabelArea(v.label) != null);
}

function parseLabelArea(label: string): number | null {
  const m = label.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  return w * h;
}

/** Higher score = typically pricier material (framed > canvas > print-only). */
function materialPriceTier(label: string): number {
  const n = normalize(label);
  if (/(frame|framed)/.test(n)) return 3;
  if (/canvas/.test(n)) return 2;
  if (/(print only|unframed|fine art)/.test(n)) return 0;
  return 1;
}

function pickPrintMaterialOption(
  option: ProductOptionForMatching,
  priceMinCents: number | undefined,
): string | null {
  if (!option.values.length) return null;
  const ranked = [...option.values].sort(
    (a, b) => materialPriceTier(b.label) - materialPriceTier(a.label),
  );
  if (priceMinCents == null) return ranked[0]?.label ?? null;
  if (priceMinCents >= 15_000) return ranked[0]?.label ?? null;
  if (priceMinCents >= 5_000) {
    return ranked[Math.floor(ranked.length / 2)]?.label ?? null;
  }
  return ranked[ranked.length - 1]?.label ?? null;
}

function pickDimensionalSizeOption(
  option: ProductOptionForMatching,
  priceMinCents: number | undefined,
): string | null {
  const withArea = option.values
    .map((v) => ({ label: v.label, area: parseLabelArea(v.label) }))
    .filter((row): row is { label: string; area: number } => row.area != null)
    .sort((a, b) => a.area - b.area);
  if (!withArea.length) {
    const idx = Math.floor(option.values.length / 2);
    return option.values[idx]?.label ?? null;
  }
  if (priceMinCents == null) {
    return withArea[Math.floor(withArea.length / 2)]?.label ?? null;
  }
  if (priceMinCents >= 15_000) {
    const idx = Math.min(
      withArea.length - 1,
      Math.max(1, Math.floor(withArea.length * 0.65)),
    );
    return withArea[idx]?.label ?? null;
  }
  if (priceMinCents >= 5_000) {
    const idx = Math.floor(withArea.length * 0.45);
    return withArea[idx]?.label ?? null;
  }
  return withArea[0]?.label ?? null;
}

/** Detected size system from an option's own name. */
function detectShoeSizeSystem(
  option: ProductOptionForMatching,
): "EU" | "US" | "UK" | null {
  const n = normalize(option.name);
  if (n.includes("eu")) return "EU";
  if (n.includes("us")) return "US";
  if (n.includes("uk")) return "UK";
  return null;
}

/**
 * Find the option value whose label best matches one of the given strings.
 * Candidates are tried in priority order — the first candidate with any
 * matching option value wins, regardless of where that value appears in the
 * merchant's list. Returns the original label (preserving casing).
 */
function pickByLabel(
  option: ProductOptionForMatching,
  candidates: string[],
): string | null {
  const normCandidates = candidates
    .map(normalize)
    .filter((c) => c.length > 0);
  if (!normCandidates.length) return null;

  for (const c of normCandidates) {
    for (const v of option.values) {
      if (normalize(v.label) === c) return v.label;
    }
  }
  // Substring fallback (e.g. "EU 44" matches candidate "44"). Skip single
  // characters to avoid noisy hits.
  for (const c of normCandidates) {
    if (c.length < 2) continue;
    for (const v of option.values) {
      const n = normalize(v.label);
      if (n.includes(c) || c.includes(n)) return v.label;
    }
  }
  return null;
}

/** Find the option value whose numeric label equals `target`. */
function pickByNumber(
  option: ProductOptionForMatching,
  target: number,
): string | null {
  for (const v of option.values) {
    const n = firstNumber(v.label);
    if (n != null && Math.abs(n - target) < 0.01) return v.label;
  }
  return null;
}

/** Pull explicit size mentions out of free text ("EU 44", "size 10.5", "size M"). */
function extractSizeMentions(text: string): {
  shoeEU?: number;
  shoeUS?: number;
  shoeUK?: number;
  clothing?: string;
} {
  const out: ReturnType<typeof extractSizeMentions> = {};
  const t = text.toLowerCase();

  const eu = t.match(/\beu(?:ropean)?\s*(?:size\s*)?(\d{2}(?:\.5)?)/);
  if (eu) out.shoeEU = Number(eu[1]);
  const us = t.match(/\bus\s*(?:size\s*)?(\d{1,2}(?:\.5)?)/);
  if (us) out.shoeUS = Number(us[1]);
  const uk = t.match(/\buk\s*(?:size\s*)?(\d{1,2}(?:\.5)?)/);
  if (uk) out.shoeUK = Number(uk[1]);

  // Clothing letter sizes — must be preceded by "size" to avoid matching the
  // letter "s" in unrelated words.
  const letter = t.match(/\bsize\s+(xxs|xs|s|m|l|xl|xxl|2xl|3xl)\b/i);
  if (letter) out.clothing = letter[1].toUpperCase();

  return out;
}

/**
 * Known color tokens we try to match against query text. Keep small + obvious;
 * the user's stored `preferredColors` covers anything fancier.
 */
const COMMON_COLORS = [
  "black",
  "white",
  "off-white",
  "cream",
  "beige",
  "tan",
  "brown",
  "grey",
  "gray",
  "navy",
  "blue",
  "red",
  "burgundy",
  "green",
  "olive",
  "khaki",
  "pink",
  "purple",
  "yellow",
  "orange",
  "silver",
  "gold",
];

function extractColorMentions(text: string): string[] {
  const t = text.toLowerCase();
  return COMMON_COLORS.filter((c) => new RegExp(`\\b${c}\\b`).test(t));
}

/**
 * Compute the option values to pre-select for a given product based on the
 * search context and the user's stored preferences. Deterministic, runs in
 * sub-millisecond time per product.
 */
export function inferPreferredOptions(
  product: {
    options?: ProductOptionForMatching[];
    priceRange?: ProductPriceRangeHint;
  },
  query: string,
  intent: string | undefined,
  hints: UserOptionHints,
): PreferredOption[] {
  const options = product.options ?? [];
  if (!options.length) return [];

  const haystack = `${query} ${intent ?? ""}`;
  const mentions = extractSizeMentions(haystack);
  const queryColors = extractColorMentions(haystack);
  const priceMinCents = product.priceRange?.min.amount;

  const picked: PreferredOption[] = [];

  for (const option of options) {
    if (!option.values.length) continue;

    let label: string | null = null;

    if (looksLikeShoeOption(option)) {
      const system = detectShoeSizeSystem(option);
      // 1. Explicit query mention wins.
      if (system === "EU" && mentions.shoeEU != null) {
        label = pickByNumber(option, mentions.shoeEU);
      } else if (system === "US" && mentions.shoeUS != null) {
        label = pickByNumber(option, mentions.shoeUS);
      } else if (system === "UK" && mentions.shoeUK != null) {
        label = pickByNumber(option, mentions.shoeUK);
      } else if (system === null) {
        // Generic "Size" option on shoes — try whichever mention exists, then user prefs.
        if (mentions.shoeEU != null)
          label = pickByNumber(option, mentions.shoeEU);
        if (!label && mentions.shoeUS != null)
          label = pickByNumber(option, mentions.shoeUS);
      }
      // 2. Stored sizing profile fallback.
      if (!label) {
        if (system === "EU" && hints.shoeEU != null)
          label = pickByNumber(option, hints.shoeEU);
        else if (system === "US" && hints.shoeUS != null)
          label = pickByNumber(option, hints.shoeUS);
        else if (system === "UK" && hints.shoeUK != null)
          label = pickByNumber(option, hints.shoeUK);
        else if (system === null) {
          if (hints.shoeEU != null) label = pickByNumber(option, hints.shoeEU);
          if (!label && hints.shoeUS != null)
            label = pickByNumber(option, hints.shoeUS);
        }
      }
    } else if (looksLikeClothingSizeOption(option)) {
      const candidates: string[] = [];
      if (mentions.clothing) candidates.push(mentions.clothing);
      if (hints.topUsualSize) candidates.push(hints.topUsualSize);
      if (hints.bottomUsualSize) candidates.push(hints.bottomUsualSize);
      label = pickByLabel(option, candidates);
    } else if (looksLikeColorOption(option)) {
      const candidates: string[] = [
        ...queryColors,
        ...hints.preferredColors,
      ].filter(
        (c) =>
          !hints.dislikedColors.some(
            (d) => normalize(d) === normalize(c),
          ),
      );
      label = pickByLabel(option, candidates);
    } else if (looksLikeDimensionalSizeOption(option)) {
      label = pickDimensionalSizeOption(option, priceMinCents);
    } else if (looksLikeMaterialOption(option)) {
      label =
        pickByLabel(option, hints.preferredMaterials) ??
        pickPrintMaterialOption(option, priceMinCents);
    } else {
      // Numeric "waist"/"inseam" axes.
      const n = normalize(option.name);
      if (/waist/.test(n) && hints.bottomWaist) {
        label = pickByLabel(option, [hints.bottomWaist]);
      } else if (/inseam|length/.test(n) && hints.bottomInseam) {
        label = pickByLabel(option, [hints.bottomInseam]);
      } else if (/ring/.test(n) && hints.ringSize) {
        label = pickByLabel(option, [hints.ringSize]);
      }
    }

    if (label) picked.push({ name: option.name, label });
  }

  return picked;
}
