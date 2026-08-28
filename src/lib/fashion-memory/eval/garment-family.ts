/**
 * Eval garment-family equivalence for truth_match (canonical map + Haiku).
 */
import { tracedLLMCall } from "@/lib/fashion-memory/observability/traced-llm-call";
import { AI_CHAT_LIGHTWEIGHT_MODEL } from "@/lib/ai-chat/constants";

/** Last-token / phrase → canonical family for eval matching. */
const CANON_MAP: Record<string, string> = {
  trouser: "trousers",
  trousers: "trousers",
  pant: "trousers",
  pants: "trousers",
  "dress pant": "trousers",
  "dress pants": "trousers",
  slack: "trousers",
  slacks: "trousers",
  chino: "trousers",
  chinos: "trousers",
  jean: "jeans",
  jeans: "jeans",
  denim: "jeans",
  // Footwear collapses to shoes except boots (different rack)
  sneaker: "shoes",
  sneakers: "shoes",
  trainer: "shoes",
  trainers: "shoes",
  shoe: "shoes",
  shoes: "shoes",
  heel: "shoes",
  heels: "shoes",
  sandal: "shoes",
  sandals: "shoes",
  loafer: "shoes",
  loafers: "shoes",
  boot: "boots",
  boots: "boots",
  // Tops family
  shirt: "top",
  shirts: "top",
  "dress shirt": "top",
  overshirt: "top",
  polo: "top",
  polos: "top",
  "t-shirt": "top",
  tshirt: "top",
  tee: "top",
  tees: "top",
  blouse: "top",
  blouses: "top",
  top: "top",
  tops: "top",
  bottom: "bottom",
  bottoms: "bottom",
  // Jacket family
  blazer: "jacket",
  blazers: "jacket",
  jacket: "jacket",
  jackets: "jacket",
  "suit jacket": "jacket",
  "suit jackets": "jacket",
  "light jacket": "jacket",
  coat: "coat",
  coats: "coat",
  sweater: "sweater",
  sweaters: "sweater",
  hoodie: "hoodie",
  hoodies: "hoodie",
  dress: "dress",
  dresses: "dress",
  sundress: "dress",
  skirt: "skirt",
  skirts: "skirt",
  suit: "suit",
  suits: "suit",
  short: "shorts",
  shorts: "shorts",
  swimwear: "swimwear",
  swimsuit: "swimwear",
  bikini: "swimwear",
  accessory: "accessories",
  accessories: "accessories",
  belt: "belt",
  belts: "belt",
  watch: "watch",
  watches: "watch",
  bag: "bag",
  bags: "bag",
};

/** Vague planner slots that cover concrete families. */
const SLOT_COVERS: Record<string, ReadonlySet<string>> = {
  top: new Set(["top", "sweater", "hoodie"]),
  bottom: new Set(["trousers", "jeans", "shorts", "bottom", "skirt"]),
  shoes: new Set(["shoes", "boots"]),
  jacket: new Set(["jacket", "coat"]),
};

const haikuCache = new Map<string, boolean>();

function stripModifiers(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(dress|smart|casual|formal|navy|black|white|slim|relaxed)\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Deterministic canonical family, or null when unknown. */
export function canonicalGarmentFamily(label: string): string | null {
  const cleaned = stripModifiers(label);
  if (!cleaned) return null;
  if (CANON_MAP[cleaned]) return CANON_MAP[cleaned]!;
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1] ?? "";
  if (CANON_MAP[last]) return CANON_MAP[last]!;
  if (tokens.length >= 2) {
    const pair = `${tokens[tokens.length - 2]} ${last}`;
    if (CANON_MAP[pair]) return CANON_MAP[pair]!;
  }
  return null;
}

export function familiesMatchDeterministic(a: string, b: string): boolean {
  const ca = canonicalGarmentFamily(a);
  const cb = canonicalGarmentFamily(b);
  if (ca && cb) {
    if (ca === cb) return true;
    // Vague slot covers concrete ask (top ⊇ polo, shoes ⊇ loafers).
    if (SLOT_COVERS[cb]?.has(ca)) return true;
    if (SLOT_COVERS[ca]?.has(cb)) return true;
  }
  const la = stripModifiers(a);
  const lb = stripModifiers(b);
  if (la === lb) return true;
  if (la.includes(lb) || lb.includes(la)) return true;
  return false;
}

async function haikuFamiliesEquivalent(
  a: string,
  b: string,
  traceId: string,
): Promise<boolean> {
  const key = [a, b].map((s) => s.toLowerCase().trim()).sort().join("|");
  const cached = haikuCache.get(key);
  if (cached != null) return cached;

  const msg = await tracedLLMCall({
    traceId,
    stage: "eval_garment_family",
    model: AI_CHAT_LIGHTWEIGHT_MODEL,
    systemPrompt:
      "You compare two garment labels. Reply ONLY yes or no — are they the same shopping family (e.g. pants≈trousers, trainers≈sneakers)?",
    disablePromptCache: true,
    maxTokens: 8,
    inputMessages: [
      {
        role: "user",
        content: `A: ${a}\nB: ${b}`,
      },
    ],
  });
  const text = msg.content
    .filter((block) => block.type === "text")
    .map((block) => ("text" in block ? block.text : ""))
    .join("")
    .trim()
    .toLowerCase();
  const yes = text.startsWith("y");
  haikuCache.set(key, yes);
  return yes;
}

/**
 * True when expected garment is covered by one of the got labels (family match).
 * Uses Haiku only when both sides lack a canonical family.
 */
export async function garmentCoveredByBrief(params: {
  expected: string;
  got: string[];
  traceId: string;
  allowHaiku?: boolean;
}): Promise<boolean> {
  const { expected, got, traceId, allowHaiku = true } = params;
  for (const g of got) {
    if (familiesMatchDeterministic(expected, g)) return true;
  }
  if (!allowHaiku) return false;
  const expCanon = canonicalGarmentFamily(expected);
  if (expCanon) {
    // Deterministic map missed a synonym on got — still try Haiku once.
    for (const g of got) {
      if (canonicalGarmentFamily(g)) continue;
      if (await haikuFamiliesEquivalent(expected, g, traceId)) return true;
    }
    return false;
  }
  for (const g of got) {
    if (await haikuFamiliesEquivalent(expected, g, traceId)) return true;
  }
  return false;
}

/** Sync family sets for slots↔brief drift (no Haiku). */
export function familySet(labels: string[]): Set<string> {
  const out = new Set<string>();
  for (const g of labels) {
    const c = canonicalGarmentFamily(g) ?? stripModifiers(g);
    if (c) out.add(c);
  }
  return out;
}

export function familySetsEqual(a: string[], b: string[]): boolean {
  const sa = familySet(a);
  const sb = familySet(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}
