/**
 * Confident garment → Shopify Standard Product Taxonomy GID mappings.
 * Source: Shopify/product-taxonomy dist/en/categories.txt (2026-02 release).
 *
 * If a garment string does not match confidently, omit the category filter —
 * a wrong GID silently returns zero results; no filter only ranks worse.
 */
const TAXONOMY_PREFIX = "gid://shopify/TaxonomyCategory/";

export type GarmentTaxonomyEntry = {
  id: string;
  label: string;
};

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
  belt: { id: `${TAXONOMY_PREFIX}aa-2-6`, label: "Belts" },
  scarf: { id: `${TAXONOMY_PREFIX}aa-2-26`, label: "Scarves & Shawls" },
  tie: { id: `${TAXONOMY_PREFIX}aa-2-23`, label: "Neckties" },
  hat: { id: `${TAXONOMY_PREFIX}aa-2-17`, label: "Hats" },
  accessory: { id: `${TAXONOMY_PREFIX}aa-2`, label: "Clothing Accessories" },
  accessories: { id: `${TAXONOMY_PREFIX}aa-2`, label: "Clothing Accessories" },
};

function normalizeGarmentKey(garment: string): string {
  return garment.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolve taxonomy category GID(s) for a slot garment string.
 * Returns empty when no confident mapping — never guess.
 */
export function taxonomyCategoriesForGarment(garment: string): string[] {
  const key = normalizeGarmentKey(garment);
  if (!key) return [];

  const direct = GARMENT_TAXONOMY[key];
  if (direct) return [direct.id];

  for (const [alias, entry] of Object.entries(GARMENT_TAXONOMY)) {
    if (key.includes(alias) || alias.includes(key)) {
      return [entry.id];
    }
  }

  return [];
}

export function hasGarmentTaxonomyMapping(garment: string): boolean {
  return taxonomyCategoriesForGarment(garment).length > 0;
}
