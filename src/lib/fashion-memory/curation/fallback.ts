import { logAiChat } from "@/lib/ai-chat/observability";
import { recordPipelineEvent } from "../observability/trace";
import type { FashionSearchPlan } from "../search-planner/types";
import type { HydratedCandidate } from "../hydration/types";
import { isDegradedOutfitPlan, validateCurationOutput, dropRedundantLooks } from "./validate";
import type {
  CurationRefRegistry,
  DeliverCurationInput,
  DeliverCurationVeto,
  PickRole,
} from "./types";
import { refsForSlot } from "./refs";
import { sanitizeCurationNarration } from "./narration-sanitize";
import type { BudgetAssembly } from "../budget/budgetAllocation";
import type { FashionSlotBrandStatus } from "../router/types";
import { curationLooksTarget, curationPickCap } from "./deliverables";
import { departmentUnknownRank } from "./department-rank";
import {
  isGenderedDepartment,
  resolveSearchDepartment,
} from "../department";

const ROLE_CYCLE: PickRole[] = ["safe", "stretch", "value", "reach", "safe"];

type FallbackPool = {
  verified: HydratedCandidate[];
};

/**
 * CHOKE POINT: every path that produces user-visible picks must read from the
 * same pool state (verified minus deaths/vetoes) and pass the same output
 * validator. Do not re-filter ad hoc from a stale registry snapshot.
 */
function templateLine(
  garment: string,
  role: PickRole,
  styleDirection: string,
): string {
  const base = styleDirection.split(".")[0]?.trim() || garment;
  switch (role) {
    case "stretch":
      return `A premium ${garment} option that pushes ${base} without leaving your brief.`;
    case "value":
      return `Strong ${garment} value — ${base} done honestly, not cheap-looking.`;
    case "reach":
      return `A bolder ${garment} take on ${base} if you want something with more character.`;
    case "anchor":
      return `The ${garment} that anchors this look — ${base} with clear intent.`;
    case "support":
      return `Pairs cleanly with the anchor — ${base} in a supporting role.`;
    default:
      return `Solid ${garment} pick for ${base} — reliable and on-brief.`;
  }
}

function recipientLabel(plan: FashionSearchPlan): string {
  const name = plan.brief.recipient_person_id?.trim();
  // Prefer occasion/style framing over raw person ids.
  if (plan.brief.occasion_context?.trim()) {
    return plan.brief.occasion_context.trim();
  }
  if (name && !name.startsWith("p") && name.length < 40) return name;
  return "this look";
}

export function buildDeterministicFallback(params: {
  plan: FashionSearchPlan;
  registry: CurationRefRegistry;
  /** Live pools after veto deaths — preferred source of truth for picks. */
  pools?: Map<string, FallbackPool>;
  /** Refs already vetoed (belt-and-suspenders with pool.dead). */
  vetoedRefs?: Set<string>;
  harvestedVetoes?: DeliverCurationVeto[];
  thinSlots: string[];
  brandNote?: string;
  budgetNote?: string;
  traceId?: string | null;
}): DeliverCurationInput {
  const vetoed = params.vetoedRefs ?? new Set<string>();
  const department = resolveSearchDepartment({
    knowledgeDepartment: params.plan.brief.knowledge_state?.department,
    departmentScope: params.plan.brief.department_scope,
  });
  const gendered = isGenderedDepartment(department);

  const slots = params.plan.slots.map((planSlot) => {
    const pool = params.pools?.get(planSlot.slot_id);
    const verifiedIds = pool
      ? new Set(pool.verified.map((c) => c.id))
      : null;

    const entries = refsForSlot(params.registry, planSlot.slot_id)
      .filter((entry) => {
        if (vetoed.has(entry.ref)) return false;
        if (verifiedIds && !verifiedIds.has(entry.product_id)) return false;
        return true;
      })
      .sort((a, b) => {
        if (!gendered) return a.score_rank - b.score_rank;
        const unk =
          departmentUnknownRank(a.candidate) -
          departmentUnknownRank(b.candidate);
        if (unk !== 0) return unk;
        return a.score_rank - b.score_rank;
      });

    const count = Math.min(
      curationPickCap({
        mode: params.plan.mode,
        brief: params.plan.brief,
        optionsWanted: planSlot.options_wanted,
      }),
      entries.length,
    );
    const picks = entries.slice(0, count).map((entry, idx) => ({
      ref: entry.ref,
      role:
        planSlot.role === "anchor" && idx === 0
          ? ("anchor" as const)
          : planSlot.role === "support"
            ? ("support" as const)
            : ROLE_CYCLE[idx % ROLE_CYCLE.length]!,
      stylist_line: templateLine(
        planSlot.garment,
        ROLE_CYCLE[idx % ROLE_CYCLE.length]!,
        planSlot.style_direction,
      ),
    }));

    return { slot_id: planSlot.slot_id, picks };
  });

  const emptySlots = slots.filter((s) => s.picks.length === 0).map((s) => s.slot_id);
  const degraded = isDegradedOutfitPlan(params.plan);
  const thinParts = [
    ...params.thinSlots,
    ...emptySlots.filter((id) => !params.thinSlots.includes(id)),
  ];

  const label = recipientLabel(params.plan);
  const garmentList = params.plan.slots.map((s) => s.garment).join(", ");

  const plainThin =
    degraded
      ? `You asked for ${params.plan.brief.garments.join(", ")}; I only locked ${garmentList} this round — the set is incomplete.`
      : thinParts.length > 0
        ? `Fewer solid options than I'd like for ${thinParts.join(", ")} — here's what's genuinely in stock.`
        : `I couldn't finish a full stylist pass — these are the strongest verified picks for ${label}.`;

  const plainOpening =
    degraded || emptySlots.length > 0
      ? `Partial set only — ${params.plan.slots.length} of ${Math.min(params.plan.brief.garments.length, 5)} pieces made it through with verified stock.`
      : thinParts.length > 0
        ? `Thin on ${thinParts.join(", ")} — showing what actually works, not a full spread.`
        : `Here are the strongest verified picks for ${label}.`;

  const thinNote =
    degraded || thinParts.length > 0 || params.plan.plan_source === "fallback"
      ? plainThin
      : undefined;

  const narration = sanitizeCurationNarration({
    opening: plainOpening,
    thin_note: thinNote,
    brand_note: params.brandNote,
    budget_note: params.budgetNote,
    plainOpening,
    plainThin,
    assumptions: params.plan.brief.assumptions,
    traceId: params.traceId,
  });

  // Capsule pairing — emit a minimal top×bottom grid so validateCurationOutput
  // does not hard-fail on capsule_orphan for deterministic fallback.
  let capsule_outfits: DeliverCurationInput["capsule_outfits"];
  if (params.plan.mode === "capsule") {
    const tops = slots.filter((s) =>
      /\b(shirt|blouse|top|sweater|tee)\b/i.test(
        params.plan.slots.find((p) => p.slot_id === s.slot_id)?.garment ?? "",
      ),
    );
    const bottoms = slots.filter((s) =>
      /\b(trousers|trouser|pants|pant|jeans|jean|skirts|skirt|bottoms|bottom)\b/i.test(
        params.plan.slots.find((p) => p.slot_id === s.slot_id)?.garment ?? "",
      ),
    );
    const outfits: NonNullable<DeliverCurationInput["capsule_outfits"]> = [];
    for (const top of tops) {
      for (const tPick of top.picks.slice(0, 2)) {
        for (const bottom of bottoms) {
          for (const bPick of bottom.picks.slice(0, 2)) {
            outfits.push({
              item_refs: [tPick.ref, bPick.ref],
              label: "Everyday rotation",
            });
          }
        }
      }
    }
    if (outfits.length) capsule_outfits = outfits.slice(0, 8);
  }

  // Outfit looks — always emit named combos (rung 4). Outfit mode may degrade
  // in polish, never in structure (looks.length === 0 is a contract failure).
  const looks =
    params.plan.mode === "outfit"
      ? synthesizeOutfitLooks({
          slots,
          registry: params.registry,
          target: curationLooksTarget(params.plan.brief),
        })
      : undefined;

  return {
    slots,
    vetoes: params.harvestedVetoes ?? [],
    narration,
    ...(capsule_outfits ? { capsule_outfits } : {}),
    ...(looks?.length ? { looks } : {}),
  };
}

/**
 * Compose named looks from top picks across slots (anchor + supports).
 * Look N uses the Nth pick from each slot that has one.
 */
export function synthesizeOutfitLooks(params: {
  slots: Array<{ slot_id: string; picks: Array<{ ref: string }> }>;
  registry: CurationRefRegistry;
  target?: number;
}): NonNullable<DeliverCurationInput["looks"]> {
  const target = params.target ?? 3;
  const withPicks = params.slots.filter((s) => s.picks.length > 0);
  if (withPicks.length < 2) return [];

  const maxDepth = Math.min(
    target,
    Math.max(...withPicks.map((s) => s.picks.length)),
  );
  const looks: NonNullable<DeliverCurationInput["looks"]> = [];

  for (let i = 0; i < maxDepth; i++) {
    const item_refs: string[] = [];
    for (const slot of withPicks) {
      const pick = slot.picks[i] ?? slot.picks[0];
      if (pick && !item_refs.includes(pick.ref)) item_refs.push(pick.ref);
    }
    if (item_refs.length < 2) continue;
    let total = 0;
    for (const ref of item_refs) {
      const entry = params.registry.get(ref);
      if (!entry) continue;
      const c = entry.candidate;
      const amount =
        c.final_price?.amount ?? c.price?.amount ?? 0;
      total += amount / 100;
    }
    looks.push({
      name: `Look ${i + 1}`,
      item_refs,
      total: Math.round(total * 100) / 100,
      note: "Verified combination from the hydrated rack",
    });
  }

  return dropRedundantLooks(looks);
}

function repairFallbackNarration(params: {
  output: DeliverCurationInput;
  brandNote?: string;
  budgetNote?: string;
  thinNote?: string;
  issues: Array<{ code: string }>;
  assumptions?: string[];
  traceId?: string | null;
}): DeliverCurationInput {
  let narration = { ...params.output.narration };
  const codes = new Set(params.issues.map((i) => i.code));
  if (codes.has("missing_brand_note") && params.brandNote) {
    narration.brand_note = params.brandNote;
  }
  if (codes.has("missing_budget_note") && params.budgetNote) {
    narration.budget_note = params.budgetNote;
  }
  if (codes.has("missing_thin_note")) {
    narration.thin_note =
      params.thinNote ??
      narration.thin_note ??
      "Fewer solid options than I'd like — showing what actually works.";
  }
  if (codes.has("degraded_success_opening")) {
    narration.opening =
      "Partial set only — showing the pieces that cleared stock checks.";
  }
  narration = sanitizeCurationNarration({
    ...narration,
    plainOpening: narration.opening,
    plainThin: narration.thin_note,
    assumptions: params.assumptions,
    traceId: params.traceId,
  });
  return { ...params.output, narration };
}

function minimalHonestFallback(params: {
  output: DeliverCurationInput;
  brandNote?: string;
  budgetNote?: string;
  thinNote?: string;
  assumptions?: string[];
  traceId?: string | null;
}): DeliverCurationInput {
  const narration = sanitizeCurationNarration({
    opening:
      params.output.narration.opening.trim() ||
      "Here are the strongest verified picks I could lock.",
    thin_note:
      params.thinNote ??
      params.output.narration.thin_note ??
      "Presentation is thinner than a full stylist pass — these are the verified survivors.",
    brand_note: params.brandNote ?? params.output.narration.brand_note,
    budget_note: params.budgetNote ?? params.output.narration.budget_note,
    plainOpening: "Here are the strongest verified picks I could lock.",
    plainThin:
      "Presentation is thinner than a full stylist pass — these are the verified survivors.",
    assumptions: params.assumptions,
    traceId: params.traceId,
  });
  return {
    slots: params.output.slots.filter((s) => s.picks.length > 0),
    vetoes: params.output.vetoes,
    looks: params.output.looks,
    capsule_outfits: params.output.capsule_outfits,
    narration,
  };
}

/**
 * CHOKE POINT: every path producing user-visible picks exits through
 * validateCurationOutput. Self-repairs mandatory narration from templates
 * (through the machinery guard); if still invalid → minimal honest shape
 * + `fallback_validation_degraded`.
 *
 * Soft / inapplicable on pure deterministic fallout (documented):
 * - capsule_orphan — fallback emits a minimal pairing grid when mode=capsule
 * - set_over_budget — validator may trim via deterministicBudgetSwap
 * Mandatory-note + badge/ref integrity are NOT skippable.
 */
export function validateAndRepairFallback(params: {
  output: DeliverCurationInput;
  registry: CurationRefRegistry;
  plan: FashionSearchPlan;
  slots: Array<{
    slot_id: string;
    garment?: string;
    thin_slot?: boolean;
    coverage_gap?: boolean;
    curator_exclusions?: string[];
    brand_status?: FashionSlotBrandStatus;
  }>;
  excludedRefs?: string[];
  budget_assembly?: BudgetAssembly;
  budget_tension?: { severity: string };
  budget_interpretation?: string;
  brandNote?: string;
  budgetNote?: string;
  thinNote?: string;
  traceId?: string | null;
}): { output: DeliverCurationInput; degraded: boolean; issues: string[] } {
  let current = params.output;
  let validated = validateCurationOutput({
    output: current,
    registry: params.registry,
    plan: params.plan,
    slots: params.slots,
    excludedRefs: params.excludedRefs,
    budget_assembly: params.budget_assembly,
    budget_tension: params.budget_tension,
    budget_interpretation: params.budget_interpretation,
    deterministicBudgetSwap: true,
  });

  if (!validated.ok && validated.output) {
    current = repairFallbackNarration({
      output: validated.output,
      brandNote: params.brandNote,
      budgetNote: params.budgetNote,
      thinNote: params.thinNote ?? validated.output.narration.thin_note,
      issues: validated.issues,
      assumptions: params.plan.brief.assumptions,
      traceId: params.traceId,
    });
    validated = validateCurationOutput({
      output: current,
      registry: params.registry,
      plan: params.plan,
      slots: params.slots,
      excludedRefs: params.excludedRefs,
      budget_assembly: params.budget_assembly,
      budget_tension: params.budget_tension,
      budget_interpretation: params.budget_interpretation,
      deterministicBudgetSwap: true,
    });
  }

  if (validated.ok && validated.output) {
    return {
      output: validated.output,
      degraded: false,
      issues: validated.issues.map((i) => i.code),
    };
  }

  const degraded = minimalHonestFallback({
    output: validated.output ?? current,
    brandNote: params.brandNote,
    budgetNote: params.budgetNote,
    thinNote:
      params.thinNote ??
      "Couldn't complete a full stylist pass — these are the verified survivors.",
    assumptions: params.plan.brief.assumptions,
    traceId: params.traceId,
  });
  recordPipelineEvent({
    traceId: params.traceId,
    stage: "fallback_validation_degraded",
    payload: {
      issues: validated.issues.map((i) => i.code),
    },
  });
  logAiChat("warn", "fashion_curation_fallback_validation_degraded", {
    traceId: params.traceId,
    issues: validated.issues.map((i) => i.code),
  });
  return {
    output: degraded,
    degraded: true,
    issues: validated.issues.map((i) => i.code),
  };
}
