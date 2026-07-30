import type { HydratedCandidate } from "../hydration/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import type { CurationRefRegistry, RefEntry } from "./types";
import { imageBudgetForSlot } from "./deliverables";

function slotPrefix(slotId: string): string {
  return slotId.replace(/[^a-z0-9]+/gi, "_").slice(0, 12);
}

export function buildRefRegistry(params: {
  slots: Array<{
    slot_id: string;
    planSlot: FashionSearchPlanSlot;
    verified: HydratedCandidate[];
  }>;
  mode: import("../search-planner/types").SearchPlanMode;
  /** Multiply per-slot image budget (e.g. 0.5 for shrink-retry). */
  imageBudgetScale?: number;
}): CurationRefRegistry {
  const registry: CurationRefRegistry = new Map();
  const scale = Math.max(0, Math.min(1, params.imageBudgetScale ?? 1));

  for (const slot of params.slots) {
    const sorted = [...slot.verified].sort(
      (a, b) => (b.score?.final ?? 0) - (a.score?.final ?? 0),
    );

    const baseBudget = imageBudgetForSlot({
      mode: params.mode,
      role: slot.planSlot.role,
    });
    const imageBudget = Math.max(1, Math.ceil(baseBudget * scale));

    sorted.forEach((candidate, idx) => {
      const ref = `${slotPrefix(slot.slot_id)}_${idx + 1}`;
      registry.set(ref, {
        ref,
        slot_id: slot.slot_id,
        product_id: candidate.id,
        candidate,
        score_rank: idx + 1,
        image_shown: idx < imageBudget,
      });
    });
  }

  return registry;
}

export function refToProductId(
  registry: CurationRefRegistry,
  ref: string,
): string | null {
  return registry.get(ref)?.product_id ?? null;
}

export function refsForSlot(
  registry: CurationRefRegistry,
  slotId: string,
): RefEntry[] {
  return [...registry.values()].filter((e) => e.slot_id === slotId);
}
