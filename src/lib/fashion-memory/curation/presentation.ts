import { hydratedCandidateToProductCard } from "../catalog-search/product-card";
import type { FashionSearchPlan } from "../search-planner/types";
import type { BudgetTension } from "../budget/budgetTension";
import type { BudgetInterpretation } from "../budget/budgetAllocation";
import type {
  CurationRefRegistry,
  DeliverCurationInput,
  FashionCurationPresentation,
  FashionCuratedPick,
  FashionCuratedPickBadge,
  FashionVerifiedTierItem,
  FashionUnverifiedTierItem,
} from "./types";
import { CURATION_UNVERIFIED_OVERFLOW } from "./config";

function buildBadges(
  entry: import("./types").RefEntry,
  correctedColor?: string,
): FashionCuratedPickBadge[] {
  const badges: FashionCuratedPickBadge[] = [];
  const c = entry.candidate;

  if (c.size_status === "converted" && c.size_selection) {
    badges.push({
      kind: "converted_size",
      from: c.size_selection.converted_from ?? "?",
      label: c.size_selection.merchant_label,
    });
  } else if (c.size_status === "unknown") {
    badges.push({ kind: "check_sizing" });
  }

  for (const s of c.suspicions ?? []) {
    badges.push({
      kind: "suspicion",
      rule: s.rule,
      evidence: s.evidence,
    });
  }

  if (correctedColor) {
    const listed = c.normalized?.colors?.buckets?.[0];
    badges.push({
      kind: "photo_color",
      color: correctedColor,
      listed,
    });
  }

  if (c.brand_confirmed === false) {
    badges.push({ kind: "brand_unconfirmed" });
  }

  return badges;
}

export function buildPresentationContract(params: {
  output: DeliverCurationInput;
  registry: CurationRefRegistry;
  plan: FashionSearchPlan;
  slots: Array<{
    slot_id: string;
    garment: string;
    thin_slot?: boolean;
    brand_status?: import("../router/types").FashionSlotBrandStatus;
    overflow_items?: import("../hydration/types").OverflowItem[];
  }>;
  vetoedRefs: Set<string>;
  lookMembership: Map<string, string[]>;
  budget_tension?: BudgetTension;
  budget_interpretation?: BudgetInterpretation;
  fallback: boolean;
}): FashionCurationPresentation {
  const pickedRefs = new Set<string>();
  const picks: FashionCuratedPick[] = [];

  for (const slotOutput of params.output.slots) {
    const slotMeta = params.slots.find((s) => s.slot_id === slotOutput.slot_id);
    for (const pick of slotOutput.picks) {
      pickedRefs.add(pick.ref);
      const entry = params.registry.get(pick.ref);
      if (!entry) continue;

      const card = hydratedCandidateToProductCard(entry.candidate);
      picks.push({
        ...card,
        ref: pick.ref,
        slot_id: slotOutput.slot_id,
        garment: slotMeta?.garment ?? slotOutput.slot_id,
        role: pick.role,
        stylist_line: pick.stylist_line,
        badges: buildBadges(entry, pick.corrected_color),
        look_names: params.lookMembership.get(pick.ref),
        corrected_color: pick.corrected_color,
        score_rank: entry.score_rank,
        brand_confirmed: entry.candidate.brand_confirmed,
      });
    }
  }

  const verified: FashionVerifiedTierItem[] = [];
  for (const entry of params.registry.values()) {
    if (pickedRefs.has(entry.ref) || params.vetoedRefs.has(entry.ref)) continue;
    const slotMeta = params.slots.find((s) => s.slot_id === entry.slot_id);
    const card = hydratedCandidateToProductCard(entry.candidate);
    verified.push({
      ...card,
      ref: entry.ref,
      slot_id: entry.slot_id,
      garment: slotMeta?.garment ?? entry.slot_id,
      score_rank: entry.score_rank,
      brand_confirmed: entry.candidate.brand_confirmed,
      size_status: entry.candidate.size_status,
    });
  }

  const unverified: FashionUnverifiedTierItem[] = [];
  for (const slot of params.slots) {
    for (const item of (slot.overflow_items ?? []).slice(
      0,
      CURATION_UNVERIFIED_OVERFLOW,
    )) {
      unverified.push({
        ...item,
        slot_id: slot.slot_id,
        garment: slot.garment,
      });
    }
  }

  const brand_status: Record<string, import("../router/types").FashionSlotBrandStatus | undefined> =
    {};
  for (const slot of params.slots) {
    brand_status[slot.slot_id] = slot.brand_status;
  }

  return {
    narration: params.output.narration,
    tiers: { picks, verified, unverified },
    looks: params.output.looks,
    capsule_outfits: params.output.capsule_outfits,
    meta: {
      mode: params.plan.mode,
      thin_slots: params.slots.filter((s) => s.thin_slot).map((s) => s.slot_id),
      brand_status,
      budget_tension: params.budget_tension?.severity,
      budget_interpretation: params.budget_interpretation,
      fallback: params.fallback,
    },
  };
}
