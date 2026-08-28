/**
 * Rebuild catalog slots from a persisted search so a refinement can skip
 * MCP fan-out (rescore-only) or re-query only the changed family (partial).
 */
import { garmentSlotFamilyKey } from "../router/garment-family";
import type { SearchPoolRow } from "../hydration/pool-persistence";
import type { HydratedCandidate } from "../hydration/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import type { FashionSlotCatalogResult } from "./types";

export function familyKeyForSlot(garment: string): string {
  return garmentSlotFamilyKey(garment);
}

export function slotFromPoolRow(row: SearchPoolRow): FashionSlotCatalogResult {
  const slot = row.state.context.slot;
  const survivors = row.state.survivors ?? [];
  const products = survivors.length
    ? survivors
    : [
        ...row.state.verified,
        ...row.state.reserve,
      ];
  return {
    slot_id: row.slot_id,
    garment: slot.garment,
    products,
    query_variants_used: (slot.query_variants ?? []).map((query) => ({
      query,
      category_filtered: true,
    })),
    counts: {
      unique_products: products.length,
      per_variant: [],
      reformulated: false,
    },
    query_logs: [],
    verified_pool: row.state.verified,
    thin_slot: row.state.thin || undefined,
  };
}

export type ReusedSlot = {
  family: string;
  slot: FashionSlotCatalogResult;
  verified: HydratedCandidate[];
};

export function indexPoolsByFamily(rows: SearchPoolRow[]): Map<string, ReusedSlot> {
  const out = new Map<string, ReusedSlot>();
  for (const row of rows) {
    const family = familyKeyForSlot(row.state.context.slot.garment);
    out.set(family, {
      family,
      slot: slotFromPoolRow(row),
      verified: row.state.verified,
    });
  }
  return out;
}

/** Bind a persisted bench onto a (possibly new) plan slot id. */
export function bindReusedSlot(
  planSlot: FashionSearchPlanSlot,
  reused: FashionSlotCatalogResult,
): FashionSlotCatalogResult {
  return {
    ...reused,
    slot_id: planSlot.slot_id,
    garment: planSlot.garment,
  };
}
