import { normalizePickInsight } from "./pick-insight";
import type { ProductCurationRow } from "./db";
import type { CurationPdpInsight, CurationVerdict } from "../types";

export type ProductCurationDto = {
  productExternalId: string;
  slot: ProductCurationRow["slot"];
  reason: string;
  verdict: CurationVerdict;
  searchQuery: string | null;
  productTitle: string | null;
  productImageUrl: string | null;
  updatedAt: string;
  insight: CurationPdpInsight;
};

/** Map DB row → API DTO; backfills legacy rows that only stored `reason`. */
export function productCurationFromRow(row: ProductCurationRow): ProductCurationDto {
  const reason = row.reason.trim();
  const hasStructured =
    row.fitReasons.length === 3 &&
    row.checkedItems.length >= 3 &&
    Boolean(row.pickStory?.trim()) &&
    row.changeMindItems.length >= 2;

  const insight = hasStructured
    ? {
        retailerCheckNote:
          row.retailerCheckNote?.trim() ||
          "Compared options in this Shoop search",
        fitReasons: row.fitReasons.slice(0, 3) as [string, string, string],
        checkedItems: row.checkedItems,
        pickStory: row.pickStory!.trim(),
        changeMindItems: row.changeMindItems,
      }
    : normalizePickInsight(null, reason);

  return {
    productExternalId: row.productExternalId,
    slot: row.slot,
    reason,
    verdict: row.verdict,
    searchQuery: row.searchQuery,
    productTitle: row.productTitle,
    productImageUrl: row.productImageUrl,
    updatedAt: row.updatedAt.toISOString(),
    insight,
  };
}
