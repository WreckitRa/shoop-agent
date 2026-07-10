import { logAiChat } from "@/lib/ai-chat/observability";
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

function expectedOutfitSlotCount(brief: FashionSearchBrief): number {
  if (brief.request_type !== "outfit" && brief.request_type !== "capsule") {
    return 1;
  }
  return Math.max(selectGarmentsForPlan(brief.garments).length, 2);
}

function needsOutfitSlotExpansion(plan: FashionSearchPlan): boolean {
  if (plan.mode !== "outfit" && plan.mode !== "capsule") return false;
  return plan.slots.length < expectedOutfitSlotCount(plan.brief);
}

function reconcileOutfitCoverage(plan: FashionSearchPlan): FashionSearchPlan {
  if (plan.slots.length < 2) {
    return expandOutfitSlots({ plan });
  }
  const expected = selectGarmentsForPlan(plan.brief.garments);
  const existing = new Set(
    plan.slots.map((s) => s.garment.toLowerCase().trim()),
  );
  const missing = expected.filter((g) => !existing.has(g.toLowerCase().trim()));
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
    slots: [...plan.slots, ...added].slice(0, 5),
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
      logAiChat("warn", "fashion_search_planner_outfit_slot_retry", {
        mode: working.mode,
        slotCount: working.slots.length,
      });
      const retryInput = await runSearchPlanner({
        brief: params.brief,
        recipientProfile: params.recipientProfile,
        currentDate: params.currentDate,
        signal: params.signal,
        traceId: params.traceId,
      });
      if (retryInput) {
        const retried = toFashionSearchPlan({
          input: retryInput,
          brief: params.brief,
          currentDate: params.currentDate,
        });
        return finalizeResolvedPlan({
          ...params,
          plan: retried,
          planSource: "clamped",
          retriedPlanner: true,
        });
      }
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

  working = { ...working, plan_source: planSource };

  checkPlanInvariants({
    traceId: params.traceId,
    plan: working,
    validatorFallbackSlots: clamped.validatorFallbackSlots,
  });

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
        plan_source: planSource,
      },
    });
  }

  return { ...withBudget, plan_source: planSource };
}

/** Full pipeline: LLM plan → Phase 3 validation → clamps → persisted shape. */
export async function planSearchFromBrief(params: {
  brief: FashionSearchBrief;
  userId: string;
  recipientPersonId: string;
  currentDate: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
  signal?: AbortSignal;
  traceId?: string | null;
}): Promise<FashionSearchPlan> {
  const recipientProfile = await buildRecipientProfileBlockForPlanner({
    userId: params.userId,
    recipientPersonId: params.recipientPersonId,
    guestSnapshot: params.guestSnapshot,
  });

  const llmInput = await runSearchPlanner({
    brief: params.brief,
    recipientProfile,
    currentDate: params.currentDate,
    signal: params.signal,
    traceId: params.traceId,
  });

  let plan: FashionSearchPlan;
  let planSource: PlanSource;

  if (!llmInput) {
    logAiChat("warn", "fashion_search_planner_fallback", {
      reason: "invalid_llm_output",
    });
    plan = buildFallbackPlan({
      brief: params.brief,
      currentDate: params.currentDate,
    });
    planSource = "fallback";
  } else {
    plan = toFashionSearchPlan({
      input: llmInput,
      brief: params.brief,
      currentDate: params.currentDate,
    });
    planSource = "planner";
    logAiChat("info", "fashion_search_planner_completed", {
      mode: plan.mode,
      slotCount: plan.slots.length,
      reasoning: plan.reasoning,
    });
  }

  return finalizeResolvedPlan({
    plan,
    planSource,
    brief: params.brief,
    recipientProfile,
    currentDate: params.currentDate,
    signal: params.signal,
    traceId: params.traceId,
  });
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
