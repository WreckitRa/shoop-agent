/**
 * Slot item-type verification — the taxonomy-absent safety net.
 *
 * `checkCategoryMismatch` (category-coverage.ts) drops products whose Shopify
 * taxonomy GID sits outside the slot's expected family. But most merchant
 * catalogs ship NO taxonomy category, so shoelaces, socks, sandals, and
 * dresses sail into a "dress shoes" slot and the curator has to veto them one
 * by one. This module recovers the garment family from the TITLE and drops
 * confident cross-family junk.
 *
 * This is NOT the taxonomy-only garment no-go rule (checkGarmentNoGo). That
 * rule bans *user-specified* garments and must never text-match (a false ban
 * removes a legit item the user wanted). Here we do *positive slot* item-type
 * verification: we only drop when the title's HEAD NOUN confidently names a
 * different family than the slot expects. Ambiguous / unrecognized titles
 * always survive (unknown never drops).
 */
import { preNormalize } from "../normalize/pre-normalize";
import { titleTokens } from "../department";
import {
  isGenderedDepartment,
  resolveSearchDepartment,
  type FashionDepartment,
} from "../department";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import { resolveSwimSubtype } from "./swimwear";
import type { HardDroppedProduct } from "./types";

export type GarmentFamily =
  | "top"
  | "bottom"
  | "dress"
  | "skirt"
  | "outerwear"
  | "footwear"
  | "footwear_accessory"
  | "neckwear"
  | "headwear"
  | "belt"
  | "bag"
  | "watch"
  | "jewelry"
  | "socks"
  | "swimwear";

type FamilyRule = {
  family: GarmentFamily;
  tokens?: readonly string[];
  /** Contiguous multi-word phrases (already space-normalized). */
  phrases?: readonly string[];
  /** If any of these phrases appear, this rule is skipped entirely. */
  vetoPhrases?: readonly string[];
};

/**
 * High-precision garment vocabulary. Deliberately conservative: only tokens
 * that unambiguously name a garment family. Fabric/adjective words that also
 * read as garments (e.g. "jersey", "flat") are intentionally excluded.
 */
const FAMILY_RULES: readonly FamilyRule[] = [
  {
    family: "footwear_accessory",
    tokens: ["laces", "shoelace", "shoelaces", "insole", "insoles"],
    phrases: [
      "shoe lace",
      "shoe laces",
      "boot laces",
      "shoe tree",
      "shoe horn",
      "shoe care",
      "shoe polish",
      "shoe cream",
    ],
  },
  // Socks are a deliberate accessory-tray family — not only "footwear junk".
  { family: "socks", tokens: ["sock", "socks"] },
  // Keep shoelace/care as footwear_accessory junk for shoe slots.
  {
    family: "neckwear",
    tokens: ["necktie", "neckties", "bowtie", "tie", "ties"],
    phrases: ["bow tie", "neck tie"],
    vetoPhrases: ["tie dye"],
  },
  {
    family: "watch",
    tokens: ["watch", "watches"],
    phrases: ["smart watch", "wrist watch"],
  },
  {
    family: "jewelry",
    tokens: [
      "bracelet",
      "bracelets",
      "necklace",
      "necklaces",
      "earring",
      "earrings",
      "ring",
      "rings",
      "cufflink",
      "cufflinks",
    ],
  },
  {
    family: "footwear",
    tokens: [
      "shoe",
      "shoes",
      "boot",
      "boots",
      "loafer",
      "loafers",
      "oxford",
      "oxfords",
      "derby",
      "derbies",
      "brogue",
      "brogues",
      "sneaker",
      "sneakers",
      "trainer",
      "trainers",
      "moccasin",
      "moccasins",
      "mule",
      "mules",
      "espadrille",
      "espadrilles",
      "clog",
      "clogs",
      "sandal",
      "sandals",
      "slide",
      "slides",
      "slipper",
      "slippers",
    ],
    phrases: ["flip flop", "flip flops"],
  },
  // Swim before bottom/dress/top so "board shorts", "swim dress", "one piece"
  // win over shorts/dress/ambiguous nouns on equal head-noun index.
  {
    family: "swimwear",
    tokens: [
      "bikini",
      "bikinis",
      "swimsuit",
      "swimsuits",
      "swimwear",
      "tankini",
      "tankinis",
      "monokini",
      "maillot",
      "burkini",
      "burkinis",
      "boardshorts",
    ],
    phrases: [
      "one piece",
      "two piece",
      "board short",
      "board shorts",
      "swim short",
      "swim shorts",
      "swim trunk",
      "swim trunks",
      "swim brief",
      "swim briefs",
      "rash guard",
      "rash guards",
      "cover up",
      "cover ups",
      "swim dress",
      "swim dresses",
      "bathing suit",
    ],
  },
  {
    family: "bottom",
    tokens: [
      "pant",
      "pants",
      "trouser",
      "trousers",
      "chino",
      "chinos",
      "jean",
      "jeans",
      "short",
      "shorts",
      "jogger",
      "joggers",
      "legging",
      "leggings",
      "slacks",
      "sweatpant",
      "sweatpants",
      "culotte",
      "culottes",
    ],
  },
  {
    family: "top",
    tokens: [
      "shirt",
      "shirts",
      "tee",
      "tees",
      "tshirt",
      "polo",
      "polos",
      "henley",
      "henleys",
      "blouse",
      "blouses",
      "sweater",
      "sweaters",
      "hoodie",
      "hoodies",
      "cardigan",
      "cardigans",
      "tank",
      "turtleneck",
      "turtlenecks",
      "pullover",
      "pullovers",
      "sweatshirt",
      "sweatshirts",
      "crewneck",
      "camisole",
    ],
    phrases: ["t shirt", "crew neck", "button up", "button down", "polo shirt"],
  },
  { family: "skirt", tokens: ["skirt", "skirts"] },
  {
    family: "outerwear",
    tokens: [
      "blazer",
      "blazers",
      "jacket",
      "jackets",
      "coat",
      "coats",
      "suit",
      "suits",
      "vest",
      "vests",
      "parka",
      "parkas",
      "overcoat",
      "overcoats",
      "trench",
      "peacoat",
      "peacoats",
    ],
  },
  {
    family: "dress",
    tokens: [
      "dress",
      "dresses",
      "gown",
      "gowns",
      "jumpsuit",
      "jumpsuits",
      "romper",
      "rompers",
    ],
  },
  { family: "belt", tokens: ["belt", "belts"] },
  {
    family: "headwear",
    tokens: ["hat", "hats", "cap", "caps", "beanie", "beanies"],
  },
  {
    family: "bag",
    tokens: [
      "bag",
      "bags",
      "backpack",
      "backpacks",
      "tote",
      "totes",
      "clutch",
      "handbag",
      "handbags",
      "wallet",
      "wallets",
    ],
  },
];

/** Casual / open footwear that is wrong for a formal (dress) footwear slot. */
const CASUAL_FOOTWEAR_TOKENS = new Set<string>([
  "sandal",
  "sandals",
  "slide",
  "slides",
  "slipper",
  "slippers",
  "clog",
  "clogs",
  "thong",
  "thongs",
  "flops",
]);
const CASUAL_FOOTWEAR_PHRASES = ["flip flop", "flip flops"] as const;

/** Formality markers on a footwear slot garment. */
const FORMAL_FOOTWEAR_MARKERS = [
  "dress",
  "oxford",
  "derby",
  "loafer",
  "formal",
  "brogue",
  "monk",
  "wingtip",
] as const;

/** Unambiguous women's-coded footwear vocabulary (drops in mens/boys slots). */
const WOMENS_CODED_FOOTWEAR_TOKENS = new Set<string>([
  "stiletto",
  "stilettos",
  "slingback",
  "slingbacks",
]);
const WOMENS_CODED_FOOTWEAR_PHRASES = [
  "peep toe",
  "kitten heel",
  "mary jane",
  "court shoe",
  "court shoes",
] as const;

function phraseEndIndex(tokens: string[], phrase: string): number {
  const parts = phrase.split(" ");
  if (!parts.length) return -1;
  for (let i = 0; i + parts.length <= tokens.length; i += 1) {
    let ok = true;
    for (let j = 0; j < parts.length; j += 1) {
      if (tokens[i + j] !== parts[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i + parts.length - 1;
  }
  return -1;
}

function normPhraseHit(norm: string, phrase: string): boolean {
  return ` ${norm} `.includes(` ${phrase} `);
}

/**
 * Resolve the garment family from a title using the HEAD-NOUN heuristic:
 * product titles put the garment noun last ("Mens Oxford Shirt" → shirt, not
 * shoe; "Dress Pant" → pant, not dress). We collect every family token/phrase
 * and pick the one closest to the end of the title.
 */
export function resolveGarmentFamily(
  text: string,
): { family: GarmentFamily; evidence: string } | null {
  const norm = preNormalize(text);
  if (!norm) return null;
  const tokens = titleTokens(text);
  if (!tokens.length) return null;

  let best: { family: GarmentFamily; index: number; evidence: string } | null =
    null;

  const consider = (family: GarmentFamily, index: number, evidence: string) => {
    if (index < 0) return;
    if (!best || index > best.index) {
      best = { family, index, evidence };
    }
  };

  for (const rule of FAMILY_RULES) {
    if (rule.vetoPhrases?.some((p) => normPhraseHit(norm, p))) continue;

    for (const token of rule.tokens ?? []) {
      for (let i = tokens.length - 1; i >= 0; i -= 1) {
        if (tokens[i] !== token) continue;
        // "short sleeve" is a top, not shorts — never let it read as a bottom.
        if (
          (token === "short" || token === "shorts") &&
          tokens[i + 1] === "sleeve"
        ) {
          continue;
        }
        consider(rule.family, i, token);
        break;
      }
    }
    for (const phrase of rule.phrases ?? []) {
      consider(rule.family, phraseEndIndex(tokens, phrase), phrase);
    }
  }

  if (!best) return null;
  const resolved = best as { family: GarmentFamily; evidence: string };
  return { family: resolved.family, evidence: resolved.evidence };
}

export function resolveSlotFamily(garment: string): GarmentFamily | null {
  return resolveGarmentFamily(garment)?.family ?? null;
}

function slotIsFormalFootwear(garment: string): boolean {
  if (resolveSlotFamily(garment) !== "footwear") return false;
  const g = preNormalize(garment);
  return FORMAL_FOOTWEAR_MARKERS.some((m) => g.includes(m));
}

/**
 * Drop a product whose title confidently names a different garment family than
 * the slot expects, plus two targeted footwear guards:
 *   - casual/open footwear in a formal (dress) footwear slot
 *   - women's-coded footwear in a mens/boys slot
 * Unknown / ambiguous titles always survive.
 */
export function checkItemType(
  product: FashionSlotCatalogProduct,
  garment: string,
  brief: FashionSearchBrief,
): HardDroppedProduct | null {
  const slotFamily = resolveSlotFamily(garment);
  if (!slotFamily) return null;

  const title = product.title ?? "";
  const resolved = resolveGarmentFamily(title);

  if (resolved && resolved.family !== slotFamily) {
    return {
      product_id: product.id,
      rule: "item_type_mismatch",
      evidence: `title "${resolved.evidence}" is ${resolved.family}, slot expects ${slotFamily}`,
    };
  }

  // Swim one-/two-piece exclusivity (generic "swimsuit" slots stay open).
  if (slotFamily === "swimwear") {
    const slotSubtype = resolveSwimSubtype(garment);
    if (slotSubtype) {
      const titleSubtype = resolveSwimSubtype(title);
      if (titleSubtype && titleSubtype !== slotSubtype) {
        return {
          product_id: product.id,
          rule: "item_type_mismatch",
          evidence: `swim "${titleSubtype}" for ${slotSubtype} ${garment} slot`,
        };
      }
    }
    return null;
  }

  // Footwear-only refinements below.
  if (slotFamily !== "footwear") return null;

  const norm = preNormalize(title);
  const tokens = titleTokens(title);

  if (slotIsFormalFootwear(garment)) {
    const casualToken = tokens.find((t) => CASUAL_FOOTWEAR_TOKENS.has(t));
    const casualPhrase = CASUAL_FOOTWEAR_PHRASES.find((p) =>
      normPhraseHit(norm, p),
    );
    if (casualToken || casualPhrase) {
      return {
        product_id: product.id,
        rule: "item_type_mismatch",
        evidence: `casual footwear "${casualToken ?? casualPhrase}" for formal ${garment} slot`,
      };
    }
  }

  const department: FashionDepartment = resolveSearchDepartment({
    knowledgeDepartment: brief.knowledge_state?.department,
    departmentScope: brief.department_scope,
  });
  if (department === "mens" || department === "boys") {
    if (isGenderedDepartment(department)) {
      const codedToken = tokens.find((t) =>
        WOMENS_CODED_FOOTWEAR_TOKENS.has(t),
      );
      const codedPhrase = WOMENS_CODED_FOOTWEAR_PHRASES.find((p) =>
        normPhraseHit(norm, p),
      );
      if (codedToken || codedPhrase) {
        return {
          product_id: product.id,
          rule: "department_mismatch",
          evidence: `womens-coded footwear "${codedToken ?? codedPhrase}" for ${department} slot`,
        };
      }
    }
  }

  return null;
}
