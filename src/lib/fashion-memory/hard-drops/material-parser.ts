import { preNormalize } from "../normalize/pre-normalize";

export type MaterialPolarity = "present" | "absent" | "faux";

export type MaterialMention = {
  material: string;
  polarity: MaterialPolarity;
  percentage?: number;
};

type LexiconEntry = {
  canonical: string;
  tokens: string[];
  animal?: boolean;
};

const ANIMAL_MATERIALS = new Set([
  "leather",
  "suede",
  "fur",
  "wool",
  "silk",
  "down",
  "shearling",
]);

const FAUX_MARKERS = new Set([
  "faux",
  "vegan",
  "imitation",
  "synthetic",
  "fake",
  "mock",
  "pu",
  "pleather",
  "eco",
]);

const NEGATION_BEFORE = new Set(["non", "no", "not", "without", "free", "zero", "0%"]);
const NEGATION_AFTER = new Set(["free"]);

/** False-friend phrases — evaluated before lexicon hits. */
const FALSE_FRIEND_PHRASES: Array<{
  pattern: RegExp;
  action: "skip" | "faux";
  material?: string;
}> = [
  { pattern: /\bcotton candy\b/, action: "skip" },
  { pattern: /\bsilk touch\b/, action: "skip" },
  { pattern: /\bsilky\b/, action: "skip" },
  { pattern: /\bleather look\b/, action: "faux", material: "leather" },
  { pattern: /\bleather-look\b/, action: "faux", material: "leather" },
  { pattern: /\bwool effect\b/, action: "faux", material: "wool" },
  { pattern: /\bwool-effect\b/, action: "faux", material: "wool" },
];

const LEXICON: LexiconEntry[] = [
  { canonical: "polyester", tokens: ["polyester"] },
  { canonical: "polyester", tokens: ["poly"] }, // bare poly handled specially
  { canonical: "cotton", tokens: ["cotton", "coton", "baumwolle", "algodon", "cotone"] },
  { canonical: "linen", tokens: ["linen", "lin"] },
  { canonical: "wool", tokens: ["wool", "laine", "wolle", "lana"], animal: true },
  { canonical: "merino", tokens: ["merino", "merinos"], animal: true },
  { canonical: "cashmere", tokens: ["cashmere"], animal: true },
  { canonical: "silk", tokens: ["silk", "soie", "seide", "seda", "seta"], animal: true },
  { canonical: "leather", tokens: ["leather", "cuir", "leder", "cuero", "pelle"], animal: true },
  { canonical: "suede", tokens: ["suede"], animal: true },
  { canonical: "fur", tokens: ["fur"], animal: true },
  { canonical: "down", tokens: ["down"], animal: true },
  { canonical: "shearling", tokens: ["shearling"], animal: true },
  { canonical: "nylon", tokens: ["nylon", "polyamide"] },
  { canonical: "viscose", tokens: ["viscose"] },
  { canonical: "rayon", tokens: ["rayon"] },
  { canonical: "elastane", tokens: ["elastane", "spandex", "lycra"] },
  { canonical: "acrylic", tokens: ["acrylic"] },
  { canonical: "denim", tokens: ["denim"] },
  { canonical: "corduroy", tokens: ["corduroy"] },
  { canonical: "velvet", tokens: ["velvet"] },
  { canonical: "satin", tokens: ["satin"] },
  { canonical: "modal", tokens: ["modal"] },
  { canonical: "lyocell", tokens: ["lyocell", "tencel"] },
  { canonical: "bamboo", tokens: ["bamboo"] },
  { canonical: "hemp", tokens: ["hemp"] },
];

const TOKEN_TO_CANONICAL = new Map<string, string>();
for (const entry of LEXICON) {
  for (const token of entry.tokens) {
    TOKEN_TO_CANONICAL.set(token, entry.canonical);
  }
}

function isWordToken(text: string, token: string, index: number): boolean {
  const before = index === 0 ? "" : text[index - 1]!;
  const after = text[index + token.length];
  const beforeOk = !before || /\s/.test(before);
  const afterOk = !after || /\s/.test(after) || /[,.]/.test(after);
  return beforeOk && afterOk;
}

function findTokenIndices(text: string, token: string): number[] {
  const indices: number[] = [];
  let from = 0;
  while (from < text.length) {
    const idx = text.indexOf(token, from);
    if (idx < 0) break;
    if (isWordToken(text, token, idx)) indices.push(idx);
    from = idx + (token.length || 1);
  }
  return indices;
}

function tokensAround(text: string, index: number, tokenLen: number): string[] {
  const slice = text.slice(Math.max(0, index - 40), index + tokenLen + 40);
  return preNormalize(slice).split(/\s+/).filter(Boolean);
}

function percentageFromAdjacentTokens(
  local: string[],
  tokenIdx: number,
): number | undefined {
  const prev = local[tokenIdx - 1];
  if (prev && /^\d+(?:\.\d+)?$/.test(prev)) {
    const n = Number(prev);
    if (n >= 1 && n <= 100) return n;
  }
  const next = local[tokenIdx + 1];
  if (next && /^\d+(?:\.\d+)?$/.test(next)) {
    const n = Number(next);
    if (n >= 1 && n <= 100) return n;
  }
  return undefined;
}

function polarityForHit(params: {
  text: string;
  token: string;
  index: number;
  canonical: string;
  animal: boolean;
}): MaterialPolarity {
  const local = tokensAround(params.text, params.index, params.token.length);
  const tokenIdx = local.findIndex((t) => t === params.token);
  if (tokenIdx < 0) return "present";

  const prev1 = local[tokenIdx - 1];
  const prev2 = local[tokenIdx - 2];
  const next1 = local[tokenIdx + 1];

  // "free" only negates the material immediately before it — not later tokens.
  if (next1 && NEGATION_AFTER.has(next1)) return "absent";
  if (prev1 === "free") return "present";
  if (prev1 && NEGATION_BEFORE.has(prev1)) return "absent";
  if (prev2 && NEGATION_BEFORE.has(prev2) && prev2 !== "free") return "absent";

  if (params.animal) {
    const prev = local[tokenIdx - 1];
    if (prev && FAUX_MARKERS.has(prev)) return "faux";
    if (params.token.endsWith("-look") || params.token.endsWith("-effect")) return "faux";
  }

  return "present";
}

function barePolyAllowed(text: string, index: number): boolean {
  const local = tokensAround(text, index, 3);
  const idx = local.indexOf("poly");
  if (idx < 0) return false;
  const next = local[idx + 1];
  return next === "cotton" || next === "blend" || next === "ester";
}

function applyFalseFriends(normalized: string): MaterialMention[] {
  const out: MaterialMention[] = [];
  for (const rule of FALSE_FRIEND_PHRASES) {
    if (!rule.pattern.test(normalized)) continue;
    if (rule.action === "faux" && rule.material) {
      out.push({ material: rule.material, polarity: "faux" });
    }
  }
  return out;
}

function spansBlockedByFalseFriend(normalized: string, token: string): boolean {
  if (token === "cotton" && /\bcotton candy\b/.test(normalized)) return true;
  if (token === "silk" && (/\bsilk touch\b/.test(normalized) || /\bsilky\b/.test(normalized))) {
    return true;
  }
  return false;
}

/** Tokenizer-based material mention parser — not bare includes/regex on materials. */
export function parseMaterialMentions(text: string): MaterialMention[] {
  if (!text?.trim()) return [];

  const normalized = preNormalize(text);
  if (!normalized) return [];

  const mentions: MaterialMention[] = [...applyFalseFriends(normalized)];
  const seen = new Set<string>();

  const push = (mention: MaterialMention) => {
    const key = `${mention.material}::${mention.polarity}::${mention.percentage ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    mentions.push(mention);
  };

  for (const entry of LEXICON) {
    for (const token of entry.tokens) {
      if (spansBlockedByFalseFriend(normalized, token)) continue;
      if (token === "poly" && !barePolyAllowed(normalized, normalized.indexOf("poly"))) {
        continue;
      }

      for (const index of findTokenIndices(normalized, token)) {
        const local = tokensAround(normalized, index, token.length);
        const tokenIdx = local.findIndex((t) => t === token);
        const polarity = polarityForHit({
          text: normalized,
          token,
          index,
          canonical: entry.canonical,
          animal: entry.animal ?? ANIMAL_MATERIALS.has(entry.canonical),
        });
        const percentage =
          polarity === "present" && tokenIdx >= 0
            ? percentageFromAdjacentTokens(local, tokenIdx)
            : undefined;
        push({ material: entry.canonical, polarity, percentage });
      }
    }
  }

  return mentions;
}

export function mentionsBannedMaterial(
  mentions: MaterialMention[],
  banned: string,
): MaterialMention[] {
  const key = preNormalize(banned);
  const canonical = TOKEN_TO_CANONICAL.get(key) ?? key;
  return mentions.filter((m) => m.material === canonical);
}
