import { preNormalize } from "./pre-normalize";
import type { AlphaSize, FitModifier, NormalizedSize, SizeCategory, SizeResolution } from "./types";

const ALPHA_MAP: Record<string, AlphaSize> = {
  xxs: "XXS",
  xs: "XS",
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
  xxl: "XXL",
  xxxl: "XXXL",
  "2xl": "XXL",
  "3xl": "XXXL",
  small: "S",
  medium: "M",
  large: "L",
  "extra large": "XL",
};

const FIT_MODIFIERS = new Set<FitModifier>([
  "slim",
  "regular",
  "relaxed",
  "oversized",
  "petite",
  "tall",
]);

function mergeSize(target: NormalizedSize, patch: NormalizedSize): NormalizedSize {
  return {
    alpha: patch.alpha ?? target.alpha,
    numeric: patch.numeric ?? target.numeric,
    numeric_system: patch.numeric_system ?? target.numeric_system,
    inseam: patch.inseam ?? target.inseam,
    fit_modifier: patch.fit_modifier ?? target.fit_modifier,
    one_size: patch.one_size ?? target.one_size,
  };
}

function parseAlphaToken(token: string, standalone: boolean): AlphaSize | null {
  const key = token.toLowerCase();
  if (ALPHA_MAP[key]) return ALPHA_MAP[key]!;
  if (!standalone && (key === "s" || key === "m" || key === "l")) return null;
  if (standalone && (key === "s" || key === "m" || key === "l")) {
    return ALPHA_MAP[key]!;
  }
  return null;
}

function parseOneSize(normalized: string): NormalizedSize | null {
  if (
    /^(os|one size|onesize|free size|unique|tu|u)$/.test(normalized) ||
    /\bone\s*size\b/.test(normalized)
  ) {
    return { one_size: true };
  }
  return null;
}

function parseWaistInseam(normalized: string): NormalizedSize | null {
  const wxl = normalized.match(/\bw?\s*(\d{2})\s*(?:[x/]|l)?\s*(\d{2})\b/);
  if (wxl) {
    return {
      numeric: Number(wxl[1]),
      numeric_system: "waist",
      inseam: Number(wxl[2]),
    };
  }
  const waistOnly = normalized.match(/\bw\s*(\d{2})\b/);
  if (waistOnly) {
    return { numeric: Number(waistOnly[1]), numeric_system: "waist" };
  }
  return null;
}

function parseAlphaNumericCombo(normalized: string): NormalizedSize | null {
  const mDash = normalized.match(/\b([sml])\s*[-/]\s*(\d{1,2}(?:\.\d)?)\b/);
  if (mDash) {
    const alpha = ALPHA_MAP[mDash[1]!];
    if (alpha) {
      return {
        alpha,
        numeric: Number(mDash[2]),
        numeric_system: "ambiguous",
      };
    }
  }
  return null;
}

function parseBareNumeric(
  token: string,
  category: SizeCategory,
  context: string,
): NormalizedSize | null {
  const match = token.match(/^(\d{1,2}(?:\.\d)?)$/);
  if (!match) return null;
  const n = Number(match[1]);

  if (category !== "shoes" && n < 10) return null;

  if (category === "shoes") {
    if (n >= 35 && n <= 50) return { numeric: n, numeric_system: "eu" };
    if (n >= 3 && n <= 15) return { numeric: n, numeric_system: "ambiguous" };
    return { numeric: n, numeric_system: "ambiguous" };
  }

  if (
    category === "bottoms" &&
    n >= 26 &&
    n <= 44 &&
    n % 2 === 0 &&
    (/\b(w\d{2}|waist|inseam|denim|jean)\b/.test(context) ||
      /\d{2}\s*[x/]\s*\d{2}/.test(context))
  ) {
    return { numeric: n, numeric_system: "waist" };
  }

  return { numeric: n, numeric_system: "ambiguous" };
}

function parseFitModifier(token: string): FitModifier | null {
  const t = token.toLowerCase();
  if (t === "straight") return "regular";
  if (FIT_MODIFIERS.has(t as FitModifier)) return t as FitModifier;
  return null;
}

export function resolveSizeDeterministic(
  label: string,
  category: SizeCategory,
): SizeResolution {
  const normalized = preNormalize(label);
  if (!normalized) return { size: {}, resolved: false };

  let size: NormalizedSize = {};

  const oneSize = parseOneSize(normalized);
  if (oneSize) return { size: oneSize, resolved: true, via: "deterministic" };

  const waist = parseWaistInseam(normalized);
  if (waist) size = mergeSize(size, waist);

  const combo = parseAlphaNumericCombo(normalized);
  if (combo) size = mergeSize(size, combo);

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const standalone = tokens.length === 1;

  for (const token of tokens) {
    const alpha = parseAlphaToken(token, standalone || tokens.length <= 2);
    if (alpha) size = mergeSize(size, { alpha });

    const fit = parseFitModifier(token);
    if (fit) size = mergeSize(size, { fit_modifier: fit });

    const numeric = parseBareNumeric(token, category, normalized);
    if (numeric) size = mergeSize(size, numeric);
  }

  const resolved = Boolean(
    size.one_size ||
      size.alpha ||
      size.numeric != null ||
      size.fit_modifier ||
      size.inseam != null,
  );

  return { size, resolved, via: resolved ? "deterministic" : undefined };
}
