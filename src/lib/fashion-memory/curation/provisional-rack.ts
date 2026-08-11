/**
 * Provisional rack — scored + hydrated verified pool rendered with zero LLM.
 * Curation upgrades it in place (heroes rise, vetoes fade).
 */
import { buildRefRegistry } from "./refs";
import { buildDeterministicFallback } from "./fallback";
import { buildPresentationContract } from "./presentation";
import type { FashionCurationPresentation } from "./types";
import type { FashionSearchPlan } from "../search-planner/types";
import type { FashionSlotCatalogResult } from "../catalog-search/types";
import type { SlotPool } from "../hydration/types";

export function buildProvisionalPresentation(params: {
  plan: FashionSearchPlan;
  slots: FashionSlotCatalogResult[];
  pools?: Map<string, SlotPool>;
  traceId?: string | null;
}): FashionCurationPresentation | null {
  const slotData = params.slots
    .map((slot) => {
      const planSlot = params.plan.slots.find((s) => s.slot_id === slot.slot_id);
      if (!planSlot) return null;
      const pool = params.pools?.get(slot.slot_id);
      const verified = pool?.verified ?? slot.verified_pool ?? [];
      return { slot_id: slot.slot_id, planSlot, verified };
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  if (!slotData.some((s) => s.verified.length > 0)) return null;

  const registry = buildRefRegistry({
    slots: slotData,
    mode: params.plan.mode,
    brief: params.plan.brief,
  });

  const thinSlots = params.slots
    .filter((s) => s.thin_slot)
    .map((s) => s.slot_id);

  const output = buildDeterministicFallback({
    plan: params.plan,
    registry,
    pools: params.pools
      ? new Map(
          [...params.pools.entries()].map(([id, pool]) => [
            id,
            { verified: pool.verified },
          ]),
        )
      : undefined,
    thinSlots,
  });

  // Soft opening — curation will replace.
  output.narration.opening =
    "Pulling the strongest verified options onto the rack…";

  const lookMembership = new Map<string, string[]>();
  for (const look of output.looks ?? []) {
    for (const ref of look.item_refs) {
      const existing = lookMembership.get(ref) ?? [];
      existing.push(look.name);
      lookMembership.set(ref, existing);
    }
  }

  return buildPresentationContract({
    output,
    registry,
    plan: params.plan,
    slots: params.slots.map((s) => ({
      slot_id: s.slot_id,
      garment: s.garment,
      thin_slot: s.thin_slot,
      brand_status: s.brand_status,
      overflow_items: s.overflow_items,
    })),
    vetoedRefs: new Set(),
    lookMembership,
    fallback: true,
    traceId: params.traceId,
  });
}
