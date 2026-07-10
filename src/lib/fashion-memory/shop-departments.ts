/**
 * Shop-level department map — fills the gap when products lack Target gender
 * attributes and title tokens. Lookup order in resolveDepartmentEvidence:
 * attribute → shop_departments (mens/womens/kids only) → category → title.
 *
 * `mixed` shops contribute nothing (unknown survives). Seeded from reviewed
 * allowlist annotations; DB table is the source of truth when available.
 */
import { fashionMemoryDb } from "./db";

export type ShopDepartment =
  | "mens"
  | "womens"
  | "kids"
  | "mixed";

export type ShopDepartmentConfidence = "manual" | "inferred";

export type ShopDepartmentRow = {
  shop_gid: string;
  department: ShopDepartment;
  confidence: ShopDepartmentConfidence;
  source_note?: string | null;
  shop_domain?: string | null;
};

/**
 * Reviewed seed — women's boutiques that flooded mens searches, plus a few
 * known mens/mixed anchors. Domains are normalized without www.
 */
export const SHOP_DEPARTMENT_SEED: readonly ShopDepartmentRow[] = [
  {
    shop_gid: "domain:reddress.com",
    shop_domain: "reddress.com",
    department: "womens",
    confidence: "manual",
    source_note: "Women's boutique — live mens-search flood",
  },
  {
    shop_gid: "domain:beginningboutique.com",
    shop_domain: "beginningboutique.com",
    department: "womens",
    confidence: "manual",
    source_note: "Women's boutique — live mens-search flood",
  },
  {
    shop_gid: "domain:beginningboutique.com.au",
    shop_domain: "beginningboutique.com.au",
    department: "womens",
    confidence: "manual",
    source_note: "Women's boutique AU",
  },
  {
    shop_gid: "domain:showmeyourmumu.com",
    shop_domain: "showmeyourmumu.com",
    department: "womens",
    confidence: "manual",
    source_note: "Women's fashion brand",
  },
  {
    shop_gid: "domain:kennedyblue.com",
    shop_domain: "kennedyblue.com",
    department: "womens",
    confidence: "inferred",
    source_note: "Bridal/womens formal",
  },
  {
    shop_gid: "domain:lulus.com",
    shop_domain: "lulus.com",
    department: "womens",
    confidence: "manual",
    source_note: "Women's fashion",
  },
  {
    shop_gid: "domain:revolve.com",
    shop_domain: "revolve.com",
    department: "womens",
    confidence: "inferred",
    source_note: "Primarily womens contemporary",
  },
  {
    shop_gid: "domain:nordstrom.com",
    shop_domain: "nordstrom.com",
    department: "mixed",
    confidence: "manual",
    source_note: "Department store",
  },
  {
    shop_gid: "domain:target.com",
    shop_domain: "target.com",
    department: "mixed",
    confidence: "manual",
    source_note: "Mass mixed",
  },
  {
    shop_gid: "domain:macys.com",
    shop_domain: "macys.com",
    department: "mixed",
    confidence: "manual",
    source_note: "Department store",
  },
  {
    shop_gid: "domain:jcrew.com",
    shop_domain: "jcrew.com",
    department: "mixed",
    confidence: "manual",
    source_note: "Mens + womens",
  },
  {
    shop_gid: "domain:bananarepublic.com",
    shop_domain: "bananarepublic.com",
    department: "mixed",
    confidence: "manual",
    source_note: "Mens + womens",
  },
  {
    shop_gid: "domain:bonobos.com",
    shop_domain: "bonobos.com",
    department: "mens",
    confidence: "manual",
    source_note: "Menswear",
  },
  {
    shop_gid: "domain:huckberry.com",
    shop_domain: "huckberry.com",
    department: "mens",
    confidence: "manual",
    source_note: "Mens lifestyle",
  },
  {
    shop_gid: "domain:untuckit.com",
    shop_domain: "untuckit.com",
    department: "mens",
    confidence: "manual",
    source_note: "Mens shirts",
  },
] as const;

function normalizeDomain(domain: string | null | undefined): string | null {
  const raw = domain?.trim().toLowerCase();
  if (!raw) return null;
  return raw.replace(/^www\./, "");
}

type Index = {
  byGid: Map<string, ShopDepartmentRow>;
  byDomain: Map<string, ShopDepartmentRow>;
};

function indexRows(rows: readonly ShopDepartmentRow[]): Index {
  const byGid = new Map<string, ShopDepartmentRow>();
  const byDomain = new Map<string, ShopDepartmentRow>();
  for (const row of rows) {
    byGid.set(row.shop_gid, row);
    const domain = normalizeDomain(row.shop_domain);
    if (domain) byDomain.set(domain, row);
  }
  return { byGid, byDomain };
}

let cachedIndex: Index | null = null;
let dbLoadAttempted = false;

function seedIndex(): Index {
  return indexRows(SHOP_DEPARTMENT_SEED);
}

/** Test helper — reset cache between cases. */
export function resetShopDepartmentCacheForTests(): void {
  cachedIndex = null;
  dbLoadAttempted = false;
}

/** Test helper — inject rows without DB. */
export function setShopDepartmentIndexForTests(
  rows: readonly ShopDepartmentRow[],
): void {
  cachedIndex = indexRows(rows);
  dbLoadAttempted = true;
}

async function ensureIndex(): Promise<Index> {
  if (cachedIndex) return cachedIndex;
  if (!dbLoadAttempted) {
    dbLoadAttempted = true;
    try {
      const { data, error } = await fashionMemoryDb()
        .from("shop_departments")
        .select("shop_gid, department, confidence, source_note, shop_domain");
      if (!error && Array.isArray(data) && data.length > 0) {
        cachedIndex = indexRows(data as ShopDepartmentRow[]);
        return cachedIndex;
      }
    } catch {
      // Fall through to seed — table may not exist yet.
    }
  }
  cachedIndex = seedIndex();
  return cachedIndex;
}

/** Sync lookup for hard-drops / scoring (seed first; DB warm via ensure). */
export function lookupShopDepartmentSync(params: {
  shopGid?: string | null;
  shopDomain?: string | null;
}): ShopDepartmentRow | null {
  const index = cachedIndex ?? seedIndex();
  if (!cachedIndex) cachedIndex = index;
  if (params.shopGid?.trim()) {
    const hit = index.byGid.get(params.shopGid.trim());
    if (hit) return hit;
  }
  const domain = normalizeDomain(params.shopDomain);
  if (domain) {
    const hit = index.byDomain.get(domain);
    if (hit) return hit;
  }
  return null;
}

/** Warm cache from DB when available (call once per request if desired). */
export async function warmShopDepartmentCache(): Promise<void> {
  await ensureIndex();
}

/**
 * Map shop department onto search department mismatch.
 * `mixed` → null (no signal). `kids` mismatches adult mens/womens.
 */
export function shopDepartmentVerdict(params: {
  shopDepartment: ShopDepartment;
  searchDepartment: "mens" | "womens" | "boys" | "girls" | "baby";
}): "match" | "mismatch" | null {
  const { shopDepartment, searchDepartment } = params;
  if (shopDepartment === "mixed") return null;

  if (shopDepartment === "mens") {
    if (searchDepartment === "mens" || searchDepartment === "boys") {
      return "match";
    }
    return "mismatch";
  }
  if (shopDepartment === "womens") {
    if (searchDepartment === "womens" || searchDepartment === "girls") {
      return "match";
    }
    return "mismatch";
  }
  // kids
  if (
    searchDepartment === "boys" ||
    searchDepartment === "girls" ||
    searchDepartment === "baby"
  ) {
    return "match";
  }
  return "mismatch";
}
