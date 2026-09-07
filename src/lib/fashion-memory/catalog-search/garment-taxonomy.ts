/**
 * Confident garment → Shopify Standard Product Taxonomy GID mappings.
 * Source: Shopify/product-taxonomy dist/en/categories.txt (verified against
 * 2026-02 / latest dump in-repo tooling). Never guess GIDs — omit when absent.
 *
 * Accessory families carry `sizing` so intake/hydration skip size gates for
 * one-size jewelry/neckwear while belts/hats keep simple waist/head sizing.
 */
const TAXONOMY_PREFIX = "gid://shopify/TaxonomyCategory/";

/** Size gating for this garment family. */
export type GarmentSizingMode = "none" | "simple" | "standard";

export type GarmentTaxonomyEntry = {
  id: string;
  label: string;
  /** Default `standard` (apparel). Accessories use none|simple. */
  sizing?: GarmentSizingMode;
};

/** Canonical accessory-family labels for planner trays + coverage metrics. */
export type AccessoryFamily =
  | "belt"
  | "tie"
  | "watch"
  | "bracelet"
  | "jewelry"
  | "bag"
  | "backpack"
  | "briefcase"
  | "wallet"
  | "card_holder"
  | "hat"
  | "scarf"
  | "sunglasses"
  | "socks"
  | "gloves"
  | "cufflinks";

/** Leaf or near-leaf nodes we trust for fashion slots. */
const GARMENT_TAXONOMY: Record<string, GarmentTaxonomyEntry> = {
  shirt: { id: `${TAXONOMY_PREFIX}aa-1-13-7`, label: "Shirts" },
  shirts: { id: `${TAXONOMY_PREFIX}aa-1-13-7`, label: "Shirts" },
  "dress shirt": { id: `${TAXONOMY_PREFIX}aa-1-13-7-2`, label: "Dress Shirts" },
  "t-shirt": { id: `${TAXONOMY_PREFIX}aa-1-13-8`, label: "T-Shirts" },
  tshirt: { id: `${TAXONOMY_PREFIX}aa-1-13-8`, label: "T-Shirts" },
  "t shirt": { id: `${TAXONOMY_PREFIX}aa-1-13-8`, label: "T-Shirts" },
  tee: { id: `${TAXONOMY_PREFIX}aa-1-13-8`, label: "T-Shirts" },
  polo: { id: `${TAXONOMY_PREFIX}aa-1-13-7`, label: "Shirts" },
  polos: { id: `${TAXONOMY_PREFIX}aa-1-13-7`, label: "Shirts" },
  tank: { id: `${TAXONOMY_PREFIX}aa-1-13`, label: "Clothing Tops" },
  "tank top": { id: `${TAXONOMY_PREFIX}aa-1-13`, label: "Clothing Tops" },
  bodysuit: { id: `${TAXONOMY_PREFIX}aa-1-13`, label: "Clothing Tops" },
  bodysuits: { id: `${TAXONOMY_PREFIX}aa-1-13`, label: "Clothing Tops" },
  blouse: { id: `${TAXONOMY_PREFIX}aa-1-13-7`, label: "Shirts" },
  top: { id: `${TAXONOMY_PREFIX}aa-1-13`, label: "Clothing Tops" },
  trousers: { id: `${TAXONOMY_PREFIX}aa-1-12-11`, label: "Trousers" },
  trouser: { id: `${TAXONOMY_PREFIX}aa-1-12-11`, label: "Trousers" },
  pants: { id: `${TAXONOMY_PREFIX}aa-1-12-11`, label: "Trousers" },
  chinos: { id: `${TAXONOMY_PREFIX}aa-1-12-11`, label: "Trousers" },
  chino: { id: `${TAXONOMY_PREFIX}aa-1-12-11`, label: "Trousers" },
  shorts: { id: `${TAXONOMY_PREFIX}aa-1-12-7`, label: "Shorts" },
  short: { id: `${TAXONOMY_PREFIX}aa-1-12-7`, label: "Shorts" },
  jeans: { id: `${TAXONOMY_PREFIX}aa-1-12-4`, label: "Jeans" },
  denim: { id: `${TAXONOMY_PREFIX}aa-1-12-4`, label: "Jeans" },
  blazer: { id: `${TAXONOMY_PREFIX}aa-1-10-2-18`, label: "Blazers" },
  blazers: { id: `${TAXONOMY_PREFIX}aa-1-10-2-18`, label: "Blazers" },
  jacket: { id: `${TAXONOMY_PREFIX}aa-1-10-2`, label: "Coats & Jackets" },
  coat: { id: `${TAXONOMY_PREFIX}aa-1-10-2`, label: "Coats & Jackets" },
  trench: { id: `${TAXONOMY_PREFIX}aa-1-10-2`, label: "Coats & Jackets" },
  "trench coat": { id: `${TAXONOMY_PREFIX}aa-1-10-2`, label: "Coats & Jackets" },
  outerwear: { id: `${TAXONOMY_PREFIX}aa-1-10`, label: "Outerwear" },
  dress: { id: `${TAXONOMY_PREFIX}aa-1-4`, label: "Dresses" },
  dresses: { id: `${TAXONOMY_PREFIX}aa-1-4`, label: "Dresses" },
  "shirt dress": { id: `${TAXONOMY_PREFIX}aa-1-4`, label: "Dresses" },
  shirt_dress: { id: `${TAXONOMY_PREFIX}aa-1-4`, label: "Dresses" },
  skirt: { id: `${TAXONOMY_PREFIX}aa-1-15`, label: "Skirts" },
  skirts: { id: `${TAXONOMY_PREFIX}aa-1-15`, label: "Skirts" },
  shoe: { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  shoes: { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  sneaker: { id: `${TAXONOMY_PREFIX}aa-8-8`, label: "Sneakers" },
  sneakers: { id: `${TAXONOMY_PREFIX}aa-8-8`, label: "Sneakers" },
  trainer: { id: `${TAXONOMY_PREFIX}aa-8-8`, label: "Sneakers" },
  trainers: { id: `${TAXONOMY_PREFIX}aa-8-8`, label: "Sneakers" },
  loafer: { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  loafers: { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  sandal: { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  sandals: { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  heel: { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  heels: { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  "dress shoe": { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  "dress shoes": { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  dress_shoes: { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  boot: { id: `${TAXONOMY_PREFIX}aa-8-3`, label: "Boots" },
  boots: { id: `${TAXONOMY_PREFIX}aa-8-3`, label: "Boots" },
  sweater: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  sweaters: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  knitwear: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  knit: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  jumper: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  cardigan: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  cardigans: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  hoodie: { id: `${TAXONOMY_PREFIX}aa-1-1-7-2`, label: "Hoodies" },
  hoodies: { id: `${TAXONOMY_PREFIX}aa-1-1-7-2`, label: "Hoodies" },
  overshirt: { id: `${TAXONOMY_PREFIX}aa-1-13-7`, label: "Shirts" },
  overshirts: { id: `${TAXONOMY_PREFIX}aa-1-13-7`, label: "Shirts" },
  puffer: { id: `${TAXONOMY_PREFIX}aa-1-10-2`, label: "Coats & Jackets" },
  puffers: { id: `${TAXONOMY_PREFIX}aa-1-10-2`, label: "Coats & Jackets" },
  "puffer jacket": {
    id: `${TAXONOMY_PREFIX}aa-1-10-2`,
    label: "Coats & Jackets",
  },
  sundress: { id: `${TAXONOMY_PREFIX}aa-1-4`, label: "Dresses" },
  sundresses: { id: `${TAXONOMY_PREFIX}aa-1-4`, label: "Dresses" },
  sweats: { id: `${TAXONOMY_PREFIX}aa-1-12-11`, label: "Trousers" },
  sweatpants: { id: `${TAXONOMY_PREFIX}aa-1-12-11`, label: "Trousers" },
  sweatshirt: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  sweatshirts: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  suit: { id: `${TAXONOMY_PREFIX}aa-1-10-2-18`, label: "Blazers" },

  // --- Swimwear (verified GIDs under aa-1-20) ---
  swimwear: { id: `${TAXONOMY_PREFIX}aa-1-20`, label: "Swimwear" },
  swimsuit: { id: `${TAXONOMY_PREFIX}aa-1-20`, label: "Swimwear" },
  swimsuits: { id: `${TAXONOMY_PREFIX}aa-1-20`, label: "Swimwear" },
  swim: { id: `${TAXONOMY_PREFIX}aa-1-20`, label: "Swimwear" },
  bikini: {
    id: `${TAXONOMY_PREFIX}aa-1-20-6`,
    label: "Classic Bikinis",
  },
  bikinis: {
    id: `${TAXONOMY_PREFIX}aa-1-20-6`,
    label: "Classic Bikinis",
  },
  "two-piece": {
    id: `${TAXONOMY_PREFIX}aa-1-20-6`,
    label: "Classic Bikinis",
  },
  "two piece": {
    id: `${TAXONOMY_PREFIX}aa-1-20-6`,
    label: "Classic Bikinis",
  },
  "two-piece swimsuit": {
    id: `${TAXONOMY_PREFIX}aa-1-20-6`,
    label: "Classic Bikinis",
  },
  "two piece swimsuit": {
    id: `${TAXONOMY_PREFIX}aa-1-20-6`,
    label: "Classic Bikinis",
  },
  "bikini set": {
    id: `${TAXONOMY_PREFIX}aa-1-20-6`,
    label: "Classic Bikinis",
  },
  "one-piece": {
    id: `${TAXONOMY_PREFIX}aa-1-20-22`,
    label: "One-Piece Swimsuits",
  },
  "one piece": {
    id: `${TAXONOMY_PREFIX}aa-1-20-22`,
    label: "One-Piece Swimsuits",
  },
  "one-piece swimsuit": {
    id: `${TAXONOMY_PREFIX}aa-1-20-22`,
    label: "One-Piece Swimsuits",
  },
  "one piece swimsuit": {
    id: `${TAXONOMY_PREFIX}aa-1-20-22`,
    label: "One-Piece Swimsuits",
  },
  monokini: {
    id: `${TAXONOMY_PREFIX}aa-1-20-22`,
    label: "One-Piece Swimsuits",
  },
  maillot: {
    id: `${TAXONOMY_PREFIX}aa-1-20-22`,
    label: "One-Piece Swimsuits",
  },
  tankini: { id: `${TAXONOMY_PREFIX}aa-1-20-28`, label: "Tankinis" },
  tankinis: { id: `${TAXONOMY_PREFIX}aa-1-20-28`, label: "Tankinis" },
  boardshorts: { id: `${TAXONOMY_PREFIX}aa-1-20-2`, label: "Boardshorts" },
  "board shorts": { id: `${TAXONOMY_PREFIX}aa-1-20-2`, label: "Boardshorts" },
  "swim shorts": { id: `${TAXONOMY_PREFIX}aa-1-20-30`, label: "Swim Shorts" },
  "swim trunks": { id: `${TAXONOMY_PREFIX}aa-1-20-30`, label: "Swim Shorts" },
  "cover-up": { id: `${TAXONOMY_PREFIX}aa-1-20-7`, label: "Cover Ups" },
  "cover up": { id: `${TAXONOMY_PREFIX}aa-1-20-7`, label: "Cover Ups" },
  coverups: { id: `${TAXONOMY_PREFIX}aa-1-20-7`, label: "Cover Ups" },
  "rash guard": { id: `${TAXONOMY_PREFIX}aa-1-20-12`, label: "Rash Guards" },
  "rash guards": { id: `${TAXONOMY_PREFIX}aa-1-20-12`, label: "Rash Guards" },

  // --- Accessories (verified GIDs) ---
  belt: { id: `${TAXONOMY_PREFIX}aa-2-6`, label: "Belts", sizing: "simple" },
  belts: { id: `${TAXONOMY_PREFIX}aa-2-6`, label: "Belts", sizing: "simple" },
  tie: { id: `${TAXONOMY_PREFIX}aa-2-23`, label: "Neckties", sizing: "none" },
  ties: { id: `${TAXONOMY_PREFIX}aa-2-23`, label: "Neckties", sizing: "none" },
  necktie: { id: `${TAXONOMY_PREFIX}aa-2-23`, label: "Neckties", sizing: "none" },
  neckwear: {
    id: `${TAXONOMY_PREFIX}aa-2-23`,
    label: "Neckties",
    sizing: "none",
  },
  watch: { id: `${TAXONOMY_PREFIX}aa-6-11`, label: "Watches", sizing: "none" },
  watches: { id: `${TAXONOMY_PREFIX}aa-6-11`, label: "Watches", sizing: "none" },
  bracelet: {
    id: `${TAXONOMY_PREFIX}aa-6-3`,
    label: "Bracelets",
    sizing: "none",
  },
  bracelets: {
    id: `${TAXONOMY_PREFIX}aa-6-3`,
    label: "Bracelets",
    sizing: "none",
  },
  jewelry: { id: `${TAXONOMY_PREFIX}aa-6`, label: "Jewelry", sizing: "none" },
  jewellery: { id: `${TAXONOMY_PREFIX}aa-6`, label: "Jewelry", sizing: "none" },
  bag: { id: `${TAXONOMY_PREFIX}aa-5-4`, label: "Handbags", sizing: "none" },
  bags: { id: `${TAXONOMY_PREFIX}aa-5-4`, label: "Handbags", sizing: "none" },
  handbag: { id: `${TAXONOMY_PREFIX}aa-5-4`, label: "Handbags", sizing: "none" },
  handbags: {
    id: `${TAXONOMY_PREFIX}aa-5-4`,
    label: "Handbags",
    sizing: "none",
  },
  tote: { id: `${TAXONOMY_PREFIX}aa-5-4`, label: "Handbags", sizing: "none" },
  // Luggage vertical — verified in same taxonomy dump (not under aa-*).
  backpack: {
    id: `${TAXONOMY_PREFIX}lb-1`,
    label: "Backpacks",
    sizing: "none",
  },
  backpacks: {
    id: `${TAXONOMY_PREFIX}lb-1`,
    label: "Backpacks",
    sizing: "none",
  },
  briefcase: {
    id: `${TAXONOMY_PREFIX}lb-2`,
    label: "Briefcases",
    sizing: "none",
  },
  briefcases: {
    id: `${TAXONOMY_PREFIX}lb-2`,
    label: "Briefcases",
    sizing: "none",
  },
  wallet: {
    id: `${TAXONOMY_PREFIX}aa-5-5-7`,
    label: "Wallets",
    sizing: "none",
  },
  wallets: {
    id: `${TAXONOMY_PREFIX}aa-5-5-7`,
    label: "Wallets",
    sizing: "none",
  },
  "card holder": {
    id: `${TAXONOMY_PREFIX}aa-5-5-2`,
    label: "Card Cases",
    sizing: "none",
  },
  "card holders": {
    id: `${TAXONOMY_PREFIX}aa-5-5-2`,
    label: "Card Cases",
    sizing: "none",
  },
  "card case": {
    id: `${TAXONOMY_PREFIX}aa-5-5-2`,
    label: "Card Cases",
    sizing: "none",
  },
  hat: { id: `${TAXONOMY_PREFIX}aa-2-17`, label: "Hats", sizing: "simple" },
  hats: { id: `${TAXONOMY_PREFIX}aa-2-17`, label: "Hats", sizing: "simple" },
  cap: {
    id: `${TAXONOMY_PREFIX}aa-2-17-1`,
    label: "Baseball Caps",
    sizing: "simple",
  },
  caps: {
    id: `${TAXONOMY_PREFIX}aa-2-17-1`,
    label: "Baseball Caps",
    sizing: "simple",
  },
  scarf: {
    id: `${TAXONOMY_PREFIX}aa-2-26`,
    label: "Scarves & Shawls",
    sizing: "none",
  },
  scarves: {
    id: `${TAXONOMY_PREFIX}aa-2-26`,
    label: "Scarves & Shawls",
    sizing: "none",
  },
  sunglasses: {
    id: `${TAXONOMY_PREFIX}aa-2-27`,
    label: "Sunglasses",
    sizing: "none",
  },
  eyewear: {
    id: `${TAXONOMY_PREFIX}aa-2-27`,
    label: "Sunglasses",
    sizing: "none",
  },
  socks: { id: `${TAXONOMY_PREFIX}aa-1-18`, label: "Socks", sizing: "simple" },
  sock: { id: `${TAXONOMY_PREFIX}aa-1-18`, label: "Socks", sizing: "simple" },
  gloves: {
    id: `${TAXONOMY_PREFIX}aa-2-13`,
    label: "Gloves & Mittens",
    sizing: "simple",
  },
  cufflinks: {
    id: `${TAXONOMY_PREFIX}aa-2-10`,
    label: "Cufflinks",
    sizing: "none",
  },
  // Parent buckets for vague asks — still scoped to accessories.
  accessory: {
    id: `${TAXONOMY_PREFIX}aa-2`,
    label: "Clothing Accessories",
    sizing: "none",
  },
  accessories: {
    id: `${TAXONOMY_PREFIX}aa-2`,
    label: "Clothing Accessories",
    sizing: "none",
  },
  // Pocket squares not present as a leaf in the verified dump — omit GID.
};

function normalizeGarmentKey(garment: string): string {
  return garment.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Exact key or simple English plural — not substring. Used for provenance. */
export function lookupTaxonomyEntryStrict(
  garment: string,
): GarmentTaxonomyEntry | null {
  const key = normalizeGarmentKey(garment).replace(/^(a|an|the)\s+/, "");
  if (!key) return null;
  const direct = GARMENT_TAXONOMY[key];
  if (direct) return direct;
  if (key.endsWith("ies")) {
    const stem = `${key.slice(0, -3)}y`;
    if (GARMENT_TAXONOMY[stem]) return GARMENT_TAXONOMY[stem]!;
  }
  if (key.endsWith("es") && GARMENT_TAXONOMY[key.slice(0, -2)]) {
    return GARMENT_TAXONOMY[key.slice(0, -2)]!;
  }
  if (key.endsWith("s") && GARMENT_TAXONOMY[key.slice(0, -1)]) {
    return GARMENT_TAXONOMY[key.slice(0, -1)]!;
  }
  if (GARMENT_TAXONOMY[`${key}s`]) return GARMENT_TAXONOMY[`${key}s`]!;
  if (GARMENT_TAXONOMY[`${key}es`]) return GARMENT_TAXONOMY[`${key}es`]!;
  return null;
}

function lookupEntry(garment: string): GarmentTaxonomyEntry | null {
  const key = normalizeGarmentKey(garment);
  if (!key) return null;

  const direct = GARMENT_TAXONOMY[key];
  if (direct) return direct;

  // Prefer longer aliases first so "dress shirt" beats "shirt".
  const aliases = Object.entries(GARMENT_TAXONOMY).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [alias, entry] of aliases) {
    if (key.includes(alias) || alias.includes(key)) {
      return entry;
    }
  }
  return null;
}

/**
 * Resolve taxonomy category GID(s) for a slot garment string.
 * Returns empty when no confident mapping — never guess.
 */
export function taxonomyCategoriesForGarment(garment: string): string[] {
  const entry = lookupEntry(garment);
  return entry ? [entry.id] : [];
}

export function hasGarmentTaxonomyMapping(garment: string): boolean {
  return taxonomyCategoriesForGarment(garment).length > 0;
}

/** Stable family id (taxonomy GID, else normalized label) for provenance compares. */
export function garmentFamilyId(garment: string): string {
  const strict = lookupTaxonomyEntryStrict(garment);
  if (strict) return strict.id;
  const words = garment.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 3) {
    const loose = lookupEntry(garment);
    if (loose) return loose.id;
  }
  return normalizeGarmentKey(garment);
}

function mentionCandidates(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((t) => t && t !== "a" && t !== "an" && t !== "the");
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    out.push(tokens[i]!);
    if (i + 1 < tokens.length) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

/** Taxonomy families the client named in free text — table lookup, not a noun regex. */
export function familyIdsMentionedInText(text: string): Set<string> {
  const named = new Set<string>();
  for (const cand of mentionCandidates(text)) {
    const entry = lookupTaxonomyEntryStrict(cand);
    if (entry) named.add(entry.id);
  }
  return named;
}

/** Matched utterance tokens for clarification apply (chip / free-text). */
export function garmentTokensMentionedInText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cand of mentionCandidates(text)) {
    if (!lookupTaxonomyEntryStrict(cand) || seen.has(cand)) continue;
    seen.add(cand);
    out.push(cand);
  }
  return out;
}

/** Size gate mode for a garment string — accessories skip or use simple facts. */
export function garmentSizingMode(garment: string): GarmentSizingMode {
  const entry = lookupEntry(garment);
  if (entry?.sizing) return entry.sizing;
  if (entry) return "standard";
  // Heuristic for unmapped accessory nouns still seen in intake.
  if (
    /\b(bracelet|bracelets|watch|watches|jewelry|jewellery|necktie|neckwear|cufflink|sunglasses|scarf|wallet|bag|tote|briefcase|backpack|accessory|accessories)\b/i.test(
      garment,
    )
  ) {
    return "none";
  }
  if (/\b(belt|belts|hat|hats|cap|caps|glove|gloves|sock|socks|ring|rings)\b/i.test(garment)) {
    return "simple";
  }
  // Unknown family: fail-open — skip size gating rather than invent a bucket.
  return "none";
}

export function isAccessoryGarment(garment: string): boolean {
  const entry = lookupEntry(garment);
  if (entry?.sizing === "none") return true;
  if (entry?.sizing === "simple") {
    // Belts/hats/gloves are accessories; socks stay a deliberate family but
    // still trip accessory-path check-sizing skip rules via sizing mode.
    return /\b(belt|belts|hat|hats|cap|caps|glove|gloves|sock|socks)\b/i.test(
      garment,
    );
  }
  // Unmapped accessory nouns only — unknown clothing nouns are not accessories.
  return (
    /\b(bracelet|bracelets|watch|watches|jewelry|jewellery|necktie|neckwear|cufflink|sunglasses|scarf|wallet|bag|tote|briefcase|backpack|accessory|accessories|belt|belts|hat|hats|cap|caps|glove|gloves)\b/i.test(
      garment,
    )
  );
}

/** Office/professional accessory tray defaults (planner guidance mirror). */
export const OFFICE_ACCESSORY_TRAY: readonly AccessoryFamily[] = [
  "belt",
  "watch",
  "card_holder",
  "bracelet",
  "tie",
  "briefcase",
];
