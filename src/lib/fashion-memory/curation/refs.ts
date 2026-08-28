import type { HydratedCandidate } from "../hydration/types";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import type { CurationRefRegistry, RefEntry } from "./types";
import { imageBudgetForSlot } from "./deliverables";
import { preferDepartmentKnownWhenGendered } from "./department-rank";

function slotPrefix(slotId: string): string {
  return slotId.replace(/[^a-z0-9]+/gi, "_").slice(0, 12);
}

function laneOf(
  candidate: Pick<HydratedCandidate, "taste_rating">,
): "usual" | "adjacent" | "new" | null {
  const lane = candidate.taste_rating?.lane;
  return lane === "usual" || lane === "adjacent" || lane === "new" ? lane : null;
}

/**
 * Which verified candidates get curator images.
 * Score-ordered fill, with an anchor reservation:
 * explore → at least ceil(budget/2) lane=new when verified has them;
 * push → at least one adjacent/new per slot when verified has one.
 */
export function pickImagedIds(params: {
  candidates: HydratedCandidate[];
  budget: number;
  anchor?: FashionSearchBrief["preference_anchor"];
}): Set<string> {
  const budget = Math.max(0, params.budget);
  const ids = new Set<string>();
  if (budget === 0 || !params.candidates.length) return ids;

  const byScore = (a: HydratedCandidate, b: HydratedCandidate) =>
    (b.score?.final ?? 0) - (a.score?.final ?? 0);

  if (params.anchor === "explore") {
    const news = params.candidates.filter((c) => laneOf(c) === "new").sort(byScore);
    if (news.length) {
      // Tiny benches (shrink-retry, budget ≤ 2): ceil(budget/2) is at least 1.
      const reserved = Math.min(Math.max(1, Math.ceil(budget / 2)), news.length);
      for (const c of news.slice(0, reserved)) ids.add(c.id);
    }
  } else if (params.anchor === "push") {
    const step = [...params.candidates]
      .filter((c) => laneOf(c) === "adjacent" || laneOf(c) === "new")
      .sort(byScore)[0];
    if (step) ids.add(step.id);
  }

  for (const c of [...params.candidates].sort(byScore)) {
    if (ids.size >= budget) break;
    ids.add(c.id);
  }
  return ids;
}

export function buildRefRegistry(params: {
  slots: Array<{
    slot_id: string;
    planSlot: FashionSearchPlanSlot;
    verified: HydratedCandidate[];
  }>;
  mode: import("../search-planner/types").SearchPlanMode;
  /** When set + gendered, department_unknown ranks after known-dept survivors. */
  brief?: FashionSearchBrief;
  /** Multiply per-slot image budget (e.g. 0.5 for shrink-retry). */
  imageBudgetScale?: number;
}): CurationRefRegistry {
  const registry: CurationRefRegistry = new Map();
  const scale = Math.max(0, Math.min(1, params.imageBudgetScale ?? 1));

  for (const slot of params.slots) {
    const sorted = params.brief
      ? preferDepartmentKnownWhenGendered({
          brief: params.brief,
          candidates: slot.verified,
        })
      : [...slot.verified].sort(
          (a, b) => (b.score?.final ?? 0) - (a.score?.final ?? 0),
        );

    const baseBudget = imageBudgetForSlot({
      mode: params.mode,
      role: slot.planSlot.role,
      brief: params.brief,
    });
    const imageBudget = Math.max(1, Math.ceil(baseBudget * scale));
    const imagedIds = pickImagedIds({
      candidates: sorted,
      budget: imageBudget,
      anchor: params.brief?.preference_anchor,
    });

    sorted.forEach((candidate, idx) => {
      const ref = `${slotPrefix(slot.slot_id)}_${idx + 1}`;
      registry.set(ref, {
        ref,
        slot_id: slot.slot_id,
        product_id: candidate.id,
        candidate,
        score_rank: idx + 1,
        image_shown: imagedIds.has(candidate.id),
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
