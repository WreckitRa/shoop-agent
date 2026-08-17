import { logAiChat } from "@/lib/ai-chat/observability";
import { garmentSlotFamilyKey, isKnownGarmentFamily } from "../router/garment-family";
import type { FashionSearchBrief } from "../router/types";
import type { GuestFashionMemorySnapshot } from "../local/store";
import { checkPlanInvariants } from "../observability/invariants";
import { recordPipelineEvent } from "../observability/trace";
import { attachBudgetAllocation } from "../budget/budgetAllocation";
import { clampFashionSearchPlan } from "./clamps";
import {
  buildFallbackPlan,
  expandOutfitSlots,
  buildSlotsFromGarments,
  selectGarmentsForPlan,
} from "./fallback-plan";
import { runSearchPlanner } from "./llm-planner";
import { buildRecipientProfileBlockForPlanner } from "./recipient-profile";
import { toFashionSearchPlan } from "./tool-schema";
import type {
  FashionSearchPlan,
  MessageFashionSearchPlanMetaV1,
  PlanSource,
} from "./types";
import { validateSlotQueryVariants } from "./validator";
import { sanitizeBriefGarments, isStylePhraseGarment } from "../router/sanitize-garments";

function annotateUnknownFamilies(plan: FashionSearchPlan): FashionSearchPlan {
  return {
    ...plan,
    slots: plan.slots.map((s) => ({
      ...s,
      unknown_family: !isKnownGarmentFamily(s.garment),
    })),
  };
}

function expectedOutfitSlotCount(brief: FashionSearchBrief): number {
  if (brief.request_type !== "outfit" && brief.request_type !== "capsule") {
    return 1;
  }
  // Never invent a 2-slot minimum when the brief under-specified garments.
  return Math.max(selectGarmentsForPlan(brief.garments).length, 1);
}

function needsOutfitSlotExpansion(plan: FashionSearchPlan): boolean {
  if (plan.mode !== "outfit" && plan.mode !== "capsule") return false;
  const expected = expectedOutfitSlotCount(plan.brief);
  return expected >= 2 && plan.slots.length < expected;
}

function reconcileOutfitCoverage(plan: FashionSearchPlan): FashionSearchPlan {
  if (needsOutfitSlotExpansion(plan)) {
    return expandOutfitSlots({ plan });
  }
  const expected = selectGarmentsForPlan(plan.brief.garments);
  const existing = new Set(
    plan.slots.map((s) => garmentSlotFamilyKey(s.garment)),
  );
  const missing = expected.filter(
    (g) => !existing.has(garmentSlotFamilyKey(g)),
  );
  if (!missing.length) return plan;
  const added = buildSlotsFromGarments({
    garments: missing,
    brief: plan.brief,
    mode: plan.mode,
  }).map((s) => ({ ...s, role: "support" as const }));
  return {
    ...plan,
    plan_source: "clamped",
    reasoning: `${plan.reasoning} Reconciled missing brief garments into support slots.`,
    slots: [...plan.slots, ...added].slice(0, 12),
  };
}

/**
 * Single choke point: every resolved plan exits here.
 * Soft clamps → outfit/capsule ≥2 hard clamp → invariants → budget.
 * Impossible to bypass from planner-accepted, clamped, or fallback branches.
 */
async function finalizeResolvedPlan(params: {
  plan: FashionSearchPlan;
  planSource: PlanSource;
  brief: FashionSearchBrief;
  recipientProfile: string;
  currentDate: string;
  signal?: AbortSignal;
  traceId?: string | null;
  /** Already consumed the corrective planner retry. */
  retriedPlanner?: boolean;
}): Promise<FashionSearchPlan> {
  let planSource = params.planSource;
  let working = params.plan;

  const clamped = clampFashionSearchPlan(working, { traceId: params.traceId });
  working = { ...clamped.plan, plan_source: planSource };

  if (needsOutfitSlotExpansion(working)) {
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "clamp",
      payload: {
        kind: "outfit_slot_underflow",
        mode: working.mode,
        slot_count: working.slots.length,
        retried: Boolean(params.retriedPlanner),
      },
    });

    if (!params.retriedPlanner && planSource !== "fallback") {
      // v1.1: ONE live planner call. Slot underflow → deterministic expand, not a second LLM.
      logAiChat("warn", "fashion_search_planner_outfit_slot_deterministic_expand", {
        mode: working.mode,
        slotCount: working.slots.length,
      });
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "clamp",
        payload: {
          kind: "outfit_slot_deterministic_expand",
          mode: working.mode,
          slot_count: working.slots.length,
        },
      });
    }

    working = reconcileOutfitCoverage(working);
    planSource =
      working.plan_source === "clamped" ? "clamped" : "fallback";
    const reclamp = clampFashionSearchPlan(working, {
      traceId: params.traceId,
    });
    working = { ...reclamp.plan, plan_source: planSource };
    clamped.validatorFallbackSlots.push(
      ...reclamp.validatorFallbackSlots.filter(
        (id) => !clamped.validatorFallbackSlots.includes(id),
      ),
    );
  }

  if (
    planSource === "planner" &&
    clamped.validatorFallbackSlots.length > 0
  ) {
    // Structural plan still from planner; variant repairs are tracked via invariants.
  }

  working = annotateUnknownFamilies({ ...working, plan_source: planSource });

  // Drop any style-phrase slots the planner still emitted.
  const beforeSlots = working.slots.length;
  working = {
    ...working,
    slots: working.slots.filter((s) => !isStylePhraseGarment(s.garment)),
  };
  if (working.slots.length < beforeSlots) {
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "clamp",
      payload: {
        kind: "dropped_style_phrase_slots",
        before: beforeSlots,
        after: working.slots.length,
      },
    });
    if (working.slots.length < 2 && (working.mode === "outfit" || working.mode === "capsule")) {
      working = reconcileOutfitCoverage(working);
    }
  }

  checkPlanInvariants({
    traceId: params.traceId,
    plan: working,
    validatorFallbackSlots: clamped.validatorFallbackSlots,
  });

  for (const slot of working.slots) {
    if (slot.unknown_family) {
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "invariant_warning",
        payload: {
          code: "unknown_garment_family",
          garment: slot.garment,
          slot_id: slot.slot_id,
        },
      });
    }
  }

  const profileCurrency =
    working.brief.budget_context.currency?.trim().toUpperCase() ?? "USD";
  const withBudget = attachBudgetAllocation(working, profileCurrency);

  if (withBudget.budget_allocation) {
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "budget_allocation",
      payload: {
        validation: withBudget.budget_allocation.validation,
        per_slot: withBudget.budget_allocation.per_slot,
        budget_interpretation:
          withBudget.budget_allocation.budget_interpretation,
        constraint_type:
          withBudget.budget_allocation.budget_assembly?.constraint_type,
        plan_source: planSource,
      },
    });
  }

  return { ...withBudget, plan_source: planSource };
}

export type PlanFromBriefResult = {
  plan: FashionSearchPlan;
  /** Reuse for curation — avoid a second recipient-profile DB build. */
  recipientProfile: string;
};

/** Full pipeline: LLM plan → Phase 3 validation → clamps → persisted shape. */
export async function planSearchFromBrief(params: {
  brief: FashionSearchBrief;
  userId: string;
  recipientPersonId: string;
  currentDate: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
  signal?: AbortSignal;
  traceId?: string | null;
  plannerDeps?: import("./llm-planner").RunSearchPlannerDeps;
}): Promise<PlanFromBriefResult> {
  const sanitized = sanitizeBriefGarments({
    ...params.brief,
    recipient_person_id: params.recipientPersonId,
  });
  if (
    sanitized.garments.join("|") !==
    (params.brief.garments ?? []).join("|")
  ) {
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "clamp",
      payload: {
        kind: "garment_style_phrase_sanitized",
        before: params.brief.garments,
        after: sanitized.garments,
      },
    });
  }
  const brief = sanitized;

  const recipientProfile = await buildRecipientProfileBlockForPlanner({
    userId: params.userId,
    recipientPersonId: params.recipientPersonId,
    guestSnapshot: params.guestSnapshot,
  });

  const llmInput = await runSearchPlanner({
    brief,
    recipientProfile,
    currentDate: params.currentDate,
    signal: params.signal,
    traceId: params.traceId,
  }, params.plannerDeps);

  let plan: FashionSearchPlan;
  let planSource: PlanSource;

  if (!llmInput) {
    logAiChat("warn", "fashion_search_planner_fallback", {
      reason: "invalid_llm_output",
    });
    plan = buildFallbackPlan({
      brief,
      currentDate: params.currentDate,
    });
    planSource = "fallback";
  } else {
    plan = toFashionSearchPlan({
      input: llmInput,
      brief,
      currentDate: params.currentDate,
    });
    planSource = "planner";
    logAiChat("info", "fashion_search_planner_completed", {
      mode: plan.mode,
      slotCount: plan.slots.length,
      reasoning: plan.reasoning,
    });
  }

  const resolved = await finalizeResolvedPlan({
    plan,
    planSource,
    brief,
    recipientProfile,
    currentDate: params.currentDate,
    signal: params.signal,
    traceId: params.traceId,
  });
  return { plan: resolved, recipientProfile };
}

/**
 * Test/helper entry: run clamps + invariants + budget on an already-built plan
 * (same choke point as production).
 */
export async function resolveFashionSearchPlan(params: {
  plan: FashionSearchPlan;
  planSource?: PlanSource;
  traceId?: string | null;
}): Promise<FashionSearchPlan> {
  return finalizeResolvedPlan({
    plan: params.plan,
    planSource: params.planSource ?? params.plan.plan_source ?? "planner",
    brief: params.plan.brief,
    recipientProfile: "",
    currentDate: params.plan.currentDate,
    traceId: params.traceId,
    retriedPlanner: true, // skip LLM retry in helper paths
  });
}

export function fashionSearchPlanToMetadata(
  plan: FashionSearchPlan,
  extras?: Pick<MessageFashionSearchPlanMetaV1, "trace_id">,
): MessageFashionSearchPlanMetaV1 {
  const knowledge_state = plan.brief.knowledge_state ?? {
    department: plan.brief.department_scope ?? "mixed",
    sizes_confirmed: [],
    sizes_unconfirmed: [],
  };

  const allocation = plan.budget_allocation;
  const per_slot_budget = allocation
    ? Object.fromEntries(
        Object.entries(allocation.per_slot).map(([slotId, slot]) => [
          slotId,
          {
            fraction: slot.fraction,
            fraction_source: slot.fraction_source,
            allocated_max: slot.allocated_max,
            padded_max: slot.padded_max,
          },
        ]),
      )
    : undefined;

  return {
    version: 1,
    mode: plan.mode,
    slots: plan.slots,
    reasoning: plan.reasoning,
    plan_source: plan.plan_source,
    recipient_person_id: plan.brief.recipient_person_id,
    knowledge_state,
    trace_id: extras?.trace_id,
    budget_assembly: allocation?.budget_assembly,
    budget_interpretation: allocation?.budget_interpretation,
    budget_allocation_validation: allocation?.validation,
    per_slot_budget,
  };
}

export { validateSlotQueryVariants, buildFallbackPlan, expandOutfitSlots };
