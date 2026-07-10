/**
 * Query hygiene (search hardening Fix 1).
 *
 * Catalog `query` strings must describe the product type only — occasion,
 * recipient, age, gender, and budget context belong in `context.intent`.
 */
import { requiredColors } from "./constraint-gate";
import type {
  PortfolioQuery,
  SearchBrief,
  SearchBriefBudget,
} from "./types";

/** Tokens that must never appear in a catalog search query. */
export const BANNED_IN_QUERY = [
  "gift",
  "gifts",
  "gift set",
  "gift sets",
  "gift box",
  "gift basket",
  "gift card",
  "gift guide",
  "gift idea",
  "gift ideas",
  "perfect gift",
  "present",
  "presents",
  "present set",
  "unique",
  "cool",
  "from friends",
  "birthday",
  "anniversary",
  "christmas",
  "holiday",
  "occasion",
  "for him",
  "for her",
  "for men",
  "for women",
  "for dad",
  "for mom",
  "for brother",
  "for boyfriend",
  "for husband",
  "young adult",
  "teen",
  "teenager",
  "male",
  "female",
  "man",
  "woman",
] as const;

/** Vague tokens that bias retrieval toward trinkets — avoid when possible. */
export const SOFT_DEMOTE_IN_QUERY = [
  "accessories",
  "stuff",
  "items",
  "gear",
  "idea",
  "ideas",
] as const;

const VAGUE_ONLY = new Set(
  [...BANNED_IN_QUERY, ...SOFT_DEMOTE_IN_QUERY].map((t) => t.toLowerCase()),
);

const PRODUCT_NOUN_HINTS = new Set([
  "shoes",
  "sneakers",
  "trainers",
  "boots",
  "shirt",
  "tee",
  "t-shirt",
  "jacket",
  "hoodie",
  "watch",
  "earbuds",
  "headphones",
  "speaker",
  "bottle",
  "bag",
  "backpack",
  "duffel",
  "mat",
  "tracker",
  "keyboard",
  "hub",
  "charger",
  "stand",
  "band",
  "set",
  "kit",
  "sweater",
  "dress",
  "pants",
  "jeans",
  "perfume",
  "candle",
  "mug",
  "blanket",
  "pillow",
  "lamp",
  "desk",
  "chair",
  "camera",
  "tablet",
  "laptop",
  "mouse",
  "monitor",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function containsPhrase(text: string, phrase: string): boolean {
  const hay = text.toLowerCase();
  const needle = phrase.toLowerCase();
  return hay.includes(needle);
}

export function queryContainsBannedToken(text: string): boolean {
  return BANNED_IN_QUERY.some((b) => containsPhrase(text, b));
}

/** Remove banned / demoted tokens; collapse whitespace. */
export function stripQueryTokens(text: string): string {
  let out = text.trim();
  // Strip gift-* compounds (giftware, giftset, etc.) before phrase rules.
  out = out.replace(/\bgift[\w-]*/giu, " ");
  for (const banned of [...BANNED_IN_QUERY, ...SOFT_DEMOTE_IN_QUERY]) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(banned)}\\b`, "giu"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the query names a concrete product (not only adjectives / occasion words). */
export function queryHasConcreteProductNoun(text: string): boolean {
  const tokens = tokenize(text);
  if (tokens.length === 0) return false;
  if (
    tokens.some(
      (t) =>
        PRODUCT_NOUN_HINTS.has(t) || PRODUCT_NOUN_HINTS.has(t.replace(/s$/, "")),
    )
  ) {
    return true;
  }
  if (tokens.length < 2) return false;
  return tokens.some((t) => t.length >= 4 && !VAGUE_ONLY.has(t));
}

export function isValidCatalogQuery(text: string): boolean {
  const q = text.trim();
  if (q.length < 3) return false;
  if (queryContainsBannedToken(q)) return false;
  return queryHasConcreteProductNoun(q);
}

/** Build intent text for context.intent (recipient, occasion, budget — never in query). */
export function buildSearchIntent(brief: SearchBrief, extra?: string): string | undefined {
  const parts: string[] = [];
  if (extra?.trim()) parts.push(extra.trim());
  if (brief.useCase?.trim()) parts.push(brief.useCase.trim());
  if (brief.directionLabel?.trim()) {
    parts.push(`Gift direction: ${brief.directionLabel.trim()}`);
  }
  if (brief.recipient.kind === "other") {
    const who = brief.recipient.label?.trim() || "recipient";
    parts.push(`Gift for ${who}`);
    if (brief.recipient.knownInterests?.length) {
      parts.push(`Interests: ${brief.recipient.knownInterests.join(", ")}`);
    }
  }
  if (
    brief.budget &&
    (brief.budget.amountCents != null || brief.budget.maxCents != null)
  ) {
    const ceiling = brief.budget.maxCents ?? brief.budget.amountCents!;
    const floor = brief.budget.minCents;
    const dollars = (ceiling / 100).toFixed(0);
    if (floor != null && floor > 0) {
      const floorDollars = (floor / 100).toFixed(0);
      parts.push(
        `Budget ${floorDollars}–$${dollars} ${brief.budget.currency} (${brief.budget.type})`,
      );
    } else {
      parts.push(
        `Budget ~$${dollars} ${brief.budget.currency} (${brief.budget.type})`,
      );
    }
  }
  const joined = parts.join(". ");
  return joined.length ? joined : undefined;
}

/**
 * Sanitize a raw query phrase for catalog search. Banned tokens are stripped;
 * if nothing usable remains, fall back to `category` or the first product noun
 * found in the original text.
 */
export function sanitizeQueryText(raw: string, brief?: SearchBrief): string {
  let q = stripQueryTokens(raw);
  if (isValidCatalogQuery(q)) return q;

  if (brief?.category?.trim()) {
    q = stripQueryTokens(brief.category);
    if (isValidCatalogQuery(q)) return q;
  }

  if (brief?.directionLabel?.trim() && isGiftArchetypeBrief(brief)) {
    q = stripQueryTokens(brief.directionLabel);
    if (isValidCatalogQuery(q)) return q;
  }

  // Last resort: keep longest non-banned tokens from the original.
  const kept = tokenize(raw).filter((t) => !VAGUE_ONLY.has(t) && t.length >= 3);
  q = kept.slice(0, 5).join(" ");
  q = stripQueryTokens(q);
  return q.trim();
}

function isGiftArchetypeBrief(brief: SearchBrief): boolean {
  return brief.archetype === "gift_directed" || brief.archetype === "gift_vague";
}

/** Coerce missing/null variant constraints to a safe empty object. */
export function normalizeVariantConstraints(
  vc: SearchBrief["variantConstraints"] | null | undefined,
): SearchBrief["variantConstraints"] {
  return vc ?? {};
}

const DEFAULT_SEARCH_BRIEF_BUDGET: SearchBriefBudget = {
  amountCents: null,
  minCents: null,
  maxCents: null,
  type: "none",
  currency: "USD",
};

/** Coerce missing/null budget to a safe open-budget object. */
export function normalizeSearchBriefBudget(
  budget: SearchBriefBudget | null | undefined,
  fallbackCurrency = "USD",
): SearchBriefBudget {
  if (!budget || typeof budget.type !== "string") {
    return { ...DEFAULT_SEARCH_BRIEF_BUDGET, currency: fallbackCurrency };
  }
  return {
    amountCents: budget.amountCents ?? null,
    minCents: budget.minCents ?? null,
    maxCents: budget.maxCents ?? budget.amountCents ?? null,
    type: budget.type,
    currency: budget.currency ?? fallbackCurrency,
  };
}

/** Sanitize the brief seed query; merge stripped occasion language into useCase. */
export function sanitizeSearchBrief(brief: SearchBrief): SearchBrief {
  const original = brief.query;
  const cleaned = sanitizeQueryText(original, brief);
  const stripped = original.trim().toLowerCase();
  const cleanedLower = cleaned.toLowerCase();
  const occasionBits: string[] = [];
  if (stripped !== cleanedLower) {
    for (const b of BANNED_IN_QUERY) {
      if (containsPhrase(original, b)) occasionBits.push(b);
    }
  }
  const useCase =
    [brief.useCase, occasionBits.length ? occasionBits.join(", ") : ""]
      .filter(Boolean)
      .join("; ")
      .trim() || brief.useCase;

  return {
    ...brief,
    query: cleaned || brief.category || "product",
    useCase: useCase || brief.useCase,
    variantConstraints: normalizeVariantConstraints(brief.variantConstraints),
    budget: normalizeSearchBriefBudget(brief.budget),
  };
}

/** Craft a portfolio query string + intent from a concrete product type phrase. */
export function craftPortfolioQuery(
  productType: string,
  brief: SearchBrief,
  intentExtra?: string,
): { text: string; intent?: string } {
  const gp =
    brief.recipient.kind === "other" ? "" : genderPrefixForBrief(brief);
  const text = sanitizeQueryText(`${gp}${productType}`.trim(), brief);
  const intent = buildSearchIntent(brief, intentExtra);
  return { text, intent };
}

function genderPrefixForBrief(brief: SearchBrief): string {
  switch (brief.genderScope) {
    case "mens":
      return "men's ";
    case "womens":
      return "women's ";
    default:
      return "";
  }
}

/** Tokens stripped from query.text that should be preserved in intent. */
function strippedContextFromQuery(original: string, cleaned: string): string {
  const bits: string[] = [];
  const origLower = original.trim().toLowerCase();
  const cleanLower = cleaned.trim().toLowerCase();
  if (origLower === cleanLower) return "";
  for (const banned of BANNED_IN_QUERY) {
    if (containsPhrase(original, banned)) bits.push(banned);
  }
  return bits.length ? bits.join(", ") : "";
}

function mergeIntent(base: string | undefined, relocated: string): string | undefined {
  const parts = [base?.trim(), relocated.trim()].filter(Boolean);
  return parts.length ? parts.join(". ") : undefined;
}

/**
 * Deterministic gate for every query string before `search_catalog`.
 * Strips banned tokens, rejects invalid rows, relocates stripped context to intent.
 */
export function sanitizePortfolioQuery(
  query: PortfolioQuery,
  brief: SearchBrief,
): PortfolioQuery | null {
  const original = query.text.trim();
  if (!original) return null;

  let text = stripQueryTokens(original);
  if (!text) {
    text = sanitizeQueryText(original, brief);
  } else if (!isValidCatalogQuery(text)) {
    const fallback = sanitizeQueryText(original, brief);
    if (isValidCatalogQuery(fallback)) text = fallback;
  }

  if (!text || queryContainsBannedToken(text) || !queryHasConcreteProductNoun(text)) {
    return null;
  }

  // Self-shopping: gender belongs in every wave — mechanically append when missing.
  if (brief.recipient.kind === "self") {
    text = ensureGenderPrefixInQuery(text, brief);
  }

  if (query.isDiscovery) {
    text = anchorMustHavesInQuery(text, brief);
  }

  const relocated = strippedContextFromQuery(original, text);
  const intent = mergeIntent(query.intent, relocated);

  return {
    ...query,
    text,
    intent,
  };
}

/** Discovery queries may explore adjacent space but must keep must-have anchors. */
export function anchorMustHavesInQuery(text: string, brief: SearchBrief): string {
  let q = text.trim();
  const lower = q.toLowerCase();
  for (const color of requiredColors(brief)) {
    if (!lower.includes(color)) {
      q = `${color} ${q}`.trim();
    }
  }
  const structureMusts = brief.mustHaves.filter(
    (m) =>
      m.trim().length >= 4 &&
      !BANNED_IN_QUERY.some((b) => containsPhrase(m, b)) &&
      !/\b(work|office|nightlife|gift|birthday)\b/i.test(m),
  );
  for (const token of structureMusts.slice(0, 2)) {
    const t = token.trim().toLowerCase();
    if (t.length >= 4 && !q.toLowerCase().includes(t)) {
      q = `${q} ${token}`.trim();
    }
  }
  return q.replace(/\s+/g, " ").trim();
}

/** Append men's/women's when gender_scope is set and the query omits it. */
export function ensureGenderPrefixInQuery(text: string, brief: SearchBrief): string {
  const q = text.trim();
  if (!q) return q;
  const lower = q.toLowerCase();
  const hasMens = /\bmen'?s?\b/.test(lower) || /\bmens\b/.test(lower);
  const hasWomens = /\bwomen'?s?\b/.test(lower) || /\bwomens\b/.test(lower);
  if (hasMens || hasWomens) return q;
  const prefix = genderPrefixForBrief(brief);
  if (!prefix) return q;
  return `${prefix}${q}`.replace(/\s+/g, " ").trim();
}

/** Filter a portfolio through the catalog query gate (drops invalid rows). */
export function sanitizePortfolioQueries(
  queries: PortfolioQuery[],
  brief: SearchBrief,
): PortfolioQuery[] {
  const out: PortfolioQuery[] = [];
  for (const q of queries) {
    const sanitized = sanitizePortfolioQuery(q, brief);
    if (sanitized) out.push(sanitized);
  }
  return out;
}
