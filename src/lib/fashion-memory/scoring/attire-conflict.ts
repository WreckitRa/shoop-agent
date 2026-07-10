/**
 * Cross-garment title suspicion — never a hard drop.
 * Flags titles that name another garment family while omitting the slot's own noun.
 */
import { preNormalize } from "../normalize/pre-normalize";
import type { ProductSuspicion } from "../hard-drops/types";

/** Conflict nouns keyed loosely off garmentToTaxonomy / item-type families. */
const CONFLICT_NOUNS: readonly string[] = [
  "tee",
  "t-shirt",
  "tshirt",
  "hoodie",
  "sweatshirt",
  "jeans",
  "jean",
  "dress",
  "skirt",
  "shorts",
  "short",
  "sock",
  "socks",
  "sandal",
  "sandals",
  "sneaker",
  "sneakers",
  "legging",
  "leggings",
  "romper",
  "jumpsuit",
  "bikini",
  "swimsuit",
  "bra",
  "panties",
  "lingerie",
];

/** Own-noun tokens derived from the slot garment string. */
export function slotOwnGarmentNouns(garment: string): Set<string> {
  const raw = garment.trim().toLowerCase();
  const out = new Set<string>();
  if (!raw) return out;

  // Preserve hyphenated compounds before preNormalize splits punctuation.
  const hyphenated = raw.match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) ?? [];
  for (const h of hyphenated) out.add(h);

  const norm = preNormalize(raw);
  for (const tok of norm.split(/\s+/).filter(Boolean)) out.add(tok);

  // Multi-word garments: also keep the full phrase and last head noun.
  if (norm.includes(" ")) {
    out.add(norm);
    const parts = norm.split(/\s+/);
    const head = parts[parts.length - 1];
    if (head) out.add(head);
  }

  // Common aliases
  if (out.has("blazer") || out.has("sportcoat") || out.has("sport coat")) {
    out.add("blazer");
    out.add("jacket");
    out.add("sportcoat");
  }
  if (out.has("trousers") || out.has("pants") || out.has("dress pants")) {
    out.add("pants");
    out.add("trousers");
    out.add("trouser");
    out.add("pant");
  }
  if (
    out.has("shirt") ||
    out.has("dress shirt") ||
    out.has("oxford") ||
    out.has("blouse")
  ) {
    out.add("shirt");
    out.add("shirts");
  }
  if (out.has("shoes") || out.has("dress shoes") || out.has("oxfords")) {
    out.add("shoe");
    out.add("shoes");
    out.add("oxford");
    out.add("oxfords");
  }
  if (out.has("tie") || out.has("necktie")) {
    out.add("tie");
    out.add("ties");
    out.add("necktie");
  }

  return out;
}

/**
 * Tokenize title with hyphenated compounds kept intact, then space tokens.
 * "v-neck t-shirt" → ["v-neck", "t-shirt", ...] so "shirt" does not fire
 * inside "t-shirt" as a bare token for own-noun checks on shirt slots —
 * the compound is the atomic token.
 */
export function titleTokensPreservingCompounds(title: string): string[] {
  const lower = title.toLowerCase();
  const compounds = lower.match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) ?? [];
  let scratch = lower;
  const placeholders: string[] = [];
  for (const c of compounds) {
    // Letter-only placeholders — preNormalize strips `_` / punctuation.
    const key = `zzcompound${placeholders.length}zz`;
    placeholders.push(c);
    scratch = scratch.replace(c, key);
  }
  const norm = preNormalize(scratch);
  const tokens: string[] = [];
  for (const part of norm.split(/\s+/).filter(Boolean)) {
    const m = /^zzcompound(\d+)zz$/.exec(part);
    if (m) {
      tokens.push(placeholders[Number(m[1])]!);
    } else {
      tokens.push(part);
    }
  }
  return tokens;
}

export function detectAttireConflictTitle(params: {
  title: string;
  garment: string;
}): ProductSuspicion | null {
  const own = slotOwnGarmentNouns(params.garment);
  const tokens = titleTokensPreservingCompounds(params.title);
  const tokenSet = new Set(tokens);

  const hasOwn = [...own].some((n) => {
    if (n.includes(" ")) {
      const phrase = preNormalize(params.title);
      return phrase.includes(n);
    }
    return tokenSet.has(n);
  });
  if (hasOwn) return null;

  for (const noun of CONFLICT_NOUNS) {
    if (own.has(noun)) continue;
    // Don't treat "shirt" as conflict when compound is t-shirt — handled by
    // compound tokenization; "shirt" alone is not in CONFLICT_NOUNS.
    if (!tokenSet.has(noun)) continue;
    // Skip if the conflict noun is a substring alias of own (e.g. dress in dress shirt)
    if ([...own].some((o) => o.includes(noun) || noun.includes(o))) continue;
    return {
      rule: "attire_conflict_title",
      evidence: `title token "${noun}" conflicts with slot garment "${params.garment}"`,
      source_field: "title",
    };
  }
  return null;
}
