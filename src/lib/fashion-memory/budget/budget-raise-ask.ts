import { BUDGET_ASSEMBLY_TOLERANCE } from "./budgetAllocation";
import type { BudgetTension } from "./budgetTension";
import type { FashionSearchPlan } from "../search-planner/types";
import type { FashionClarificationQuestion } from "../router/types";

/** Chip that declines the raise and continues curation under the stated ceiling. */
export const BUDGET_RAISE_CONTINUE_OPTION =
  "Show closest at my current budget";

export type BudgetRaiseAskSlot = {
  slot_id: string;
  garment?: string;
  market_prices?: { min_viable: number } | null;
  /** Post-hydrate verified count. 0 on a required slot is the only abort. */
  verified_count?: number;
};

export type BudgetRaiseAsk = {
  stated_max: number;
  min_viable_total: number;
  currency: string;
  garments: string[];
  reply: string;
  questions: FashionClarificationQuestion[];
  reason: "infeasible_tension" | "set_below_min_viable";
};

export function estimateMinViableSetTotal(
  slots: BudgetRaiseAskSlot[],
): number | null {
  let total = 0;
  let counted = 0;
  for (const slot of slots) {
    const min = slot.market_prices?.min_viable;
    if (min == null || !Number.isFinite(min) || min <= 0) continue;
    total += min;
    counted += 1;
  }
  if (counted === 0) return null;
  return Math.round(total * 100) / 100;
}

function niceBudgetCeil(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 100;
  if (amount < 100) return Math.ceil(amount / 10) * 10;
  if (amount < 500) return Math.ceil(amount / 25) * 25;
  if (amount < 1000) return Math.ceil(amount / 50) * 50;
  return Math.ceil(amount / 100) * 100;
}

function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount);
  if (currency.toUpperCase() === "USD") return `$${rounded}`;
  return `${rounded} ${currency}`;
}

/**
 * Round suggested raise targets above the min-viable set total.
 * Always distinct from / above statedMax.
 */
export function suggestRaisedBudgets(params: {
  statedMax: number;
  minViableTotal: number;
}): number[] {
  const floor = Math.max(params.minViableTotal, params.statedMax * 1.05);
  const candidates = [
    niceBudgetCeil(floor * 1.1),
    niceBudgetCeil(floor * 1.35),
    niceBudgetCeil(floor * 1.6),
  ];
  const uniq: number[] = [];
  for (const n of candidates) {
    if (n <= params.statedMax) continue;
    if (uniq.some((u) => Math.abs(u - n) < 1)) continue;
    uniq.push(n);
  }
  if (uniq.length === 0) {
    uniq.push(niceBudgetCeil(params.statedMax * 1.5));
  }
  return uniq.slice(0, 3);
}

export const LOOSEN_BUDGET_CHIP = "Loosen the budget";

function slotVerifiedCount(slot: BudgetRaiseAskSlot): number {
  return slot.verified_count ?? 0;
}

function emptyRequiredSlots(
  plan: FashionSearchPlan,
  slots: BudgetRaiseAskSlot[],
): BudgetRaiseAskSlot[] {
  const byId = new Map(slots.map((s) => [s.slot_id, s]));
  const empty: BudgetRaiseAskSlot[] = [];
  for (const planSlot of plan.slots) {
    const row = byId.get(planSlot.slot_id);
    if (slotVerifiedCount(row ?? { slot_id: planSlot.slot_id }) === 0) {
      empty.push(row ?? { slot_id: planSlot.slot_id, garment: planSlot.garment });
    }
  }
  return empty;
}

/**
 * Abort into a raise-ask only when a required slot has zero verified
 * items. Tight/infeasible tension with a non-empty verified set proceeds
 * (budget_note + Loosen chip) — never blocks the rack.
 */
export function shouldAskBudgetRaise(params: {
  plan: FashionSearchPlan;
  tension?: BudgetTension | null;
  slots: BudgetRaiseAskSlot[];
  /** When true (budget gap declined / continue-anyway), never ask. */
  skip?: boolean;
}): boolean {
  if (params.skip) return false;

  const assembly = params.plan.budget_allocation?.budget_assembly;
  if (!assembly || !(assembly.total_max > 0)) return false;

  const empty = emptyRequiredSlots(params.plan, params.slots);
  if (empty.length === 0) return false;

  if (params.tension?.severity === "infeasible") return true;

  const mode = params.plan.mode;
  if (mode !== "outfit" && mode !== "capsule") return false;

  const minViable = estimateMinViableSetTotal(params.slots);
  if (minViable == null) return false;

  const ceiling =
    assembly.total_max * (1 + (assembly.tolerance ?? BUDGET_ASSEMBLY_TOLERANCE));
  return minViable > ceiling;
}

export function budgetProceedNote(statedMax: number, currency: string): string {
  return `Staying at ${formatMoney(statedMax, currency)} — closest real options.`;
}

export function ensureLoosenBudgetChip(offer: {
  text: string;
  chips: string[];
}): { text: string; chips: string[] } {
  const chips = [...offer.chips];
  if (
    chips.some(
      (c) => c.trim().toLowerCase() === LOOSEN_BUDGET_CHIP.toLowerCase(),
    )
  ) {
    return { text: offer.text, chips };
  }
  const replaceAt = chips.findIndex((c) =>
    /lower budget|tighter budget/i.test(c),
  );
  if (replaceAt >= 0) chips[replaceAt] = LOOSEN_BUDGET_CHIP;
  else if (chips.length >= 4) chips[chips.length - 1] = LOOSEN_BUDGET_CHIP;
  else chips.push(LOOSEN_BUDGET_CHIP);
  return { text: offer.text, chips };
}

export function buildBudgetRaiseClarification(params: {
  statedMax: number;
  minViableTotal: number;
  currency: string;
  garments: string[];
  reason: BudgetRaiseAsk["reason"];
}): Omit<BudgetRaiseAsk, "reason"> & { reason: BudgetRaiseAsk["reason"] } {
  const currency = params.currency || "USD";
  const garmentLabel =
    params.garments.filter(Boolean).join(", ") || "this outfit";
  const stated = formatMoney(params.statedMax, currency);
  const viable = formatMoney(params.minViableTotal, currency);
  const raised = suggestRaisedBudgets({
    statedMax: params.statedMax,
    minViableTotal: params.minViableTotal,
  });

  const reply =
    params.reason === "infeasible_tension"
      ? `A full ${garmentLabel} set at ${stated} isn't realistic against what's actually available — the market floor is about ${viable}. Want to raise the budget, or see the closest options at ${stated}?`
      : `A full ${garmentLabel} set honestly needs about ${viable}; ${stated} won't cover every piece. Want to raise the budget, or see the closest options at ${stated}?`;

  const quick_options = [
    ...raised.map((n) => formatMoney(n, currency)),
    BUDGET_RAISE_CONTINUE_OPTION,
  ];

  const questions: FashionClarificationQuestion[] = [
    {
      text: "What's the max you can spend on this set?",
      gap: "budget",
      field: "budget_max",
      quick_options,
    },
  ];

  return {
    stated_max: params.statedMax,
    min_viable_total: params.minViableTotal,
    currency,
    garments: params.garments,
    reply,
    questions,
    reason: params.reason,
  };
}

export function buildBudgetRaiseAskFromContext(params: {
  plan: FashionSearchPlan;
  tension?: BudgetTension | null;
  slots: BudgetRaiseAskSlot[];
}): BudgetRaiseAsk | null {
  if (
    !shouldAskBudgetRaise({
      plan: params.plan,
      tension: params.tension,
      slots: params.slots,
    })
  ) {
    return null;
  }

  const assembly = params.plan.budget_allocation!.budget_assembly!;
  const minViable =
    estimateMinViableSetTotal(params.slots) ?? assembly.total_max * 1.5;
  const reason: BudgetRaiseAsk["reason"] =
    params.tension?.severity === "infeasible"
      ? "infeasible_tension"
      : "set_below_min_viable";

  return buildBudgetRaiseClarification({
    statedMax: assembly.total_max,
    minViableTotal: minViable,
    currency: assembly.currency || "USD",
    garments: params.plan.slots.map((s) => s.garment),
    reason,
  });
}

/** Parse a chip / free-text budget answer into a max amount, or continue-anyway. */
export function parseBudgetRaiseAnswer(
  raw: string,
):
  | { kind: "raise"; max: number }
  | { kind: "continue" }
  | { kind: "unknown" } {
  const text = raw.trim();
  if (!text) return { kind: "unknown" };
  if (
    text === BUDGET_RAISE_CONTINUE_OPTION ||
    /show closest|current budget|keep (my )?budget|anyway/i.test(text)
  ) {
    return { kind: "continue" };
  }
  const match = text.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (!match) return { kind: "unknown" };
  const max = Number(match[1]);
  if (!Number.isFinite(max) || max <= 0) return { kind: "unknown" };
  return { kind: "raise", max };
}
