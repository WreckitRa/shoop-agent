import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { SearchBrief } from "./types";
import type { ScoredCandidate } from "./types";

/** How a requested size was matched to a merchant label or fixed SKU. */
export type SizeResolutionMethod =
  | "option_exact"
  | "option_fuzzy"
  | "option_numeric"
  | "option_letter_token"
  | "chest_map"
  | "sku_parsed"
  | "llm";

export type SizeResolutionMatch = {
  status: "match";
  merchantLabel?: string;
  method: SizeResolutionMethod;
  parsedListingSize?: string;
  confidence: number;
  reason?: string;
  /** Token from the brief that produced the match (e.g. "M" from "M / 40R"). */
  matchedToken?: string;
};

export type SizeResolutionMismatch = {
  status: "mismatch";
  reason: string;
  parsedListingSize?: string;
  confidence: number;
};

export type SizeResolutionUnknown = {
  status: "unknown";
  reason: string;
};

export type SizeResolution =
  | SizeResolutionMatch
  | SizeResolutionMismatch
  | SizeResolutionUnknown;

export type SizeResolutionContext = {
  category?: string;
  query?: string;
};

/** Parsed buyer size — may expand compound brief strings like "M / 40R". */
export type ParsedRequestedSize = {
  raw: string;
  tokens: string[];
  compound: boolean;
  chest?: number;
  length?: "regular" | "long" | "short";
};

/** Men's suiting chest numbers commonly associated with letter sizes (US). */
const MENS_BLAZER_CHEST_BY_LETTER: Record<string, number[]> = {
  xxs: [32, 34],
  xs: [34, 36],
  s: [36, 38],
  m: [38, 40],
  l: [42, 44],
  xl: [44, 46],
  xxl: [46, 48],
  "2xl": [46, 48],
  "3xl": [48, 50],
  "4xl": [50, 52],
  "5xl": [52, 54],
};

const LETTER_SIZE_RE =
  /^(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|5xl)$/i;

/** Full-word merchant size labels → letter token (longest phrases first). */
const FULL_SIZE_WORD_TO_LETTER: ReadonlyArray<readonly [string, string]> = [
  ["extra extra large", "3xl"],
  ["extra large", "xl"],
  ["xx large", "xxl"],
  ["x large", "xl"],
  ["xlarge", "xl"],
  ["xxxl", "3xl"],
  ["xxl", "xxl"],
  ["2xl", "2xl"],
  ["3xl", "3xl"],
  ["4xl", "4xl"],
  ["5xl", "5xl"],
  ["small", "s"],
  ["medium", "m"],
  ["large", "l"],
];

/** Map a full-word size label (e.g. "large") to a letter token ("l"). */
export function letterFromFullWordLabel(label: string): string | null {
  const n = normalizeSizeText(label);
  for (const [word, letter] of FULL_SIZE_WORD_TO_LETTER) {
    if (n === word || n.startsWith(`${word} `)) return letter;
  }
  return null;
}

function labelsUseFullWords(values: Array<{ label: string }>): boolean {
  return values.some((v) => letterFromFullWordLabel(v.label) != null);
}

/** Lowercased, non-alphanum collapsed to single space. */
export function normalizeSizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.+/]+/g, " ").trim();
}

/** Extract the first numeric token from a label (e.g. "m-(38)" → 38). */
export function firstSizeNumber(label: string): number | null {
  const m = label.match(/(\d+(?:\.5)?)/);
  return m ? Number(m[1]) : null;
}

export function normalizeLetter(raw: string): string | null {
  const n = normalizeSizeText(raw);
  if (!LETTER_SIZE_RE.test(n)) return null;
  if (n === "xxxl") return "3xl";
  return n;
}

function expandLengthToken(raw: string): "regular" | "long" | "short" | undefined {
  const t = raw.toLowerCase();
  if (t === "s" || t === "short") return "short";
  if (t === "l" || t === "long") return "long";
  if (t === "r" || t === "reg" || t === "regular") return "regular";
  return undefined;
}

/** Parse tokens like 40R, 40L, 40 Regular into chest + optional length. */
export function parseChestLengthSize(
  token: string,
): { chest: number; length?: "regular" | "long" | "short" } | null {
  const compact = token.trim().replace(/\s+/g, "");
  const m = compact.match(/^(\d{2})([slr]|long|regular|short|reg)?$/i);
  if (!m) return null;
  const chest = Number(m[1]);
  if (!Number.isFinite(chest) || chest < 28 || chest > 60) return null;
  return {
    chest,
    length: m[2] ? expandLengthToken(m[2]) : undefined,
  };
}

/**
 * Split compound brief sizes ("M / 40R", "M, 40") into prioritized match
 * tokens. Letters are tried before numeric chest sizes.
 */
export function expandRequestedSizeTokens(raw: string): ParsedRequestedSize {
  const trimmed = raw.trim();
  const parts = trimmed
    .split(/[/|,·]+|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const compound = parts.length > 1 || /[/|,·]/.test(trimmed);

  const tokens: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const key = normalizeSizeText(t);
    if (!key || seen.has(key)) return;
    seen.add(key);
    tokens.push(t.trim());
  };

  let chest: number | undefined;
  let length: ParsedRequestedSize["length"];

  const ingest = (part: string) => {
    add(part);
    const parsed = parseChestLengthSize(part);
    if (parsed) {
      chest = chest ?? parsed.chest;
      length = length ?? parsed.length;
      add(String(parsed.chest));
    }
    const letter = normalizeLetter(part);
    if (letter) add(letter.toUpperCase());
  };

  if (parts.length) {
    for (const part of parts) ingest(part);
  } else {
    ingest(trimmed);
  }

  if (!parts.includes(trimmed)) add(trimmed);

  tokens.sort((a, b) => tokenPriority(a) - tokenPriority(b));

  return { raw: trimmed, tokens, compound, chest, length };
}

function tokenPriority(token: string): number {
  if (normalizeLetter(token)) return 0;
  if (parseChestLengthSize(token)) return 1;
  if (firstSizeNumber(token) != null) return 2;
  return 3;
}

function findSizeOption(product: CatalogProductSummary) {
  return product.options?.find((o) => /size/i.test(o.name));
}

/** Merge Size labels from product options and variant rows (search summaries can be incomplete). */
export function collectSizeOptionValues(
  product: CatalogProductSummary,
): Array<{ label: string }> {
  const seen = new Set<string>();
  const out: Array<{ label: string }> = [];
  const add = (label: string | undefined) => {
    const trimmed = label?.trim();
    if (!trimmed) return;
    const key = normalizeSizeText(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ label: trimmed });
  };

  const sizeOpt = findSizeOption(product);
  for (const v of sizeOpt?.values ?? []) add(v.label);

  for (const variant of product.variants ?? []) {
    for (const o of variant.options ?? []) {
      if (/size/i.test(o.name)) add(o.label);
    }
  }

  return out;
}

/** Parse merchant suiting labels like "42 regular", "40 long", "38 R", "42 relaxed". */
export function stripFitModifiers(label: string): { base: string; fit?: string } {
  const fitRe =
    /\b(relaxed|slim|classic|modern|athletic|tailored|oversized|loose)\b/i;
  const fitMatch = label.match(fitRe);
  const fit = fitMatch?.[1]?.toLowerCase();
  const base = fit
    ? label.replace(fitRe, " ").replace(/\s+/g, " ").trim()
    : label;
  return { base, fit };
}

export function parseMerchantSuitLabel(
  label: string,
): { chest: number; length?: "regular" | "long" | "short"; fit?: string } | null {
  const { base, fit } = stripFitModifiers(label);
  const n = normalizeSizeText(base);
  const m = n.match(/^(\d{2})\s*(regular|reg|r|long|l|short|s)?$/);
  if (!m) return null;
  const chest = Number(m[1]);
  if (!Number.isFinite(chest) || chest < 28 || chest > 60) return null;
  const length = m[2] ? expandLengthToken(m[2]) : undefined;
  if (length) return { chest, length, ...(fit ? { fit } : {}) };
  return { chest, ...(fit ? { fit } : {}) };
}

function lengthsCompatible(
  requested: "regular" | "long" | "short" | undefined,
  merchant: "regular" | "long" | "short" | undefined,
): boolean {
  if (!requested) return true;
  if (!merchant) return requested === "regular";
  return requested === merchant;
}

function pickOptionByChestLengthLabel(
  values: Array<{ label: string }>,
  tokens: string[],
): OptionMatch | null {
  for (const token of tokens) {
    const req = parseChestLengthSize(token);
    const chest = req?.chest ?? chestFromToken(token);
    if (chest == null) continue;
    const reqLength = req?.length;

    for (const v of values) {
      const merchant = parseMerchantSuitLabel(v.label);
      if (!merchant || merchant.chest !== chest) continue;
      if (!lengthsCompatible(reqLength, merchant.length)) continue;
      return {
        merchantLabel: v.label,
        method: "option_numeric",
        matchedToken: token,
        confidence: reqLength ? 0.93 : 0.9,
      };
    }
  }
  return null;
}

function isSingleSkuListing(product: CatalogProductSummary): boolean {
  const sizeOpt = findSizeOption(product);
  if (sizeOpt?.values?.length) return false;
  const variants = product.variants ?? [];
  return variants.length <= 1;
}

function labelsLookExotic(values: Array<{ label: string }>): boolean {
  return values.some((v) => /\bkg\b|weight|eu\s*\d|us\s*\d|cn\s*\d/i.test(v.label));
}

function labelsUseWeightBands(values: Array<{ label: string }>): boolean {
  return values.some((v) => /\bkg\b/i.test(v.label));
}

/** Best-fit letter size for a suiting chest measurement (e.g. 42 → L). */
export function letterForChest(chest: number): string | null {
  let best: { letter: string; dist: number } | null = null;
  for (const [letter, chests] of Object.entries(MENS_BLAZER_CHEST_BY_LETTER)) {
    if (!chests.includes(chest)) continue;
    const mid = (chests[0]! + chests[1]!) / 2;
    const dist = Math.abs(chest - mid);
    if (!best || dist < best.dist) best = { letter, dist };
  }
  return best?.letter ?? null;
}

/**
 * Letter candidates for chest→merchant mapping, ordered best-first.
 * Includes M for 40–42 (common merchant charts) before L when both apply.
 */
export function lettersForChestMatch(chest: number): string[] {
  const ordered: string[] = [];
  if (chest >= 40 && chest <= 42) ordered.push("m");
  const primary = letterForChest(chest);
  if (primary && !ordered.includes(primary)) ordered.push(primary);
  if (!ordered.length && primary) ordered.push(primary);
  return ordered;
}

export function chestFromToken(token: string): number | null {
  const chestLen = parseChestLengthSize(token);
  if (chestLen) return chestLen.chest;
  if (normalizeLetter(token)) return null;
  const n = firstSizeNumber(token);
  if (n != null && n >= 28 && n <= 60 && String(n) === token.trim()) return n;
  if (n != null && n >= 28 && n <= 60 && parseChestLengthSize(`${n}`)) return n;
  return null;
}

export function hasChestSizeRequest(parsed: ParsedRequestedSize): boolean {
  return parsed.tokens.some((t) => chestFromToken(t) != null);
}

function sizingSchemeMismatch(
  values: Array<{ label: string }>,
  parsed: ParsedRequestedSize,
): boolean {
  if (!hasChestSizeRequest(parsed)) return false;
  return labelsUseWeightBands(values) || labelsLookExotic(values);
}

/** Parse chest / length from fixed-SKU titles and variant text. */
export function parseFixedListingSize(
  product: CatalogProductSummary,
): { chest?: number; letter?: string; length?: string; label: string } | null {
  const parts: string[] = [product.title ?? ""];
  for (const v of product.variants ?? []) {
    if (v.title) parts.push(v.title);
    for (const o of v.options ?? []) {
      if (/size/i.test(o.name) && o.label) parts.push(`Size: ${o.label}`);
      if (/length/i.test(o.name) && o.label) parts.push(`Length: ${o.label}`);
    }
  }
  const hay = parts.join(" ");

  let chest: number | undefined;
  let length: string | undefined;

  const sizeField = hay.match(/\bsize:\s*(\d{2})(?:\s*([slr]|long|regular|short))?/i);
  if (sizeField) {
    chest = Number(sizeField[1]);
    if (sizeField[2]) length = expandLengthToken(sizeField[2]);
  }

  const titleMatch = hay.match(
    /\b(3[0-9]|4[0-9]|5[0-2])\s*([sl]|long|regular|short|reg)\b/i,
  );
  if (titleMatch) {
    chest = chest ?? Number(titleMatch[1]);
    if (titleMatch[2]) length = length ?? expandLengthToken(titleMatch[2]);
  }

  const jacketLength = hay.match(
    /jacket\s+length:\s*(long|regular|short)/i,
  );
  if (jacketLength) {
    length = length ?? expandLengthToken(jacketLength[1]!);
  }

  if (chest != null) {
    return {
      chest,
      length,
      label: `${chest}${length ? ` ${length}` : ""}`.trim(),
    };
  }

  const letterOnly = hay.match(/\bsize:\s*(xxs|xs|s|m|l|xl|xxl|2xl|3xl)\b/i);
  if (letterOnly) {
    const letter = normalizeLetter(letterOnly[1]!);
    if (letter) return { letter, label: letter.toUpperCase() };
  }

  return null;
}

function labelMatchesLetter(label: string, letter: string): boolean {
  const letterNorm = normalizeLetter(letter) ?? normalizeSizeText(letter);
  const n = normalizeSizeText(label);
  const l = normalizeSizeText(letterNorm);
  if (!l) return false;
  const fromWord = letterFromFullWordLabel(label);
  if (fromWord === l) return true;
  if (n === l) return true;
  if (new RegExp(`^${l}(\\b|[\\s-(])`).test(n)) return true;
  if (new RegExp(`\\b${l}\\b`).test(n)) return true;
  return false;
}

function pickOptionByLabel(
  values: Array<{ label: string }>,
  candidates: string[],
): { label: string; token: string; exact: boolean } | null {
  const normCandidates = candidates
    .map((t) => ({ raw: t, norm: normalizeSizeText(t) }))
    .filter((c) => c.norm.length > 0);

  for (const c of normCandidates) {
    for (const v of values) {
      if (normalizeSizeText(v.label) === c.norm) {
        return { label: v.label, token: c.raw, exact: true };
      }
    }
  }
  for (const c of normCandidates) {
    if (c.norm.length < 2) continue;
    for (const v of values) {
      const n = normalizeSizeText(v.label);
      if (n.includes(c.norm) || c.norm.includes(n)) {
        return { label: v.label, token: c.raw, exact: false };
      }
    }
  }
  return null;
}

function pickOptionByNumber(
  values: Array<{ label: string }>,
  target: number,
): string | null {
  for (const v of values) {
    const n = firstSizeNumber(v.label);
    if (n != null && Math.abs(n - target) < 0.01) return v.label;
  }
  return null;
}

function pickOptionByLetterToken(
  values: Array<{ label: string }>,
  letter: string,
): string | null {
  for (const v of values) {
    if (labelMatchesLetter(v.label, letter)) return v.label;
  }
  return null;
}

function pickOptionByChestMap(
  values: Array<{ label: string }>,
  letter: string,
): string | null {
  const nums = MENS_BLAZER_CHEST_BY_LETTER[normalizeLetter(letter) ?? ""] ?? [];
  for (const n of nums) {
    const label = pickOptionByNumber(values, n);
    if (label) return label;
  }
  return null;
}

function inferApparelCategory(
  ctx: SizeResolutionContext,
  product: CatalogProductSummary,
): "blazer" | "shoe" | "generic" {
  const hay = `${ctx.category ?? ""} ${ctx.query ?? ""} ${product.title ?? ""}`.toLowerCase();
  if (/blazer|sportcoat|sport coat|suit jacket|suit coat|sport jacket/i.test(hay)) {
    return "blazer";
  }
  if (/shoe|sneaker|boot|footwear|loafer|sandal/i.test(hay)) {
    return "shoe";
  }
  return "generic";
}

function fixedSkuMatchesToken(
  parsed: NonNullable<ReturnType<typeof parseFixedListingSize>>,
  token: string,
  category: "blazer" | "shoe" | "generic",
): boolean {
  const reqLetter = normalizeLetter(token);
  const reqNum = firstSizeNumber(token);
  const chestLen = parseChestLengthSize(token);

  if (parsed.letter && reqLetter) {
    return parsed.letter === reqLetter;
  }
  const chestTarget = chestLen?.chest ?? reqNum;
  if (parsed.chest != null && chestTarget != null) {
    return parsed.chest === chestTarget;
  }
  if (parsed.chest != null && reqLetter && category === "blazer") {
    const allowed = MENS_BLAZER_CHEST_BY_LETTER[reqLetter] ?? [];
    return allowed.includes(parsed.chest);
  }
  if (parsed.letter && chestTarget != null) {
    const allowed = MENS_BLAZER_CHEST_BY_LETTER[parsed.letter] ?? [];
    return allowed.includes(chestTarget);
  }
  return false;
}

type OptionMatch = {
  merchantLabel: string;
  method: SizeResolutionMethod;
  matchedToken: string;
  confidence: number;
};

function resolveAgainstSizeOptions(
  values: Array<{ label: string }>,
  parsed: ParsedRequestedSize,
  category: "blazer" | "shoe" | "generic",
): OptionMatch | null {
  const tokens = parsed.tokens;

  const byLabel = pickOptionByLabel(values, tokens);
  if (byLabel) {
    return {
      merchantLabel: byLabel.label,
      method: byLabel.exact ? "option_exact" : "option_fuzzy",
      matchedToken: byLabel.token,
      confidence: byLabel.exact ? 1 : 0.92,
    };
  }

  for (const token of tokens) {
    const byLetter = pickOptionByLetterToken(values, token);
    if (byLetter) {
      return {
        merchantLabel: byLetter,
        method: "option_letter_token",
        matchedToken: token,
        confidence: 0.92,
      };
    }
  }

  for (const token of tokens) {
    const chestLen = parseChestLengthSize(token);
    const num = chestLen?.chest ?? firstSizeNumber(token);
    if (num != null) {
      const byNum = pickOptionByNumber(values, num);
      if (byNum) {
        return {
          merchantLabel: byNum,
          method: "option_numeric",
          matchedToken: token,
          confidence: 0.9,
        };
      }
    }
  }

  const byChestLength = pickOptionByChestLengthLabel(values, tokens);
  if (byChestLength) return byChestLength;

  if (category === "blazer") {
    for (const token of tokens) {
      const letter = normalizeLetter(token);
      if (!letter) continue;
      const byMap = pickOptionByChestMap(values, letter);
      if (byMap) {
        return {
          merchantLabel: byMap,
          method: "chest_map",
          matchedToken: token,
          confidence: 0.88,
        };
      }
    }

    /** Map suiting chest (40R, 42, 42R) → letter → merchant label (incl. weight bands). */
    for (const token of tokens) {
      const chest = chestFromToken(token);
      if (chest == null) continue;
      for (const letter of lettersForChestMatch(chest)) {
        const byLetter = pickOptionByLetterToken(values, letter);
        if (byLetter) {
          return {
            merchantLabel: byLetter,
            method: "chest_map",
            matchedToken: token,
            confidence: 0.86,
          };
        }
      }
    }
  }

  return null;
}

/** True when labels hint at a mappable size but rules didn't match. */
function hasPartialOptionSignal(
  values: Array<{ label: string }>,
  parsed: ParsedRequestedSize,
): boolean {
  for (const token of parsed.tokens) {
    if (pickOptionByLetterToken(values, token)) return true;
    const letter = normalizeLetter(token);
    if (letter && pickOptionByLetterToken(values, letter)) return true;
    const num = parseChestLengthSize(token)?.chest ?? firstSizeNumber(token);
    if (num != null && pickOptionByNumber(values, num)) return true;
    const chest = chestFromToken(token);
    if (chest != null && pickOptionByChestLengthLabel(values, [token])) return true;
    if (chest != null) {
      for (const mapped of lettersForChestMatch(chest)) {
        if (pickOptionByLetterToken(values, mapped)) return true;
      }
    }
  }
  if (labelsUseFullWords(values) && hasChestSizeRequest(parsed)) return true;
  return false;
}

/**
 * Whether a failed deterministic resolution should escalate to batched LLM.
 */
export function sizeResolutionNeedsLlm(
  resolution: SizeResolution,
  parsed: ParsedRequestedSize,
  product: CatalogProductSummary,
): boolean {
  if (resolution.status === "unknown") return true;
  if (resolution.status === "match") return false;

  const sizeOpt = findSizeOption(product);
  if (sizeOpt?.values?.length) {
    if (parsed.compound) return true;
    if (labelsLookExotic(sizeOpt.values)) return true;
    if (labelsUseWeightBands(sizeOpt.values) && hasChestSizeRequest(parsed)) {
      return true;
    }
    if (labelsUseFullWords(sizeOpt.values) && hasChestSizeRequest(parsed)) {
      return true;
    }
    if (hasPartialOptionSignal(sizeOpt.values, parsed)) return true;
    if (resolution.status === "mismatch" && sizingSchemeMismatch(sizeOpt.values, parsed)) {
      return true;
    }
  }

  if (resolution.status === "mismatch" && parsed.compound) return true;
  return false;
}

/**
 * Deterministic size resolution for one product. Returns `unknown` when the
 * listing gives no usable signal or mapping is ambiguous — batched LLM may
 * resolve those next.
 */
export function resolveSizeDeterministic(
  requestedSize: string,
  product: CatalogProductSummary,
  ctx: SizeResolutionContext = {},
): SizeResolution {
  const parsed = expandRequestedSizeTokens(requestedSize);
  if (!parsed.tokens.length) {
    return { status: "unknown", reason: "No requested size" };
  }

  const category = inferApparelCategory(ctx, product);
  const values = collectSizeOptionValues(product);

  if (values.length) {
    const hit = resolveAgainstSizeOptions(values, parsed, category);
    if (hit) {
      return {
        status: "match",
        merchantLabel: hit.merchantLabel,
        method: hit.method,
        matchedToken: hit.matchedToken,
        confidence: hit.confidence,
        reason:
          parsed.compound && hit.matchedToken !== parsed.raw
            ? `Matched token "${hit.matchedToken}" from compound brief "${parsed.raw}"`
            : undefined,
      };
    }

    if (
      parsed.compound ||
      labelsLookExotic(values) ||
      sizingSchemeMismatch(values, parsed) ||
      hasPartialOptionSignal(values, parsed) ||
      (labelsUseFullWords(values) && hasChestSizeRequest(parsed))
    ) {
      return {
        status: "unknown",
        reason: `Ambiguous size mapping for "${parsed.raw}" — merchant labels: ${values.map((v) => v.label).slice(0, 6).join(", ")}`,
      };
    }

    return {
      status: "mismatch",
      reason: `Size option axis exists but none match "${parsed.raw}"`,
      confidence: 0.9,
    };
  }

  if (isSingleSkuListing(product)) {
    const listing = parseFixedListingSize(product);
    if (!listing) {
      return {
        status: "unknown",
        reason: "Single-SKU listing with no parseable size in title/variant",
      };
    }
    for (const token of parsed.tokens) {
      if (fixedSkuMatchesToken(listing, token, category)) {
        return {
          status: "match",
          parsedListingSize: listing.label,
          method: "sku_parsed",
          matchedToken: token,
          confidence: 0.88,
          reason: `Fixed SKU size ${listing.label} matches token ${token}`,
        };
      }
    }
    if (parsed.compound) {
      return {
        status: "unknown",
        reason: `Ambiguous fixed-SKU size ${listing.label} vs compound brief "${parsed.raw}"`,
      };
    }
    return {
      status: "mismatch",
      reason: `Fixed SKU size ${listing.label} does not match "${parsed.raw}"`,
      parsedListingSize: listing.label,
      confidence: 0.9,
    };
  }

  return {
    status: "unknown",
    reason: "No size option axis and not a single-SKU listing",
  };
}

export function formatSizeDropReason(resolution: SizeResolution | undefined): string {
  if (!resolution) return "Requested size not available for this listing";
  if (resolution.status === "mismatch") return resolution.reason;
  if (resolution.status === "unknown") return resolution.reason;
  return "Requested size not available for this listing";
}

export function isExactSizeVerified(
  sizeRequired: boolean,
  resolution: SizeResolution | undefined,
  preferredMatched: boolean | null,
): boolean {
  if (!sizeRequired) return true;
  if (!resolution || resolution.status !== "match") return false;
  if (preferredMatched === false) return false;
  if (preferredMatched === true) return true;
  return resolution.confidence >= 0.85;
}

/** Keep in-stock finalists when size mapping is uncertain (show verify-size badge). */
export function shouldSurfaceWithSizeVerification(
  sizeRequired: boolean,
  resolution: SizeResolution | undefined,
  preferredMatched: boolean | null,
): boolean {
  if (!sizeRequired) return false;
  if (preferredMatched === false) return false;
  if (resolution?.status === "mismatch") return false;
  return !isExactSizeVerified(sizeRequired, resolution, preferredMatched);
}

export function sizeResolutionContextFromBrief(
  brief: SearchBrief,
): SizeResolutionContext {
  return { category: brief.category, query: brief.query };
}

export type SizeResolutionMap = Map<string, SizeResolution>;

/** Build a product payload for batched LLM size matching. */
export function sizeResolutionLlmPayload(
  candidate: ScoredCandidate,
  ctx: SizeResolutionContext,
  parsed?: ParsedRequestedSize,
): {
  id: string;
  title: string;
  size_labels: string[];
  listing_type: "multi_variant" | "single_sku";
  parsed_listing_size?: string;
  brief_size_tokens?: string[];
  sizing_notes?: string;
  inferred_letter?: string | null;
} {
  const product = candidate.product;
  const sizeLabels = collectSizeOptionValues(product);
  const listing = parseFixedListingSize(product);
  const meta = product.metadata as { tech_specs?: string } | undefined;
  let inferredLetter: string | null = null;
  if (parsed) {
    for (const token of parsed.tokens) {
      const chest = chestFromToken(token);
      if (chest == null) continue;
      inferredLetter = letterForChest(chest);
      if (inferredLetter) break;
    }
  }
  return {
    id: product.id,
    title: (product.title ?? "").trim() || product.id,
    size_labels: sizeLabels.map((v) => v.label),
    listing_type: isSingleSkuListing(product) ? "single_sku" : "multi_variant",
    ...(listing ? { parsed_listing_size: listing.label } : {}),
    ...(parsed ? { brief_size_tokens: parsed.tokens } : {}),
    ...(meta?.tech_specs ? { sizing_notes: meta.tech_specs.slice(0, 400) } : {}),
    inferred_letter: inferredLetter,
  };
}

export function applyLlmSizeResolution(
  resolution: SizeResolution,
  llm: {
    verdict: "match" | "mismatch" | "unknown";
    resolved_label?: string;
    parsed_listing_size?: string;
    confidence?: number;
    reason?: string;
  },
): SizeResolution {
  const confidence = llm.confidence ?? 0;
  if (llm.verdict === "match" && confidence >= 0.85) {
    return {
      status: "match",
      merchantLabel: llm.resolved_label,
      parsedListingSize: llm.parsed_listing_size,
      method: "llm",
      confidence,
      reason: llm.reason,
    };
  }
  if (llm.verdict === "mismatch" && confidence >= 0.85) {
    return {
      status: "mismatch",
      reason: llm.reason ?? "LLM: size mismatch",
      parsedListingSize: llm.parsed_listing_size,
      confidence,
    };
  }
  if (resolution.status === "unknown" || resolution.status === "mismatch") {
    return {
      status: "unknown",
      reason: llm.reason ?? resolution.reason,
    };
  }
  return resolution;
}
