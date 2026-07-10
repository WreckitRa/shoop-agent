/**
 * Shared department vocabulary — query words, Target gender filters,
 * title-token wrong-department evidence, and gendered taxonomy branches.
 *
 * Target gender attribute values verified against Shopify taxonomy /
 * existing ai-chat filters: "Male" | "Female" | "Unisex".
 */
import { preNormalize } from "./normalize/pre-normalize";
import {
  lookupShopDepartmentSync,
  shopDepartmentVerdict,
} from "./shop-departments";

export type FashionDepartment =
  | "mens"
  | "womens"
  | "boys"
  | "girls"
  | "baby"
  | "unisex"
  | "mixed";

/** Departments that get a mandatory first query token. */
export type GenderedDepartment = Exclude<
  FashionDepartment,
  "unisex" | "mixed"
>;

export const DEPARTMENT_QUERY_WORDS: Record<GenderedDepartment, string> = {
  mens: "mens",
  womens: "womens",
  boys: "boys",
  girls: "girls",
  baby: "baby",
};

/**
 * Server-side `filters.attributes` Target gender values (OR within entry).
 * Kids/baby: null — not filterable server-side.
 */
export const TARGET_GENDER_FILTER_VALUES: Record<
  FashionDepartment,
  string[] | null
> = {
  mens: ["Male", "Unisex"],
  womens: ["Female", "Unisex"],
  boys: null,
  girls: null,
  baby: null,
  unisex: null,
  mixed: null,
};

/** Title tokens that CONFIRM the opposite department (after preNormalize). */
export const WRONG_DEPARTMENT_TITLE_TOKENS: Record<
  GenderedDepartment,
  readonly string[]
> = {
  mens: [
    "womens",
    "women",
    "ladies",
    "lady",
    "female",
    "femme",
    "damen",
    "mujer",
    "donna",
    "girls",
    "girl",
    "maternity",
    "baby",
    "toddler",
    "infant",
    "infants",
  ],
  womens: [
    "mens",
    "men",
    "gentlemen",
    "gentleman",
    "male",
    "homme",
    "herren",
    "hombre",
    "uomo",
    "boys",
    "boy",
    "baby",
    "toddler",
    "infant",
    "infants",
  ],
  boys: ["girls", "girl", "womens", "women", "ladies", "maternity"],
  girls: ["boys", "boy", "mens", "men", "gentlemen"],
  baby: ["mens", "men", "womens", "women", "boys", "girls"],
};

/** Own-department title tokens (confirmation, not drop). */
export const OWN_DEPARTMENT_TITLE_TOKENS: Record<
  GenderedDepartment,
  readonly string[]
> = {
  mens: ["mens", "men", "gentlemen", "gentleman", "male", "homme", "herren"],
  womens: [
    "womens",
    "women",
    "ladies",
    "lady",
    "female",
    "femme",
    "damen",
    "maternity",
  ],
  boys: ["boys", "boy"],
  girls: ["girls", "girl"],
  baby: ["baby", "infant", "toddler"],
};

/**
 * Taxonomy category GIDs that inherently imply department.
 * Conservative — only absolute implications.
 */
export const GENDERED_CATEGORY_BRANCHES: Array<{
  department: GenderedDepartment;
  /** Suffix after TaxonomyCategory/ or full GID. */
  categoryIds: readonly string[];
}> = [
  {
    department: "womens",
    categoryIds: [
      "aa-1-4", // Dresses
      "aa-1-15", // Skirts
      "gid://shopify/TaxonomyCategory/aa-1-4",
      "gid://shopify/TaxonomyCategory/aa-1-15",
    ],
  },
];

export function isGenderedDepartment(
  dept: FashionDepartment | string | null | undefined,
): dept is GenderedDepartment {
  return (
    dept === "mens" ||
    dept === "womens" ||
    dept === "boys" ||
    dept === "girls" ||
    dept === "baby"
  );
}

export function resolveSearchDepartment(params: {
  knowledgeDepartment?: string | null;
  departmentScope?: string | null;
}): FashionDepartment {
  const raw =
    params.knowledgeDepartment?.trim() ||
    params.departmentScope?.trim() ||
    "mixed";
  if (
    raw === "mens" ||
    raw === "womens" ||
    raw === "boys" ||
    raw === "girls" ||
    raw === "baby" ||
    raw === "unisex" ||
    raw === "mixed"
  ) {
    return raw;
  }
  return "mixed";
}

/**
 * Tokens that must not sit beside the required department prefix.
 * Stripping all of these prevents stacked queries like "mens womens dress"
 * when the planner and the brief disagree on department.
 */
const DEPARTMENT_PREFIX_STRIP_TOKENS = new Set<string>([
  ...Object.values(DEPARTMENT_QUERY_WORDS),
  "men",
  "women",
  "men's",
  "women's",
]);

/**
 * Strong relation → adult department defaults for gift recipients.
 * Ambiguous relations (friend, colleague, self) return null — ask or use facts.
 * Kids departments (boys/girls) are never inferred from relation alone.
 */
export function departmentFromRelation(
  relation: string | null | undefined,
): "mens" | "womens" | null {
  const r = relation?.trim().toLowerCase() ?? "";
  if (!r || r === "self" || r === "friend" || r === "colleague") return null;
  if (
    /^(mother|mom|mum|mama|wife|sister|girlfriend|grandmother|grandma|aunt|niece|daughter|fiancée|fiancee)$/.test(
      r,
    )
  ) {
    return "womens";
  }
  if (
    /^(father|dad|daddy|husband|brother|boyfriend|grandfather|grandpa|uncle|nephew|son|fiancé|fiance)$/.test(
      r,
    )
  ) {
    return "mens";
  }
  return null;
}

/** Ensure department query word is the first token (fix, don't reject). */
export function ensureDepartmentQueryPrefix(
  query: string,
  department: FashionDepartment,
): string {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (!isGenderedDepartment(department)) {
    // Mixed/unisex: still strip accidental stacked department words.
    if (!trimmed) return trimmed;
    const cleaned = trimmed
      .split(/\s+/)
      .filter((t) => !DEPARTMENT_PREFIX_STRIP_TOKENS.has(t.toLowerCase()))
      .join(" ");
    return cleaned;
  }
  const word = DEPARTMENT_QUERY_WORDS[department];
  if (!trimmed) return word;
  const tokens = trimmed.split(/\s+/);
  const rest = tokens
    .filter((t) => !DEPARTMENT_PREFIX_STRIP_TOKENS.has(t.toLowerCase()))
    .join(" ");
  return rest ? `${word} ${rest}` : word;
}

export function titleTokens(title: string): string[] {
  return preNormalize(title)
    .split(/\s+/)
    .filter(Boolean);
}

export type DepartmentEvidence =
  | {
      status: "confirmed_match";
      source: "attribute" | "shop_map" | "category" | "title";
      evidence: string;
    }
  | {
      status: "mismatch";
      source: "attribute" | "shop_map" | "category" | "title";
      evidence: string;
    }
  | { status: "unknown"; source: "none"; evidence: string };

function normalizeAttrValue(v: string): string {
  return preNormalize(v);
}

function attributeMatchesDepartment(
  attrValue: string,
  department: FashionDepartment,
): "match" | "mismatch" | "neutral" {
  const v = normalizeAttrValue(attrValue);
  if (v === "unisex" || v === "all" || v === "gender neutral") return "neutral";

  if (department === "mens") {
    if (v === "male" || v === "men" || v === "mens" || v === "man") return "match";
    if (v === "female" || v === "women" || v === "womens" || v === "woman") {
      return "mismatch";
    }
  }
  if (department === "womens") {
    if (v === "female" || v === "women" || v === "womens" || v === "woman") {
      return "match";
    }
    if (v === "male" || v === "men" || v === "mens" || v === "man") {
      return "mismatch";
    }
  }
  if (department === "boys") {
    if (v === "male" || v === "boys" || v === "boy") return "match";
    if (v === "female" || v === "girls" || v === "girl") return "mismatch";
  }
  if (department === "girls") {
    if (v === "female" || v === "girls" || v === "girl") return "match";
    if (v === "male" || v === "boys" || v === "boy") return "mismatch";
  }
  if (department === "baby") {
    if (v.includes("baby") || v.includes("infant") || v.includes("toddler")) {
      return "match";
    }
    if (v === "adult" || v === "men" || v === "women") return "mismatch";
  }
  return "neutral";
}

function ageGroupContradictsKids(attrValue: string): boolean {
  const v = normalizeAttrValue(attrValue);
  return (
    v === "adult" ||
    v === "adults" ||
    v.includes("adult") ||
    v === "mature"
  );
}

function categoryImpliesDepartment(
  taxonomyCategory: string | undefined,
): GenderedDepartment | null {
  if (!taxonomyCategory?.trim()) return null;
  const tax = taxonomyCategory.trim();
  const suffix = tax.includes("/") ? tax.split("/").pop()! : tax;
  for (const branch of GENDERED_CATEGORY_BRANCHES) {
    for (const id of branch.categoryIds) {
      const idSuffix = id.includes("/") ? id.split("/").pop()! : id;
      if (tax === id || suffix === idSuffix || tax.includes(idSuffix)) {
        return branch.department;
      }
    }
  }
  return null;
}

function titleDepartmentScan(
  title: string,
  department: GenderedDepartment,
): "wrong" | "own" | "both" | "none" {
  const tokens = new Set(titleTokens(title));
  if (tokens.has("unisex")) return "none";

  const wrong = WRONG_DEPARTMENT_TITLE_TOKENS[department];
  const own = OWN_DEPARTMENT_TITLE_TOKENS[department];
  const hasWrong = wrong.some((t) => tokens.has(t));
  const hasOwn = own.some((t) => tokens.has(t));
  if (hasWrong && hasOwn) return "both";
  if (hasWrong) return "wrong";
  if (hasOwn) return "own";
  return "none";
}

export type DepartmentProductSignals = {
  title: string;
  taxonomyCategory?: string;
  /** Raw catalog attributes (name/value). */
  attributes?: Array<{ name: string; value: string }>;
  /** Shopify shop GID when known. */
  shopGid?: string | null;
  /** Merchant hostname (no www). */
  shopDomain?: string | null;
};

/**
 * Resolve department evidence in strength order:
 * attribute → shop_departments (mens/womens/kids; mixed=noop) →
 * gendered category → title tokens → unknown.
 */
export function resolveDepartmentEvidence(
  product: DepartmentProductSignals,
  department: FashionDepartment,
): DepartmentEvidence {
  if (!isGenderedDepartment(department)) {
    return { status: "unknown", source: "none", evidence: "department_mixed" };
  }

  const attrs = product.attributes ?? [];
  for (const a of attrs) {
    const name = preNormalize(a.name);
    if (name === "target gender" || name === "gender" || name === "targetgender") {
      const verdict = attributeMatchesDepartment(a.value, department);
      if (verdict === "mismatch") {
        return {
          status: "mismatch",
          source: "attribute",
          evidence: `Target gender=${a.value}`,
        };
      }
      if (verdict === "match" || verdict === "neutral") {
        return {
          status: "confirmed_match",
          source: "attribute",
          evidence: `Target gender=${a.value}`,
        };
      }
    }
    if (
      (department === "boys" ||
        department === "girls" ||
        department === "baby") &&
      (name === "age group" || name === "agegroup" || name === "age")
    ) {
      if (ageGroupContradictsKids(a.value)) {
        return {
          status: "mismatch",
          source: "attribute",
          evidence: `Age group=${a.value}`,
        };
      }
    }
  }

  // Shop map — between attribute and category. `mixed` contributes nothing.
  const shopRow = lookupShopDepartmentSync({
    shopGid: product.shopGid,
    shopDomain: product.shopDomain,
  });
  if (shopRow) {
    const verdict = shopDepartmentVerdict({
      shopDepartment: shopRow.department,
      searchDepartment: department,
    });
    if (verdict === "mismatch") {
      return {
        status: "mismatch",
        source: "shop_map",
        evidence: `shop ${shopRow.shop_domain ?? shopRow.shop_gid} is ${shopRow.department}`,
      };
    }
    if (verdict === "match") {
      return {
        status: "confirmed_match",
        source: "shop_map",
        evidence: `shop ${shopRow.shop_domain ?? shopRow.shop_gid} is ${shopRow.department}`,
      };
    }
  }

  const implied = categoryImpliesDepartment(product.taxonomyCategory);
  if (implied && implied !== department) {
    // womens-only branches contradict mens/boys/etc.
    if (
      (implied === "womens" && department !== "womens" && department !== "girls") ||
      (implied === "mens" && department !== "mens" && department !== "boys")
    ) {
      return {
        status: "mismatch",
        source: "category",
        evidence: `taxonomy ${product.taxonomyCategory} implies ${implied}`,
      };
    }
  }
  if (implied === department) {
    return {
      status: "confirmed_match",
      source: "category",
      evidence: `taxonomy ${product.taxonomyCategory}`,
    };
  }

  const scan = titleDepartmentScan(product.title, department);
  if (scan === "wrong") {
    const tokens = titleTokens(product.title);
    const hit =
      WRONG_DEPARTMENT_TITLE_TOKENS[department].find((t) => tokens.includes(t)) ??
      "wrong_token";
    return {
      status: "mismatch",
      source: "title",
      evidence: `title token "${hit}"`,
    };
  }
  if (scan === "own" || scan === "both") {
    return {
      status: "confirmed_match",
      source: "title",
      evidence: scan === "both" ? "title both-department tokens (unisex)" : "title own-department token",
    };
  }

  return { status: "unknown", source: "none", evidence: "no department signal" };
}
