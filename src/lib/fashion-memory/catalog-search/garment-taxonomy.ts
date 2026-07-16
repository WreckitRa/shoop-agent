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
  blouse: { id: `${TAXONOMY_PREFIX}aa-1-13-7`, label: "Shirts" },
  top: { id: `${TAXONOMY_PREFIX}aa-1-13`, label: "Clothing Tops" },
  trousers: { id: `${TAXONOMY_PREFIX}aa-1-12-11`, label: "Trousers" },
  trouser: { id: `${TAXONOMY_PREFIX}aa-1-12-11`, label: "Trousers" },
  pants: { id: `${TAXONOMY_PREFIX}aa-1-12-11`, label: "Trousers" },
  chinos: { id: `${TAXONOMY_PREFIX}aa-1-12-11`, label: "Trousers" },
  shorts: { id: `${TAXONOMY_PREFIX}aa-1-12-7`, label: "Shorts" },
  short: { id: `${TAXONOMY_PREFIX}aa-1-12-7`, label: "Shorts" },
  jeans: { id: `${TAXONOMY_PREFIX}aa-1-12-4`, label: "Jeans" },
  denim: { id: `${TAXONOMY_PREFIX}aa-1-12-4`, label: "Jeans" },
  blazer: { id: `${TAXONOMY_PREFIX}aa-1-10-2-18`, label: "Blazers" },
  blazers: { id: `${TAXONOMY_PREFIX}aa-1-10-2-18`, label: "Blazers" },
  jacket: { id: `${TAXONOMY_PREFIX}aa-1-10-2`, label: "Coats & Jackets" },
  coat: { id: `${TAXONOMY_PREFIX}aa-1-10-2`, label: "Coats & Jackets" },
  outerwear: { id: `${TAXONOMY_PREFIX}aa-1-10`, label: "Outerwear" },
  dress: { id: `${TAXONOMY_PREFIX}aa-1-4`, label: "Dresses" },
  dresses: { id: `${TAXONOMY_PREFIX}aa-1-4`, label: "Dresses" },
  skirt: { id: `${TAXONOMY_PREFIX}aa-1-15`, label: "Skirts" },
  skirts: { id: `${TAXONOMY_PREFIX}aa-1-15`, label: "Skirts" },
  shoe: { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  shoes: { id: `${TAXONOMY_PREFIX}aa-8`, label: "Shoes" },
  sneaker: { id: `${TAXONOMY_PREFIX}aa-8-8`, label: "Sneakers" },
  sneakers: { id: `${TAXONOMY_PREFIX}aa-8-8`, label: "Sneakers" },
  trainer: { id: `${TAXONOMY_PREFIX}aa-8-8`, label: "Sneakers" },
  trainers: { id: `${TAXONOMY_PREFIX}aa-8-8`, label: "Sneakers" },
  boot: { id: `${TAXONOMY_PREFIX}aa-8-3`, label: "Boots" },
  boots: { id: `${TAXONOMY_PREFIX}aa-8-3`, label: "Boots" },
  sweater: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  sweaters: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  knitwear: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  jumper: { id: `${TAXONOMY_PREFIX}aa-1-13-12`, label: "Sweaters" },
  hoodie: { id: `${TAXONOMY_PREFIX}aa-1-1-7-2`, label: "Hoodies" },
  suit: { id: `${TAXONOMY_PREFIX}aa-1-10-2-18`, label: "Blazers" },

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
