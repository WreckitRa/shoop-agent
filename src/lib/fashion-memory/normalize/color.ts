import {
  COLOR_MODIFIERS,
  COLOR_TOKEN_ALIASES,
  TWO_TOKEN_COLOR_OVERRIDES,
} from "./color-aliases";
import { fuzzyToken } from "./fuzzy";
import { preNormalize } from "./pre-normalize";
import type { ColorBucket, ColorResolution } from "./types";

const ALIAS_KEYS = Object.keys(COLOR_TOKEN_ALIASES);

function twoToneSeparatorsPresent(original: string): boolean {
  return /[/&]/.test(original) || /\band\b/i.test(original);
}

function applyTwoTokenOverrides(normalized: string): ColorBucket | null {
  for (const { pattern, bucket } of TWO_TOKEN_COLOR_OVERRIDES) {
    if (pattern.test(normalized)) return bucket;
  }
  return null;
}

function mapToken(
  token: string,
  hasDenimContext: boolean,
): { bucket: ColorBucket | null; fuzzy: boolean } {
  if (COLOR_MODIFIERS.has(token)) return { bucket: null, fuzzy: false };
  if (token === "indigo") {
    return { bucket: hasDenimContext ? "denim" : "navy", fuzzy: false };
  }
  const direct = COLOR_TOKEN_ALIASES[token];
  if (direct) return { bucket: direct, fuzzy: false };
  const fuzzyKey = fuzzyToken(token, ALIAS_KEYS);
  if (!fuzzyKey) return { bucket: null, fuzzy: false };
  return { bucket: COLOR_TOKEN_ALIASES[fuzzyKey] ?? null, fuzzy: true };
}

export function resolveColorDeterministic(
  label: string,
): ColorResolution & { fuzzyUsed?: boolean } {
  const original = label;
  const normalized = preNormalize(label);
  if (!normalized) return { buckets: [], resolved: false };

  const override = applyTwoTokenOverrides(normalized);
  if (override) {
    return { buckets: [override], resolved: true, via: "deterministic" };
  }

  const hasDenimContext = /\b(denim|jean|jeans)\b/.test(normalized);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const mapped: ColorBucket[] = [];
  let fuzzyUsed = false;

  for (const token of tokens) {
    if (COLOR_MODIFIERS.has(token)) continue;
    const mappedToken = mapToken(token, hasDenimContext);
    if (mappedToken.fuzzy) fuzzyUsed = true;
    if (mappedToken.bucket) mapped.push(mappedToken.bucket);
  }

  if (mapped.length === 0) {
    return { buckets: [], resolved: false };
  }

  const unique = [...new Set(mapped)];
  const twoTone = twoToneSeparatorsPresent(original) && unique.length >= 2;

  if (twoTone) {
    return {
      buckets: unique,
      resolved: true,
      via: fuzzyUsed ? "fuzzy" : "deterministic",
      fuzzyUsed,
    };
  }

  const last = mapped[mapped.length - 1]!;
  return {
    buckets: [last],
    resolved: true,
    via: fuzzyUsed ? "fuzzy" : "deterministic",
    fuzzyUsed,
  };
}
