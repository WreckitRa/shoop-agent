import { COLOR_WORDS } from "../search-planner/query-rules";
import type { StyleSignalRow } from "../types";
import type {
  FashionBriefBrandDirection,
  FashionBriefColorDirection,
  FashionSearchBrief,
} from "./types";

const PROFILE_COLOR_SIGNAL =
  /\b(monochrome|neutral|neutrals|palette|earth tone|earth-tone|pastel|colorway|tone-on-tone)\b/i;

/** Common "from/by Brand" patterns in free text. */
const BRAND_FROM_RE =
  /\b(?:from|by|via)\s+([A-Za-z][A-Za-z0-9&'.-]{1,40}(?:\s+[A-Za-z][A-Za-z0-9&'.-]{1,40}){0,2})\b/gi;
const BRAND_OR_RE =
  /\b([A-Za-z][A-Za-z0-9&'.-]{1,30})\s+or\s+([A-Za-z][A-Za-z0-9&'.-]{1,30})\b/gi;

const NON_BRAND_TOKENS = new Set([
  "me",
  "him",
  "her",
  "them",
  "you",
  "my",
  "the",
  "a",
  "an",
  "this",
  "that",
  "work",
  "home",
  "store",
  "online",
  "somewhere",
  "anywhere",
  "amazon",
  "target",
]);

export function normalizeBrandToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
}

export function extractStatedBrandsFromText(text: string | undefined): string[] {
  if (!text?.trim()) return [];
  const brands: string[] = [];
  const push = (raw: string) => {
    const n = normalizeBrandToken(raw);
    if (!n || n.length < 2) return;
    if (NON_BRAND_TOKENS.has(n)) return;
    if (COLOR_WORDS.has(n)) return;
    if (!brands.includes(n)) brands.push(n);
  };

  BRAND_FROM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BRAND_FROM_RE.exec(text)) != null) {
    push(m[1] ?? "");
  }
  BRAND_OR_RE.lastIndex = 0;
  while ((m = BRAND_OR_RE.exec(text)) != null) {
    const a = m[1] ?? "";
    const b = m[2] ?? "";
    if (/^[A-Z]/.test(a) && /^[A-Z]/.test(b)) {
      push(a);
      push(b);
    }
  }
  return brands;
}

export function extractStatedColors(mustHaves: string[]): string[] {
  const colors: string[] = [];
  for (const item of mustHaves) {
    const tokens = item
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (const token of tokens) {
      if (COLOR_WORDS.has(token) && !colors.includes(token)) {
        colors.push(token);
      }
    }
  }
  return colors;
}

export function profileHasColorSignals(signals: StyleSignalRow[]): boolean {
  return signals.some((signal) => {
    if (signal.polarity !== 1) return false;
    const value = signal.value.toLowerCase();
    if (PROFILE_COLOR_SIGNAL.test(value)) return true;
    return [...COLOR_WORDS].some((color) => value.includes(color));
  });
}

export function profileHasBrandSignals(signals: StyleSignalRow[]): boolean {
  return signals.some(
    (signal) =>
      signal.signal_type === "brand" &&
      signal.polarity === 1 &&
      Boolean(signal.value.trim()),
  );
}

export function userChoseSurpriseMe(text: string | undefined): boolean {
  if (!text?.trim()) return false;
  return /\bsurprise me\b/i.test(text);
}

/** Router-side color_direction — planner resolves occasion_default from source:"none". */
export function reconcileColorDirection(params: {
  brief: FashionSearchBrief;
  signals?: StyleSignalRow[];
  lastUserMessage?: string;
}): FashionBriefColorDirection {
  if (userChoseSurpriseMe(params.lastUserMessage)) {
    return { source: "none" };
  }

  const routerProvided = params.brief.color_direction;
  if (routerProvided?.source === "stated") {
    const stated =
      routerProvided.stated_colors?.length
        ? routerProvided.stated_colors
        : extractStatedColors(params.brief.must_haves);
    if (stated.length) return { source: "stated", stated_colors: stated };
  }

  const statedColors = extractStatedColors(params.brief.must_haves);
  if (statedColors.length) {
    return { source: "stated", stated_colors: statedColors };
  }

  if (
    routerProvided?.source === "profile" ||
    profileHasColorSignals(params.signals ?? [])
  ) {
    return { source: "profile" };
  }

  return { source: "none" };
}

/**
 * Authoritative brand_direction. Stated brands never live in must_haves —
 * strip accidental brand tokens from must_haves when promoting to brand_direction.
 */
export function reconcileBrandDirection(params: {
  brief: FashionSearchBrief;
  signals?: StyleSignalRow[];
  lastUserMessage?: string;
}): FashionBriefBrandDirection {
  const routerProvided = params.brief.brand_direction;
  if (routerProvided?.source === "stated") {
    const brands = (routerProvided.brands ?? [])
      .map(normalizeBrandToken)
      .filter(Boolean);
    const fromMessage = extractStatedBrandsFromText(params.lastUserMessage);
    const merged = [...brands];
    for (const b of fromMessage) {
      if (!merged.includes(b)) merged.push(b);
    }
    if (merged.length) return { source: "stated", brands: merged };
  }

  const fromMessage = extractStatedBrandsFromText(params.lastUserMessage);
  if (fromMessage.length) {
    return { source: "stated", brands: fromMessage };
  }

  if (
    routerProvided?.source === "profile" ||
    profileHasBrandSignals(params.signals ?? [])
  ) {
    const brands = (params.signals ?? [])
      .filter((s) => s.signal_type === "brand" && s.polarity === 1)
      .map((s) => normalizeBrandToken(s.value))
      .filter(Boolean);
    return brands.length
      ? { source: "profile", brands: [...new Set(brands)] }
      : { source: "profile" };
  }

  return { source: "none" };
}

/** Remove stated brand tokens from must_haves so they aren't treated as text attrs. */
export function stripBrandsFromMustHaves(
  mustHaves: string[],
  brands: string[],
): string[] {
  if (!brands.length) return mustHaves;
  const brandSet = new Set(brands.map(normalizeBrandToken));
  return mustHaves.filter((item) => {
    const n = normalizeBrandToken(item);
    if (brandSet.has(n)) return false;
    const tokens = n.split(/\s+/);
    if (tokens.length === 1 && brandSet.has(tokens[0]!)) return false;
    return true;
  });
}
