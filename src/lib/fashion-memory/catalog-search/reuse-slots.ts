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
  prepared_images?: Record<
    string,
    import("../curation/curation-images").CurationImageBlock
  >;
};

export function indexPoolsByFamily(rows: SearchPoolRow[]): Map<string, ReusedSlot> {
  const out = new Map<string, ReusedSlot>();
  for (const row of rows) {
    const family = familyKeyForSlot(row.state.context.slot.garment);
    out.set(family, {
      family,
      slot: slotFromPoolRow(row),
      verified: row.state.verified,
      prepared_images: row.state.prepared_images,
    });
  }
  return out;
}

/** True when every plan slot already has a persisted verified bench. */
export function reusedBenchIsAssembled(params: {
  mode: "rescore-only" | "partial" | "full";
  reusedByFamily: Map<string, ReusedSlot>;
  planSlots: Array<{ garment: string }>;
}): boolean {
  if (params.mode !== "rescore-only") return false;
  if (params.reusedByFamily.size === 0) return false;
  return params.planSlots.every((s) =>
    params.reusedByFamily.has(familyKeyForSlot(s.garment)),
  );
}

/** Keep hydrated rows that survived rescore; copy new scores/taste onto them. */
export function attachReusedVerified(params: {
  slots: FashionSlotCatalogResult[];
  reuseVerifiedBySlot: Map<string, HydratedCandidate[]>;
}): FashionSlotCatalogResult[] {
  return params.slots.map((slot) => {
    const reused = params.reuseVerifiedBySlot.get(slot.slot_id) ?? [];
    if (!reused.length) return slot;
    const scoreById = new Map(slot.products.map((p) => [p.id, p]));
    const survivorIds = new Set(slot.products.map((p) => p.id));
    const verified = reused
      .filter((c) => survivorIds.size === 0 || survivorIds.has(c.id))
      .map((c) => {
        const scored = scoreById.get(c.id);
        if (!scored) return c;
        return {
          ...c,
          score: scored.score ?? c.score,
          taste_rating: scored.taste_rating ?? c.taste_rating,
        };
      });
    return {
      ...slot,
      verified_pool: verified.length ? verified : reused,
    };
  });
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
