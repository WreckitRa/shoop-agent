import type { BudgetAssembly } from "../budget/budgetAllocation";
import type { FashionSearchPlan } from "../search-planner/types";
import type { FashionSlotBrandStatus } from "../router/types";
import { fromMinorUnits } from "@/lib/money";
import type {
  CurationRefRegistry,
  DeliverCurationInput,
  DeliverCurationPick,
  RefEntry,
} from "./types";
import { refsForSlot } from "./refs";
import { CURATION_VETO_TRIPWIRE_RATIO } from "./config";
import {
  CURATION_LOOKS_TARGET,
  curationPickCap,
} from "./deliverables";

export type ValidationIssue = {
  code: string;
  message: string;
  slot_id?: string;
};

export type ValidationResult =
  | { ok: true; output: DeliverCurationInput; issues: ValidationIssue[] }
  | { ok: false; output: DeliverCurationInput | null; issues: ValidationIssue[] };

function hydratedPriceMajor(entry: RefEntry): number {
  const price = entry.candidate.final_price ?? entry.candidate.price;
  return fromMinorUnits(price?.amount ?? 0);
}

function recomputePickedSetTotal(
  output: DeliverCurationInput,
  registry: CurationRefRegistry,
): number {
  let total = 0;
  for (const slot of output.slots) {
    for (const pick of slot.picks) {
      const entry = registry.get(pick.ref);
      if (entry) total += hydratedPriceMajor(entry);
    }
  }
  return Math.round(total * 100) / 100;
}

function capsulePairingsComplete(
  output: DeliverCurationInput,
  plan: FashionSearchPlan,
  registry: CurationRefRegistry,
): boolean {
  const outfits = output.capsule_outfits ?? [];
  const tops = plan.slots.filter((s) =>
    /\b(shirt|blouse|top|sweater|tee)\b/i.test(s.garment),
  );
  const bottoms = plan.slots.filter((s) =>
    /\b(trousers|trouser|pants|pant|jeans|jean|skirts|skirt|bottoms|bottom)\b/i.test(
      s.garment,
    ),
  );
  if (!tops.length || !bottoms.length) return true;

  for (const top of tops) {
    const pickedTopRefs =
      output.slots
        .find((s) => s.slot_id === top.slot_id)
        ?.picks.map((p) => p.ref) ?? [];
    for (const bottom of bottoms) {
      const bottomRefs = refsForSlot(registry, bottom.slot_id).map(
        (e) => e.ref,
      );
      const hasPair = outfits.some(
        (o) =>
          o.item_refs.some((r) => pickedTopRefs.includes(r)) &&
          o.item_refs.some((r) => bottomRefs.includes(r)),
      );
      if (!hasPair) return false;
    }
  }
  return true;
}

function recomputeLookTotal(
  look: { item_refs: string[] },
  registry: CurationRefRegistry,
): number {
  let total = 0;
  for (const ref of look.item_refs) {
    const entry = registry.get(ref);
    if (entry) total += hydratedPriceMajor(entry);
  }
  return Math.round(total * 100) / 100;
}

function deterministicSwapCapsuleSet(params: {
  output: DeliverCurationInput;
  registry: CurationRefRegistry;
  plan: FashionSearchPlan;
  ceiling: number;
}): { output: DeliverCurationInput; setTotal: number; swapped: boolean } {
  let output = params.output;
  const vetoed = new Set(output.vetoes.map((v) => v.ref));
  const pickedRefs = new Set(
    output.slots.flatMap((s) => s.picks.map((p) => p.ref)),
  );

  let setTotal = recomputePickedSetTotal(output, params.registry);
  if (setTotal <= params.ceiling) {
    return { output, setTotal, swapped: false };
  }

  const expensivePicks: Array<{
    slot_id: string;
    ref: string;
    price: number;
    pickIdx: number;
  }> = [];
  for (const slot of output.slots) {
    slot.picks.forEach((pick, pickIdx) => {
      const entry = params.registry.get(pick.ref);
      if (entry) {
        expensivePicks.push({
          slot_id: slot.slot_id,
          ref: pick.ref,
          price: hydratedPriceMajor(entry),
          pickIdx,
        });
      }
    });
  }
  expensivePicks.sort((a, b) => b.price - a.price);

  let swapped = false;
  for (const expensive of expensivePicks) {
    if (setTotal <= params.ceiling) break;

    const alternatives = refsForSlot(params.registry, expensive.slot_id)
      .filter(
        (e) =>
          !vetoed.has(e.ref) &&
          !pickedRefs.has(e.ref) &&
          e.ref !== expensive.ref,
      )
      .map((e) => ({ ref: e.ref, price: hydratedPriceMajor(e) }))
      .filter((a) => a.price < expensive.price)
      .sort((a, b) => a.price - b.price);

    for (const alt of alternatives) {
      const newSlots = output.slots.map((s) => {
        if (s.slot_id !== expensive.slot_id) return s;
        return {
          ...s,
          picks: s.picks.map((p, i) =>
            i === expensive.pickIdx ? { ...p, ref: alt.ref } : p,
          ),
        };
      });
      const candidate: DeliverCurationInput = {
        ...output,
        slots: newSlots,
        capsule_outfits: (output.capsule_outfits ?? []).map((o) => ({
          ...o,
          item_refs: o.item_refs.map((r) =>
            r === expensive.ref ? alt.ref : r,
          ),
        })),
      };

      if (
        !capsulePairingsComplete(candidate, params.plan, params.registry)
      ) {
        continue;
      }

      const newTotal = recomputePickedSetTotal(candidate, params.registry);
      if (newTotal < setTotal) {
        output = candidate;
        pickedRefs.delete(expensive.ref);
        pickedRefs.add(alt.ref);
        setTotal = newTotal;
        swapped = true;
        break;
      }
    }
  }

  return { output, setTotal, swapped };
}

function trimCapsuleToBudget(params: {
  output: DeliverCurationInput;
  registry: CurationRefRegistry;
  ceiling: number;
}): { output: DeliverCurationInput; setTotal: number } {
  let output = params.output;
  let setTotal = recomputePickedSetTotal(output, params.registry);
  if (setTotal <= params.ceiling) return { output, setTotal };

  const removable: Array<{
    slot_id: string;
    pickIdx: number;
    ref: string;
    price: number;
  }> = [];
  for (const slot of output.slots) {
    slot.picks.forEach((pick, pickIdx) => {
      const entry = params.registry.get(pick.ref);
      if (entry) {
        removable.push({
          slot_id: slot.slot_id,
          pickIdx,
          ref: pick.ref,
          price: hydratedPriceMajor(entry),
        });
      }
    });
  }
  removable.sort((a, b) => b.price - a.price);

  for (const item of removable) {
    if (setTotal <= params.ceiling) break;
    output = {
      ...output,
      slots: output.slots.map((s) => {
        if (s.slot_id !== item.slot_id) return s;
        return {
          ...s,
          picks: s.picks.filter((p) => p.ref !== item.ref),
        };
      }),
      capsule_outfits: (output.capsule_outfits ?? []).map((o) => ({
        ...o,
        item_refs: o.item_refs.filter((r) => r !== item.ref),
      })),
    };
    setTotal = recomputePickedSetTotal(output, params.registry);
  }

  return { output, setTotal };
}

/**
 * Pad UNDER-filled slots (some picks already chosen) from the verified bench.
 * NEVER fill EMPTY slots from the bench — that injects unvetted junk with
 * template lines (Accessories Incident). Empty slots ship as dropped + note.
 */
const HONEST_PAD_LINES = [
  "A solid, safe pick in this category.",
  "Quietly on-brief — a reliable option here.",
  "Clean and wearable; keeps the tray coherent.",
] as const;

function honestPadLine(index: number): string {
  return HONEST_PAD_LINES[index % HONEST_PAD_LINES.length]!;
}

function padCandidateSane(entry: {
  candidate: {
    suspicions?: Array<{ rule: string }>;
  };
}): boolean {
  const suspicions = entry.candidate.suspicions ?? [];
  if (
    suspicions.some((s) =>
      /attire_conflict|department_mismatch|coverage_gap/i.test(s.rule),
    )
  ) {
    return false;
  }
  return true;
}

export function fillEmptySlotPicks(params: {
  output: DeliverCurationInput;
  registry: CurationRefRegistry;
  plan: FashionSearchPlan;
  slotMeta?: Array<{ slot_id: string; coverage_gap?: boolean; thin_slot?: boolean }>;
}): {
  output: DeliverCurationInput;
  filledSlots: string[];
  paddedSlots: string[];
  droppedEmptySlots: string[];
} {
  const vetoed = new Set(params.output.vetoes.map((v) => v.ref));
  const filledSlots: string[] = [];
  const paddedSlots: string[] = [];
  const droppedEmptySlots: string[] = [];

  function padUnderfilled(
    slotOutput: DeliverCurationInput["slots"][number],
    planSlot: FashionSearchPlan["slots"][number],
  ): DeliverCurationInput["slots"][number] {
    if (slotOutput.picks.length === 0) {
      droppedEmptySlots.push(slotOutput.slot_id);
      return slotOutput;
    }

    const maxPicks = curationPickCap({
      mode: params.plan.mode,
      optionsWanted: planSlot.options_wanted,
    });
    if (slotOutput.picks.length >= maxPicks) return slotOutput;

    const meta = params.slotMeta?.find((s) => s.slot_id === slotOutput.slot_id);
    if (meta?.coverage_gap) return slotOutput;

    const already = new Set(slotOutput.picks.map((p) => p.ref));
    const available = refsForSlot(params.registry, slotOutput.slot_id).filter(
      (e) =>
        !vetoed.has(e.ref) &&
        !already.has(e.ref) &&
        padCandidateSane(e),
    );
    if (!available.length) return slotOutput;

    const need = maxPicks - slotOutput.picks.length;
    const extras: DeliverCurationPick[] = available
      .slice(0, need)
      .map((entry, idx) => ({
        ref: entry.ref,
        role:
          planSlot.role === "anchor" && slotOutput.picks.length + idx === 0
            ? ("anchor" as const)
            : planSlot.role === "support"
              ? ("support" as const)
              : ("safe" as const),
        stylist_line: honestPadLine(idx),
      }));
    if (!extras.length) return slotOutput;

    paddedSlots.push(slotOutput.slot_id);
    return { ...slotOutput, picks: [...slotOutput.picks, ...extras] };
  }

  const slots = params.output.slots.map((slotOutput) => {
    const planSlot = params.plan.slots.find((s) => s.slot_id === slotOutput.slot_id);
    if (!planSlot) return slotOutput;
    return padUnderfilled(slotOutput, planSlot);
  });

  const present = new Set(slots.map((s) => s.slot_id));
  for (const planSlot of params.plan.slots) {
    if (present.has(planSlot.slot_id)) continue;
    droppedEmptySlots.push(planSlot.slot_id);
    slots.push({ slot_id: planSlot.slot_id, picks: [] });
  }

  return {
    output: { ...params.output, slots },
    filledSlots,
    paddedSlots,
    droppedEmptySlots,
  };
}

const TIGHT_BUDGET_LOOK_NOTE =
  "A full outfit at this budget ran high — showing the closest real set I could assemble.";

/**
 * When every curated look exceeds the ceiling, keep the cheapest instead of
 * discarding live Opus output for deterministic fallback.
 */
function salvageOverBudgetLooks(params: {
  looks: NonNullable<DeliverCurationInput["looks"]>;
  registry: CurationRefRegistry;
  ceiling: number;
  narration: DeliverCurationInput["narration"];
}): {
  looks: NonNullable<DeliverCurationInput["looks"]>;
  narration: DeliverCurationInput["narration"];
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const under: Array<{ look: NonNullable<DeliverCurationInput["looks"]>[number]; computed: number }> =
    [];
  const over: Array<{ look: NonNullable<DeliverCurationInput["looks"]>[number]; computed: number }> =
    [];

  for (const look of params.looks) {
    const computed = recomputeLookTotal(look, params.registry);
    const next = { ...look, total: computed };
    if (computed > params.ceiling) {
      issues.push({
        code: "look_over_budget",
        message: `Look "${look.name}" computed ${computed} > ${params.ceiling}`,
      });
      over.push({ look: next, computed });
    } else {
      under.push({ look: next, computed });
    }
  }

  if (under.length > 0) {
    return {
      looks: under.map((u) => u.look),
      narration: params.narration,
      issues,
    };
  }

  if (over.length === 0) {
    return { looks: [], narration: params.narration, issues };
  }

  over.sort((a, b) => a.computed - b.computed);
  const closest = over[0]!;
  issues.push({
    code: "look_over_budget_kept",
    message: `Kept closest over-budget look "${closest.look.name}" at ${closest.computed} (ceiling ${params.ceiling})`,
  });

  let narration = params.narration;
  if (!narration.budget_note?.trim()) {
    narration = {
      ...narration,
      budget_note: `${TIGHT_BUDGET_LOOK_NOTE} About $${closest.computed}.`,
    };
    issues.push({
      code: "budget_note_injected",
      message: "Injected budget_note for kept over-budget look",
    });
  }

  return { looks: [closest.look], narration, issues };
}

function brandNoteRequired(
  slots: Array<{ brand_status?: FashionSlotBrandStatus }>,
): boolean {
  return slots.some(
    (s) =>
      s.brand_status === "partial" ||
      s.brand_status === "translated",
  );
}

function budgetNoteRequired(params: {
  budget_tension?: { severity: string };
  budget_interpretation?: string;
}): boolean {
  return (
    (params.budget_tension?.severity &&
      params.budget_tension.severity !== "none") ||
    params.budget_interpretation === "per_item_stated" ||
    params.budget_interpretation === "per_item_assumed" ||
    params.budget_interpretation === "set_total_assumed" ||
    params.budget_interpretation === "total_stated"
  );
}

const FITTING_ROOM_SUCCESS_RE = /\bfitting room\b/i;

/** Outfit/capsule delivering fewer slots than the brief promised. */
export function isDegradedOutfitPlan(plan: FashionSearchPlan): boolean {
  if (plan.mode !== "outfit" && plan.mode !== "capsule") return false;
  const expected = Math.min(Math.max(plan.brief.garments.length, 1), 5);
  return plan.slots.length < expected;
}

function stripUnknownRefs(
  output: DeliverCurationInput,
  registry: CurationRefRegistry,
  excludedRefs: Set<string>,
): DeliverCurationInput {
  const known = (ref: string) =>
    registry.has(ref) && !excludedRefs.has(ref);

  return {
    ...output,
    slots: output.slots.map((s) => ({
      ...s,
      picks: s.picks.filter((p) => known(p.ref)),
    })),
    looks: output.looks?.map((l) => ({
      ...l,
      item_refs: l.item_refs.filter(known),
    })),
    capsule_outfits: output.capsule_outfits?.map((o) => ({
      ...o,
      item_refs: o.item_refs.filter(known),
    })),
    vetoes: output.vetoes.filter((v) => known(v.ref)),
  };
}

function checkExclusionPatterns(
  entry: RefEntry,
  exclusions: string[],
): boolean {
  const buckets = entry.candidate.normalized?.colors?.buckets ?? [];
  for (const ex of exclusions) {
    if (/pattern|print|logo|flashy|loud|graphic/i.test(ex)) {
      if (buckets.includes("print")) return true;
    }
  }
  return false;
}

export function validateCurationOutput(params: {
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
  /** After LLM retry: swap expensive picks for cheaper bench alternatives. */
  deterministicBudgetSwap?: boolean;
}): ValidationResult {
  const issues: ValidationIssue[] = [];
  const excluded = new Set(params.excludedRefs ?? []);
  let output = stripUnknownRefs(params.output, params.registry, excluded);

  const planSlotById = new Map(params.plan.slots.map((s) => [s.slot_id, s]));

  for (const slotOutput of output.slots) {
    const planSlot = planSlotById.get(slotOutput.slot_id);
    const slotMeta = params.slots.find((s) => s.slot_id === slotOutput.slot_id);
    if (!planSlot) {
      issues.push({
        code: "unknown_slot",
        message: `Unknown slot_id ${slotOutput.slot_id}`,
      });
      continue;
    }

    const maxPicks = curationPickCap({
      mode: params.plan.mode,
      optionsWanted: planSlot.options_wanted,
    });
    if (slotOutput.picks.length > maxPicks) {
      slotOutput.picks = slotOutput.picks.slice(0, maxPicks);
      issues.push({
        code: "pick_count_trimmed",
        message: `Trimmed picks for ${slotOutput.slot_id} to ${maxPicks}`,
        slot_id: slotOutput.slot_id,
      });
    }

    if (
      slotOutput.picks.length < maxPicks &&
      !slotMeta?.thin_slot &&
      refsForSlot(params.registry, slotOutput.slot_id).length >= maxPicks
    ) {
      // Record for after pad — do not hard-fail yet. Live Opus + pool padding
      // is preferred over discarding the whole curation for underfilled_slot.
      const slotVetoCount = output.vetoes.filter((v) => {
        const entry = params.registry.get(v.ref);
        return entry?.slot_id === slotOutput.slot_id;
      }).length;
      issues.push({
        code:
          slotVetoCount > 0 ? "underfilled_slot_justified" : "underfilled_slot",
        message: `Slot ${slotOutput.slot_id} under-filled (${slotOutput.picks.length}/${maxPicks}${slotVetoCount ? `, ${slotVetoCount} vetoed` : ""})`,
        slot_id: slotOutput.slot_id,
      });
    }

    for (const pick of slotOutput.picks) {
      const entry = params.registry.get(pick.ref);
      if (!entry) continue;
      if (
        checkExclusionPatterns(entry, slotMeta?.curator_exclusions ?? [])
      ) {
        issues.push({
          code: "exclusion_violation_data",
          message: `Pick ${pick.ref} may violate exclusion patterns`,
          slot_id: slotOutput.slot_id,
        });
      }
    }
  }

  if (brandNoteRequired(params.slots) && !output.narration.brand_note?.trim()) {
    issues.push({
      code: "missing_brand_note",
      message: "brand_note required when brand_status is partial/translated",
    });
  }

  if (
    budgetNoteRequired({
      budget_tension: params.budget_tension,
      budget_interpretation: params.budget_interpretation,
    }) &&
    !output.narration.budget_note?.trim()
  ) {
    issues.push({
      code: "missing_budget_note",
      message: "budget_note required for budget tension or per-item assumption",
    });
  }

  if (isDegradedOutfitPlan(params.plan)) {
    const expected = Math.min(Math.max(params.plan.brief.garments.length, 1), 5);
    if (!output.narration.thin_note?.trim()) {
      issues.push({
        code: "missing_thin_note",
        message: `thin_note required for degraded ${params.plan.mode} plan (${params.plan.slots.length}/${expected} slots)`,
      });
    }
    if (FITTING_ROOM_SUCCESS_RE.test(output.narration.opening)) {
      issues.push({
        code: "degraded_success_opening",
        message:
          "fitting-room success opening is invalid over a degraded outfit/capsule plan",
      });
    }
  }

  // Pad under-filled slots only — never junk-fill empty slots.
  const filled = fillEmptySlotPicks({
    output,
    registry: params.registry,
    plan: params.plan,
    slotMeta: params.slots,
  });
  output = filled.output;
  for (const slotId of filled.paddedSlots) {
    issues.push({
      code: "underfilled_slot_padded",
      message: `Padded under-filled slot ${slotId} from verified pool`,
      slot_id: slotId,
    });
  }
  for (const slotId of filled.droppedEmptySlots) {
    issues.push({
      code: "empty_slot_dropped",
      message: `Kept empty slot ${slotId} (no junk-fill)`,
      slot_id: slotId,
    });
  }

  // Honest coverage / thin note when accessory (or any) slots shipped empty.
  const coverageGaps = (params.slots ?? []).filter((s) => s.coverage_gap);
  const emptyWithGap = filled.droppedEmptySlots.filter((id) =>
    coverageGaps.some((s) => s.slot_id === id),
  );
  if (emptyWithGap.length && !output.narration.thin_note?.trim()) {
    const garments = emptyWithGap
      .map(
        (id) =>
          params.slots?.find((s) => s.slot_id === id)?.garment ??
          params.plan.slots.find((s) => s.slot_id === id)?.garment ??
          id,
      )
      .filter(Boolean);
    const label =
      garments.length === 1
        ? garments[0]
        : garments.slice(0, -1).join(", ") + ` and ${garments[garments.length - 1]}`;
    output = {
      ...output,
      narration: {
        ...output.narration,
        thin_note: `My shops came up short on ${label} this time — want me to focus the tray on what did come through?`,
      },
    };
  }

  // Soften pre-pad underfill warnings once padding recovered the slot.
  for (let i = issues.length - 1; i >= 0; i -= 1) {
    const issue = issues[i]!;
    if (issue.code !== "underfilled_slot" && issue.code !== "underfilled_slot_justified") {
      continue;
    }
    const slotId = issue.slot_id;
    if (!slotId) continue;
    const planSlot = planSlotById.get(slotId);
    const slotOut = output.slots.find((s) => s.slot_id === slotId);
    if (!planSlot || !slotOut) continue;
    if (
      slotOut.picks.length >=
      curationPickCap({
        mode: params.plan.mode,
        optionsWanted: planSlot.options_wanted,
      })
    ) {
      // Fully recovered — keep underfilled_slot_padded / justified as soft only.
      if (issue.code === "underfilled_slot") {
        issues.splice(i, 1);
      }
    } else if (issue.code === "underfilled_slot" && slotOut.picks.length > 0) {
      // Partial recovery: keep live curation as soft warning.
      const cap = curationPickCap({
        mode: params.plan.mode,
        optionsWanted: planSlot.options_wanted,
      });
      issues[i] = {
        ...issue,
        code: "underfilled_slot_partial",
        message: `Slot ${slotId} still short after pad (${slotOut.picks.length}/${cap})`,
      };
    }
  }

  for (const slotOutput of output.slots) {
    const poolSize = refsForSlot(params.registry, slotOutput.slot_id).length;
    const vetoed = new Set(output.vetoes.map((v) => v.ref));
    const available = refsForSlot(params.registry, slotOutput.slot_id).filter(
      (e) => !vetoed.has(e.ref),
    ).length;
    const meta = params.slots.find((s) => s.slot_id === slotOutput.slot_id);
    if (slotOutput.picks.length === 0 && available > 0) {
      // Soft warning — never hard-fail to junk-fill empty slots.
      issues.push({
        code: meta?.coverage_gap
          ? "empty_slot_coverage"
          : "empty_slot_dropped",
        message: `Slot ${slotOutput.slot_id} delivered empty (no junk-fill)`,
        slot_id: slotOutput.slot_id,
      });
    } else if (slotOutput.picks.length === 0 && poolSize > 0 && available === 0) {
      issues.push({
        code: "empty_slot_all_vetoed",
        message: `Slot ${slotOutput.slot_id} pool fully vetoed`,
        slot_id: slotOutput.slot_id,
      });
    }
  }

  const assembly = params.budget_assembly;
  const constraintType = assembly?.constraint_type ?? "per_look";
  const budgetCeiling = assembly
    ? assembly.total_max * (1 + assembly.tolerance)
    : null;

  if (constraintType === "set_total" && assembly && output.slots.length) {
    let setTotal = recomputePickedSetTotal(output, params.registry);

    if (budgetCeiling != null && setTotal > budgetCeiling) {
      if (params.deterministicBudgetSwap) {
        const swapped = deterministicSwapCapsuleSet({
          output,
          registry: params.registry,
          plan: params.plan,
          ceiling: budgetCeiling,
        });
        output = swapped.output;
        setTotal = swapped.setTotal;
        if (swapped.swapped) {
          issues.push({
            code: "set_budget_swapped",
            message: `Deterministic swap reduced set total to ${setTotal}`,
          });
        }
      }

      if (setTotal > budgetCeiling) {
        if (params.deterministicBudgetSwap) {
          const trimmed = trimCapsuleToBudget({
            output,
            registry: params.registry,
            ceiling: budgetCeiling,
          });
          output = trimmed.output;
          setTotal = trimmed.setTotal;
          const thinNote =
            output.narration.thin_note?.trim() ||
            `Set totals $${setTotal} against $${assembly.total_max} — trimmed to the strongest under-budget pieces.`;
          output = {
            ...output,
            narration: { ...output.narration, thin_note: thinNote },
          };
          issues.push({
            code: "set_budget_trimmed",
            message: `Trimmed capsule to ${setTotal} (ceiling ${budgetCeiling})`,
          });
        } else {
          const priceLines = output.slots
            .flatMap((s) =>
              s.picks.map((p) => {
                const entry = params.registry.get(p.ref);
                const price = entry ? hydratedPriceMajor(entry) : 0;
                return `${p.ref}: $${price}`;
              }),
            )
            .join(", ");
          issues.push({
            code: "set_over_budget",
            message: `Set totals $${setTotal} against $${assembly.total_max} (${priceLines})`,
          });
        }
      }
    }

    if (output.looks?.length) {
      output = {
        ...output,
        looks: output.looks.map((l) => ({
          ...l,
          total: recomputeLookTotal(l, params.registry),
        })),
      };
    }
  } else if (assembly && output.looks?.length) {
    const salvaged = salvageOverBudgetLooks({
      looks: output.looks,
      registry: params.registry,
      ceiling: budgetCeiling!,
      narration: output.narration,
    });
    output = {
      ...output,
      looks: salvaged.looks,
      narration: salvaged.narration,
    };
    issues.push(...salvaged.issues);
  } else if (output.looks?.length) {
    output = {
      ...output,
      looks: output.looks.map((l) => ({
        ...l,
        total: recomputeLookTotal(l, params.registry),
      })),
    };
  }

  if (params.plan.mode === "outfit" && output.looks?.length) {
    if (output.looks.length > CURATION_LOOKS_TARGET) {
      output = {
        ...output,
        looks: output.looks.slice(0, CURATION_LOOKS_TARGET),
      };
      issues.push({
        code: "looks_trimmed",
        message: `Trimmed looks to ${CURATION_LOOKS_TARGET}`,
      });
    } else if (output.looks.length < CURATION_LOOKS_TARGET) {
      issues.push({
        code: "looks_short",
        message: `Only ${output.looks.length}/${CURATION_LOOKS_TARGET} looks`,
      });
    }
  }

  if (params.plan.mode === "capsule") {
    const outfits = output.capsule_outfits ?? [];
    if (outfits.length > CURATION_LOOKS_TARGET) {
      output = {
        ...output,
        capsule_outfits: outfits.slice(0, CURATION_LOOKS_TARGET),
      };
    } else if (outfits.length > 0 && outfits.length < CURATION_LOOKS_TARGET) {
      issues.push({
        code: "capsule_outfits_short",
        message: `Only ${outfits.length}/${CURATION_LOOKS_TARGET} capsule outfits`,
      });
    }
  }

  if (params.plan.mode === "capsule") {
    const outfits = output.capsule_outfits ?? [];
    const tops = params.plan.slots.filter((s) =>
      /\b(shirt|blouse|top|sweater|tee)\b/i.test(s.garment),
    );
    const bottoms = params.plan.slots.filter((s) =>
      /\b(trousers|trouser|pants|pant|jeans|jean|skirts|skirt|bottoms|bottom)\b/i.test(
        s.garment,
      ),
    );

    if (tops.length && bottoms.length) {
      for (const top of tops) {
        const topRefs = refsForSlot(params.registry, top.slot_id).map(
          (e) => e.ref,
        );
        const pickedTopRefs = output.slots
          .find((s) => s.slot_id === top.slot_id)
          ?.picks.map((p) => p.ref) ?? topRefs.slice(0, 1);

        for (const bottom of bottoms) {
          const bottomRefs = refsForSlot(params.registry, bottom.slot_id).map(
            (e) => e.ref,
          );
          const hasPair = outfits.some(
            (o) =>
              o.item_refs.some((r) => pickedTopRefs.includes(r)) &&
              o.item_refs.some((r) => bottomRefs.includes(r)),
          );
          if (!hasPair) {
            issues.push({
              code: "capsule_orphan",
              message: `Missing outfit pairing for ${top.slot_id} × ${bottom.slot_id}`,
            });
          }
        }
      }
    }
  }

  for (const slot of params.slots) {
    const poolSize = refsForSlot(params.registry, slot.slot_id).length;
    const slotVetoes = output.vetoes.filter((v) => {
      const entry = params.registry.get(v.ref);
      return entry?.slot_id === slot.slot_id;
    });
    if (
      poolSize > 0 &&
      slotVetoes.length / poolSize > CURATION_VETO_TRIPWIRE_RATIO
    ) {
      issues.push({
        code: "veto_rate_excessive",
        message: `Veto rate ${slotVetoes.length}/${poolSize} on ${slot.slot_id}`,
        slot_id: slot.slot_id,
      });
    }
  }

  // Clear missing_budget_note if we injected one during look salvage.
  if (output.narration.budget_note?.trim()) {
    for (let i = issues.length - 1; i >= 0; i -= 1) {
      if (issues[i]?.code === "missing_budget_note") issues.splice(i, 1);
    }
  }

  const hardFailures = issues.filter((i) =>
    [
      "missing_brand_note",
      "missing_budget_note",
      "missing_thin_note",
      "degraded_success_opening",
      "set_over_budget",
      "capsule_orphan",
      // empty slots are soft (coverage / honest fewer slots) — never junk-fill.
    ].includes(i.code),
  );

  if (hardFailures.length) {
    return { ok: false, output, issues };
  }

  // Ship fewer slots — empty picks never render (coverage gaps / curator omit).
  output = {
    ...output,
    slots: output.slots.filter((s) => s.picks.length > 0),
  };

  return { ok: true, output, issues };
}

export function nearIdenticalPickWarning(
  picks: Array<{ ref: string }>,
  registry: CurationRefRegistry,
): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      const a = registry.get(picks[i]!.ref);
      const b = registry.get(picks[j]!.ref);
      if (!a || !b) continue;
      const brandA = a.candidate.shop_domain ?? "";
      const brandB = b.candidate.shop_domain ?? "";
      const colorsA = a.candidate.normalized?.colors?.buckets ?? [];
      const colorsB = b.candidate.normalized?.colors?.buckets ?? [];
      const priceA =
        (a.candidate.final_price ?? a.candidate.price)?.amount ?? 0;
      const priceB =
        (b.candidate.final_price ?? b.candidate.price)?.amount ?? 0;
      const sameBrand = brandA && brandA === brandB;
      const sameColors =
        colorsA.length &&
        colorsB.length &&
        colorsA.join() === colorsB.join();
      const closePrice =
        priceA > 0 &&
        priceB > 0 &&
        Math.abs(priceA - priceB) / Math.max(priceA, priceB) <= 0.1;
      if (sameBrand && sameColors && closePrice) {
        warnings.push({
          code: "near_identical_picks",
          message: `${picks[i]!.ref} and ${picks[j]!.ref} are near-identical`,
          slot_id: a.slot_id,
        });
      }
    }
  }
  return warnings;
}
