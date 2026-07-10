import type { HydratedCandidate } from "../hydration/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import type { CurationRefRegistry, RefEntry } from "./types";
import {
  CURATION_IMAGE_BUDGET,
} from "./config";

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
}): CurationRefRegistry {
  const registry: CurationRefRegistry = new Map();

  for (const slot of params.slots) {
    const sorted = [...slot.verified].sort(
      (a, b) => (b.score?.final ?? 0) - (a.score?.final ?? 0),
    );

    const imageBudget =
      params.mode === "single_item"
        ? CURATION_IMAGE_BUDGET.single_item
        : slot.planSlot.role === "anchor"
          ? CURATION_IMAGE_BUDGET.anchor_slot
          : CURATION_IMAGE_BUDGET.support_slot;

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
