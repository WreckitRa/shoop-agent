import type { FashionSearchPlan, FashionSearchPlanSlot, SearchPlanMode } from "./types";
import { recordPipelineEvent } from "../observability/trace";
import { ensureBrandProbeVariant, statedBrands } from "../brand/brand-handling";
import { garmentSlotFamilyKey } from "../router/garment-family";
import { repairSlotQueryVariants } from "./query-builder";
import { reconcilePlanPalettes } from "./palette-ladder";
import {
  FALLBACK_OPTIONS_WANTED,
  isLookCountQuantityHint,
} from "./fallback-plan";

const TOP_GARMENT_RE =
  /\b(shirt|blazer|jacket|coat|dress|top|blouse|sweater|hoodie|suit)\b/i;

const MAX_PLAN_SLOTS = 12;

function clampOptionsWanted(n: number): number {
  if (!Number.isFinite(n)) return 3;
  return Math.min(8, Math.max(1, Math.round(n)));
}

function ensureAnchorRole(
  plan: FashionSearchPlan,
  traceId?: string | null,
): FashionSearchPlanSlot[] {
  if (plan.mode !== "outfit" && plan.mode !== "capsule") {
    return plan.slots.map((s) => ({ ...s }));
  }

  const slots = plan.slots.map((s) => ({ ...s }));
  const anchors = slots.filter((s) => s.role === "anchor");
  if (anchors.length === 1) return slots;

  let anchorIdx = slots.findIndex((s) => TOP_GARMENT_RE.test(s.garment));
  if (anchorIdx === -1) anchorIdx = 0;

  const rebalanced = slots.map((s, i) => ({
    ...s,
    role: i === anchorIdx ? ("anchor" as const) : ("support" as const),
  }));

  recordPipelineEvent({
    traceId,
    stage: "clamp",
    payload: {
      kind: "anchor_role_rebalance",
      anchor_slot_id: rebalanced[anchorIdx]?.slot_id,
    },
  });

  return rebalanced;
}

function ensureVariantCount(
  slot: FashionSearchPlanSlot,
  plan: FashionSearchPlan,
  traceId?: string | null,
): { slot: FashionSearchPlanSlot; usedDeterministicFallback: boolean } {
  const repaired = repairSlotQueryVariants(slot, plan, { traceId });
  return {
    slot: repaired.slot,
    usedDeterministicFallback: repaired.usedDeterministicFallback,
  };
}

export type ClampFashionSearchPlanResult = {
  plan: FashionSearchPlan;
  validatorFallbackSlots: string[];
};

/** Code-side sanity clamps after planner LLM output. */
function uniqueSlotsByFamily(
  slots: FashionSearchPlanSlot[],
): FashionSearchPlanSlot[] {
  const seen = new Set<string>();
  const out: FashionSearchPlanSlot[] = [];
  for (const s of slots) {
    const key = garmentSlotFamilyKey(s.garment);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function liftLookCountOptionsWanted(
  plan: FashionSearchPlan,
  slots: FashionSearchPlanSlot[],
  traceId?: string | null,
): FashionSearchPlanSlot[] {
  if (plan.mode !== "outfit" && plan.mode !== "capsule") return slots;
  if (!isLookCountQuantityHint(plan.brief.quantity_hint)) return slots;
  let lifted = false;
  const next = slots.map((s) => {
    if (s.options_wanted > 1) return s;
    lifted = true;
    return { ...s, options_wanted: FALLBACK_OPTIONS_WANTED };
  });
  if (lifted) {
    recordPipelineEvent({
      traceId,
      stage: "clamp",
      payload: { kind: "look_count_options_lifted" },
    });
  }
  return next;
}

export function clampFashionSearchPlan(
  plan: FashionSearchPlan,
  opts?: { traceId?: string | null },
): ClampFashionSearchPlanResult {
  let mode: SearchPlanMode = plan.mode;
  let slots = uniqueSlotsByFamily(
    plan.slots.slice(0, MAX_PLAN_SLOTS).map((s) => ({
      ...s,
      options_wanted: clampOptionsWanted(s.options_wanted),
    })),
  );
  slots = liftLookCountOptionsWanted(plan, slots, opts?.traceId);

  if (mode === "single_item" && slots.length > 1) {
    recordPipelineEvent({
      traceId: opts?.traceId,
      stage: "clamp",
      payload: { kind: "single_item_multi_slot", before: slots.length },
    });
    slots = [slots[0]!];
  }

  if (mode === "single_item" && slots[0]) {
    slots[0] = { ...slots[0], role: "anchor" };
  }

  const clamped: FashionSearchPlan = {
    ...plan,
    mode,
    slots,
  };

  const withAnchor = ensureAnchorRole(clamped, opts?.traceId);
  const validatorFallbackSlots: string[] = [];
  const withVariants = withAnchor.map((s) => {
    const repaired = ensureVariantCount(s, clamped, opts?.traceId);
    if (repaired.usedDeterministicFallback) {
      validatorFallbackSlots.push(s.slot_id);
    }
    // Stated brand → force variant 1 to be the brand probe.
    return statedBrands(clamped.brief).length
      ? ensureBrandProbeVariant(repaired.slot, clamped.brief)
      : repaired.slot;
  });

  return {
    plan: reconcilePlanPalettes(
      {
        ...clamped,
        slots: withVariants,
      },
      opts?.traceId,
    ),
    validatorFallbackSlots,
  };
}

export function validateAndRepairSlotVariants(
  slot: FashionSearchPlanSlot,
  plan: FashionSearchPlan,
  traceId?: string | null,
): FashionSearchPlanSlot {
  return repairSlotQueryVariants(slot, plan, { traceId }).slot;
}
