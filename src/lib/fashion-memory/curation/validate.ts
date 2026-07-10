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

/**
 * FIX 5: Opus under-delivery left empty slots despite populated pools
 * (trace fa62b58e — all 5 slots hydrated to 11 verified; empty_slot_picks
 * was curator omission, not retrieval starvation). Fill from registry
 * excluding vetoed refs before hard-failing.
 */
export function fillEmptySlotPicks(params: {
  output: DeliverCurationInput;
  registry: CurationRefRegistry;
  plan: FashionSearchPlan;
}): { output: DeliverCurationInput; filledSlots: string[] } {
  const vetoed = new Set(params.output.vetoes.map((v) => v.ref));
  const filledSlots: string[] = [];
  const slots = params.output.slots.map((slotOutput) => {
    if (slotOutput.picks.length > 0) return slotOutput;
    const planSlot = params.plan.slots.find((s) => s.slot_id === slotOutput.slot_id);
    if (!planSlot) return slotOutput;
    const available = refsForSlot(params.registry, slotOutput.slot_id).filter(
      (e) => !vetoed.has(e.ref),
    );
    if (!available.length) return slotOutput;
    const count = Math.min(planSlot.options_wanted, available.length);
    const picks: DeliverCurationPick[] = available.slice(0, count).map((entry, idx) => ({
      ref: entry.ref,
      role:
        planSlot.role === "anchor" && idx === 0
          ? ("anchor" as const)
          : planSlot.role === "support"
            ? ("support" as const)
            : ("safe" as const),
      stylist_line: `Verified ${planSlot.garment} option that fits the brief.`,
    }));
    filledSlots.push(slotOutput.slot_id);
    return { ...slotOutput, picks };
  });

  // Also ensure every plan slot appears (Opus sometimes omits slots entirely).
  const present = new Set(slots.map((s) => s.slot_id));
  for (const planSlot of params.plan.slots) {
    if (present.has(planSlot.slot_id)) continue;
    const available = refsForSlot(params.registry, planSlot.slot_id).filter(
      (e) => !vetoed.has(e.ref),
    );
    if (!available.length) {
      slots.push({ slot_id: planSlot.slot_id, picks: [] });
      continue;
    }
    const count = Math.min(planSlot.options_wanted, available.length);
    slots.push({
      slot_id: planSlot.slot_id,
      picks: available.slice(0, count).map((entry, idx) => ({
        ref: entry.ref,
        role:
          planSlot.role === "anchor" && idx === 0
            ? ("anchor" as const)
            : ("safe" as const),
        stylist_line: `Verified ${planSlot.garment} option that fits the brief.`,
      })),
    });
    filledSlots.push(planSlot.slot_id);
  }

  return { output: { ...params.output, slots }, filledSlots };
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
    params.budget_interpretation === "per_item_assumed"
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
    thin_slot?: boolean;
    curator_exclusions?: string[];
    brand_status?: FashionSlotBrandStatus;
  }>;
  excludedRefs?: string[];
  budget_assembly?: BudgetAssembly;
  budget_tension?: { severity: string };
  budget_interpretation?: string;
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

    const maxPicks = planSlot.options_wanted;
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
      // Under-fill is only a real problem when the curator did NOT justify it
      // with vetoes. If it vetoed candidates in this slot, fewer picks is honest
      // curation of a junk pool — never discard it for the deterministic fallback.
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

  // FIX 5: fill empty slots from pool before treating as hard failure.
  const filled = fillEmptySlotPicks({
    output,
    registry: params.registry,
    plan: params.plan,
  });
  output = filled.output;
  for (const slotId of filled.filledSlots) {
    issues.push({
      code: "empty_slot_picks_filled",
      message: `Filled empty slot ${slotId} from verified pool`,
      slot_id: slotId,
    });
  }

  for (const slotOutput of output.slots) {
    const poolSize = refsForSlot(params.registry, slotOutput.slot_id).length;
    const vetoed = new Set(output.vetoes.map((v) => v.ref));
    const available = refsForSlot(params.registry, slotOutput.slot_id).filter(
      (e) => !vetoed.has(e.ref),
    ).length;
    if (slotOutput.picks.length === 0 && available > 0) {
      issues.push({
        code: "empty_slot_picks",
        message: `Slot ${slotOutput.slot_id} has verified candidates but zero picks`,
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

  if (params.budget_assembly && output.looks?.length) {
    const ceiling =
      params.budget_assembly.total_max *
      (1 + params.budget_assembly.tolerance);
    const keptLooks = [];
    for (const look of output.looks) {
      const computed = recomputeLookTotal(look, params.registry);
      if (computed > ceiling) {
        issues.push({
          code: "look_over_budget",
          message: `Look "${look.name}" computed ${computed} > ${ceiling}`,
        });
      } else {
        keptLooks.push({ ...look, total: computed });
      }
    }
    output = { ...output, looks: keptLooks };
    if (keptLooks.length === 0 && params.output.looks?.length) {
      issues.push({
        code: "all_looks_over_budget",
        message: "All looks exceeded budget ceiling",
      });
    }
  } else if (output.looks?.length) {
    output = {
      ...output,
      looks: output.looks.map((l) => ({
        ...l,
        total: recomputeLookTotal(l, params.registry),
      })),
    };
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

  const hardFailures = issues.filter((i) =>
    [
      "missing_brand_note",
      "missing_budget_note",
      "missing_thin_note",
      "degraded_success_opening",
      "empty_slot_picks",
      "all_looks_over_budget",
      "capsule_orphan",
      "underfilled_slot",
    ].includes(i.code),
  );

  if (hardFailures.length) {
    return { ok: false, output, issues };
  }

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
