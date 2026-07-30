import { hydratedCandidateToProductCard } from "../catalog-search/product-card";
import type { FashionSearchPlan } from "../search-planner/types";
import type { BudgetTension } from "../budget/budgetTension";
import type { BudgetInterpretation } from "../budget/budgetAllocation";
import { fromMinorUnits } from "@/lib/money";
import type {
  CurationRefRegistry,
  DeliverCurationInput,
  FashionCurationPresentation,
  FashionCuratedPick,
  FashionCuratedPickBadge,
  FashionVerifiedTierItem,
  FashionUnverifiedTierItem,
} from "./types";
import {
  CURATION_UNVERIFIED_OVERFLOW,
  CURATION_VERIFIED_BENCH,
} from "./config";
import { buildUserFacingBadges } from "./badge-copy";

function buildBadges(
  entry: import("./types").RefEntry,
  garment: string,
  correctedColor?: string,
): FashionCuratedPickBadge[] {
  const nearBudgetLifted = Boolean(
    (entry.candidate as { near_budget_lifted?: boolean }).near_budget_lifted ||
      entry.candidate.suspicions?.some((s) =>
        /near.?budget|budget.?lift/i.test(s.rule),
      ),
  );
  return buildUserFacingBadges({
    candidate: entry.candidate,
    garment,
    correctedColor,
    nearBudgetLifted,
  });
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
  /** Stage B used deterministic stylist templates. */
  voice_fallback?: boolean;
}): FashionCurationPresentation {
  const pickedRefs = new Set<string>();
  const picks: FashionCuratedPick[] = [];

  for (const slotOutput of params.output.slots) {
    const slotMeta = params.slots.find((s) => s.slot_id === slotOutput.slot_id);
    for (const pick of slotOutput.picks) {
      pickedRefs.add(pick.ref);
      const entry = params.registry.get(pick.ref);
      if (!entry) continue;

      const card = hydratedCandidateToProductCard(entry.candidate, {
        correctedColor: pick.corrected_color,
      });
      const garment = slotMeta?.garment ?? slotOutput.slot_id;
      picks.push({
        ...card,
        ref: pick.ref,
        slot_id: slotOutput.slot_id,
        garment,
        role: pick.role,
        stylist_line: pick.stylist_line,
        badges: buildBadges(entry, garment, pick.corrected_color),
        look_names: params.lookMembership.get(pick.ref),
        corrected_color: pick.corrected_color,
        score_rank: entry.score_rank,
        brand_confirmed: entry.candidate.brand_confirmed,
      });
    }
  }

  // Looks/capsule rotations may reference registry items that weren't hero picks
  // (e.g. tie_1 in a look). Promote those so chat + try-on show real product
  // metadata instead of the raw ref.
  const lookOnlyRefs = new Set<string>();
  for (const look of params.output.looks ?? []) {
    for (const ref of look.item_refs) lookOnlyRefs.add(ref);
  }
  for (const outfit of params.output.capsule_outfits ?? []) {
    for (const ref of outfit.item_refs) lookOnlyRefs.add(ref);
  }
  for (const ref of lookOnlyRefs) {
    if (pickedRefs.has(ref) || params.vetoedRefs.has(ref)) continue;
    const entry = params.registry.get(ref);
    if (!entry) continue;
    const slotMeta = params.slots.find((s) => s.slot_id === entry.slot_id);
    const card = hydratedCandidateToProductCard(entry.candidate);
    const garment = slotMeta?.garment ?? entry.slot_id;
    pickedRefs.add(ref);
    picks.push({
      ...card,
      ref,
      slot_id: entry.slot_id,
      garment,
      role: "support",
      stylist_line: `Paired into the look as the ${garment}.`,
      badges: buildBadges(entry, garment),
      look_names: params.lookMembership.get(ref),
      score_rank: entry.score_rank,
      brand_confirmed: entry.candidate.brand_confirmed,
    });
  }

  // Per-garment verified bench (ranked, excluding heroes / vetoes), capped.
  const verifiedBySlot = new Map<string, FashionVerifiedTierItem[]>();
  for (const entry of params.registry.values()) {
    if (pickedRefs.has(entry.ref) || params.vetoedRefs.has(entry.ref)) continue;
    const slotMeta = params.slots.find((s) => s.slot_id === entry.slot_id);
    const card = hydratedCandidateToProductCard(entry.candidate);
    const list = verifiedBySlot.get(entry.slot_id) ?? [];
    list.push({
      ...card,
      ref: entry.ref,
      slot_id: entry.slot_id,
      garment: slotMeta?.garment ?? entry.slot_id,
      score_rank: entry.score_rank,
      brand_confirmed: entry.candidate.brand_confirmed,
      size_status: entry.candidate.size_status,
    });
    verifiedBySlot.set(entry.slot_id, list);
  }
  const verified: FashionVerifiedTierItem[] = [];
  for (const slot of params.slots) {
    const ranked = (verifiedBySlot.get(slot.slot_id) ?? []).sort(
      (a, b) => a.score_rank - b.score_rank,
    );
    verified.push(...ranked.slice(0, CURATION_VERIFIED_BENCH));
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

  let set_total: number | undefined;
  if (params.plan.mode === "capsule") {
    let total = 0;
    for (const slotOutput of params.output.slots) {
      for (const pick of slotOutput.picks) {
        const entry = params.registry.get(pick.ref);
        if (!entry) continue;
        const price = entry.candidate.final_price ?? entry.candidate.price;
        total += fromMinorUnits(price?.amount ?? 0);
      }
    }
    set_total = Math.round(total * 100) / 100;
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
      ...(set_total != null ? { set_total } : {}),
      fallback: params.fallback,
      ...(params.voice_fallback ? { voice_fallback: true } : {}),
    },
  };
}
