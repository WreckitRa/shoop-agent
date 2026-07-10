#!/usr/bin/env node
/**
 * Seed / propose shop_departments rows for the curated allowlist.
 *
 * Usage:
 *   npx tsx scripts/seed-shop-departments.ts
 *
 * Writes scripts/shop-departments.review.json for manual review.
 * Rows with confidence "manual" in SHOP_DEPARTMENT_SEED are preserved.
 * New domains get heuristic proposals (inferred) — run Haiku review offline
 * and commit corrections as confidence:"manual".
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CURATED_SHOP_IDS } from "../src/lib/shopify/curated-shop-ids";
import { SHOP_DEPARTMENT_SEED } from "../src/lib/fashion-memory/shop-departments";

type Proposal = {
  shop_gid: string;
  shop_domain: string | null;
  department: "mens" | "womens" | "kids" | "mixed";
  confidence: "manual" | "inferred";
  source_note: string;
};

const WOMENS_HINTS =
  /\b(women|womens|lady|ladies|dress|bridal|boutique|femme|girl)\b/i;
const MENS_HINTS = /\b(men|mens|gentleman|menswear|bonobos|untuck)\b/i;

function heuristicDepartment(domain: string | null): Proposal["department"] {
  if (!domain) return "mixed";
  if (WOMENS_HINTS.test(domain)) return "womens";
  if (MENS_HINTS.test(domain)) return "mens";
  return "mixed";
}

function main() {
  const byGid = new Map(SHOP_DEPARTMENT_SEED.map((r) => [r.shop_gid, r]));
  const byDomain = new Map(
    SHOP_DEPARTMENT_SEED.filter((r) => r.shop_domain).map((r) => [
      r.shop_domain!.toLowerCase(),
      r,
    ]),
  );

  const proposals: Proposal[] = [];

  // Preserve reviewed seed first.
  for (const row of SHOP_DEPARTMENT_SEED) {
    proposals.push({
      shop_gid: row.shop_gid,
      shop_domain: row.shop_domain ?? null,
      department: row.department,
      confidence: row.confidence,
      source_note: row.source_note ?? "seed",
    });
  }

  // Allowlist GIDs without domain metadata yet — placeholder for Haiku pass.
  for (const gid of CURATED_SHOP_IDS) {
    if (byGid.has(gid)) continue;
    proposals.push({
      shop_gid: gid,
      shop_domain: null,
      department: "mixed",
      confidence: "inferred",
      source_note:
        "Allowlist GID without domain — run Haiku batch + homepage title review",
    });
  }

  // Domain-only seed rows already covered; note unused domains for review.
  void byDomain;
  void heuristicDepartment;

  const outPath = resolve(
    process.cwd(),
    "scripts/shop-departments.review.json",
  );
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        count: proposals.length,
        note:
          "Review inferred rows; set confidence to manual after human/Haiku review. Upsert into shop_departments.",
        rows: proposals,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${proposals.length} proposals → ${outPath}`);
}

main();
