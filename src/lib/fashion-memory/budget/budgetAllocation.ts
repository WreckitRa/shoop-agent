import { toMinorUnits } from "@/lib/money";
import type { FashionSearchBrief } from "../router/types";
import type {
  FashionSearchPlan,
  FashionSearchPlanSlot,
  SearchPlanMode,
} from "../search-planner/types";

/** ±20% padding for single_item / multi_item per-item ceiling. */
export const LEGACY_BUDGET_PAD_MAX = 1.2;
export const LEGACY_BUDGET_PAD_MIN = 0.8;

/** Allocation padding for outfit per-slot retrieval bounds. */
export const ALLOCATION_PAD_MAX = 1.4;
export const ALLOCATION_PAD_MIN = 0.6;

/** Capsule per-piece padding — intra-set price variance is normal. */
export const CAPSULE_PIECE_PAD = 1.5;

/**
 * Server-side price filter multiplier on top of padded_max.
 * Priced lanes (A/C) send guard_max = padded_max × this; client hard-drop
 * still enforces padded_max. Tunable from junk-share telemetry on /health.
 */
export const RELEVANCE_GUARD_MULTIPLIER = 2.0;

export const BUDGET_ASSEMBLY_TOLERANCE = 0.1;

const FRACTION_FLOOR = 0.1;
const FRACTION_CEILING = 0.8;
const FRACTION_SUM_MIN = 0.9;
const FRACTION_SUM_MAX = 1.1;

export type FractionSource = "planner" | "clamped" | "fallback";
export type BudgetValidation = "accepted" | "clamped" | "fallback";
export type BudgetInterpretation =
  | "per_item_stated"
  | "per_item_assumed"
  | "set_total_assumed"
  | "total_stated";

export type BudgetConstraintType = "per_look" | "set_total";

export type SlotBudgetAllocation = {
  fraction: number;
  fraction_source: FractionSource;
  allocated_max: number;
  padded_max: number;
  allocated_min?: number;
  padded_min?: number;
  /** Capsule: slot share of total budget (before per-piece division). */
  set_allocation?: number;
  /** Capsule: per-piece enforcement ceiling (major units). */
  per_item_enforced?: number;
  /** Capsule: per-piece relevance guard (major units). */
  per_item_guard?: number;
  /** Capsule: piece count for this slot (options_wanted). */
  pieces?: number;
};

export type BudgetAssembly = {
  total_max: number;
  currency: string;
  tolerance: typeof BUDGET_ASSEMBLY_TOLERANCE;
  constraint_type: BudgetConstraintType;
  per_slot_allocated: Record<string, SlotBudgetAllocation>;
};

export type ResolvedBudgetAllocation = {
  bounds: Map<string, { min?: number; max?: number }>;
  per_slot: Record<string, SlotBudgetAllocation>;
  validation: BudgetValidation;
  budget_interpretation?: BudgetInterpretation;
  budget_assembly?: BudgetAssembly;
};

type OccasionKey = "office" | "wedding" | "casual";

const OUTERWEAR_RE =
  /\b(coat|overcoat|parka|puffer|jacket|blazer|outerwear|trench)\b/i;
const DRESS_RE = /\b(dress|gown)\b/i;
const SHOE_RE = /\b(shoe|sneaker|boot|loafer|heel|footwear)\b/i;
const ACCESSORY_RE =
  /\b(belt|tie|scarf|hat|bag|accessory|accessories|jewelry|watch)\b/i;

function occasionKey(occasion: string): OccasionKey {
  const o = occasion.toLowerCase();
  if (/\b(office|work|business|consultant|formal.?wear)\b/.test(o)) {
    return "office";
  }
  if (/\b(wedding|black.?tie|formal.?event|gala)\b/.test(o)) {
    return "wedding";
  }
  if (/\b(casual|weekend|everyday|street)\b/.test(o)) {
    return "casual";
  }
  return "casual";
}

function slotWeight(slot: FashionSearchPlanSlot): number {
  if (slot.role === "anchor") return 3;
  if (OUTERWEAR_RE.test(slot.garment)) return 4;
  if (DRESS_RE.test(slot.garment)) return 4;
  if (SHOE_RE.test(slot.garment)) return 1.5;
  if (ACCESSORY_RE.test(slot.garment)) return 0.8;
  return 2;
}

/** Static fallback table — safety net when planner fractions are missing. */
function fallbackFractions(
  slots: FashionSearchPlanSlot[],
  occasion: string,
): Record<string, number> {
  const key = occasionKey(occasion);
  const n = slots.length;
  const equal = 1 / n;

  if (n === 1) {
    return { [slots[0]!.slot_id]: 1 };
  }

  if (n === 2) {
    const dominant =
      slots.find((s) => s.role === "anchor") ??
      slots.find((s) => OUTERWEAR_RE.test(s.garment) || DRESS_RE.test(s.garment)) ??
      slots[0]!;
    const other = slots.find((s) => s.slot_id !== dominant.slot_id)!;
    if (key === "office") {
      return { [dominant.slot_id]: 0.55, [other.slot_id]: 0.45 };
    }
    if (key === "wedding") {
      return { [dominant.slot_id]: 0.6, [other.slot_id]: 0.4 };
    }
    return { [dominant.slot_id]: 0.55, [other.slot_id]: 0.45 };
  }

  if (n === 3) {
    const anchor =
      slots.find((s) => s.role === "anchor") ??
      slots.find((s) => OUTERWEAR_RE.test(s.garment) || DRESS_RE.test(s.garment)) ??
      slots[0]!;
    const shoes = slots.find((s) => SHOE_RE.test(s.garment));
    const others = slots.filter(
      (s) => s.slot_id !== anchor.slot_id && s.slot_id !== shoes?.slot_id,
    );

    if (key === "office") {
      const shirt = others.find((s) => /\b(shirt|blouse|top)\b/i.test(s.garment));
      const trousers = others.find((s) =>
        /\b(trouser|pant|slack|chino)\b/i.test(s.garment),
      );
      const mid = shirt ?? others[0];
      const bottom = trousers ?? others.find((s) => s.slot_id !== mid?.slot_id);
      const result: Record<string, number> = {
        [anchor.slot_id]: 0.35,
      };
      if (mid) result[mid.slot_id] = 0.35;
      if (bottom && bottom.slot_id !== mid?.slot_id) {
        result[bottom.slot_id] = shoes ? 0.2 : 0.3;
      }
      if (shoes) result[shoes.slot_id] = 0.1;
      return normalizeFractionRecord(result, slots);
    }

    if (key === "wedding") {
      const result: Record<string, number> = { [anchor.slot_id]: 0.5 };
      for (const s of others) {
        result[s.slot_id] = shoes && s.slot_id === shoes.slot_id ? 0.15 : 0.175;
      }
      if (shoes && !(shoes.slot_id in result)) result[shoes.slot_id] = 0.15;
      return normalizeFractionRecord(result, slots);
    }

    const result: Record<string, number> = { [anchor.slot_id]: 0.4 };
    for (const s of others) {
      result[s.slot_id] =
        shoes && s.slot_id === shoes.slot_id ? 0.15 : 0.225;
    }
    if (shoes && !(shoes.slot_id in result)) result[shoes.slot_id] = 0.15;
    return normalizeFractionRecord(result, slots);
  }

  const weights = slots.map((s) => ({ slot_id: s.slot_id, w: slotWeight(s) }));
  const totalW = weights.reduce((n, w) => n + w.w, 0);
  const result: Record<string, number> = {};
  for (const { slot_id, w } of weights) {
    result[slot_id] = w / totalW;
  }
  return normalizeFractionRecord(result, slots);
}

function normalizeFractionRecord(
  raw: Record<string, number>,
  slots: FashionSearchPlanSlot[],
): Record<string, number> {
  const clamped = clampAndRenormalize(
    slots.map((s) => ({
      slot_id: s.slot_id,
      fraction: raw[s.slot_id] ?? equalSplit(slots.length),
    })),
  );
  const out: Record<string, number> = {};
  for (const { slot_id, fraction } of clamped) {
    out[slot_id] = fraction;
  }
  return out;
}

function equalSplit(n: number): number {
  return 1 / Math.max(1, n);
}

function clampAndRenormalize(
  entries: Array<{ slot_id: string; fraction: number }>,
): Array<{ slot_id: string; fraction: number }> {
  const clamped = entries.map((e) => ({
    slot_id: e.slot_id,
    fraction: Math.min(FRACTION_CEILING, Math.max(FRACTION_FLOOR, e.fraction)),
  }));
  const sum = clamped.reduce((n, e) => n + e.fraction, 0);
  if (sum <= 0) {
    const equal = 1 / clamped.length;
    return clamped.map((e) => ({ slot_id: e.slot_id, fraction: equal }));
  }
  return clamped.map((e) => ({
    slot_id: e.slot_id,
    fraction: e.fraction / sum,
  }));
}

type FractionValidation =
  | { ok: true; fractions: Array<{ slot_id: string; fraction: number }>; validation: "accepted" }
  | { ok: false; reason: "missing" | "out_of_bounds" };

function validatePlannerFractions(
  slots: FashionSearchPlanSlot[],
): FractionValidation {
  const missing = slots.some(
    (s) =>
      s.budget_fraction == null ||
      !Number.isFinite(s.budget_fraction) ||
      s.budget_fraction <= 0,
  );
  if (missing) return { ok: false, reason: "missing" };

  const raw = slots.map((s) => ({
    slot_id: s.slot_id,
    fraction: s.budget_fraction!,
  }));
  const sum = raw.reduce((n, e) => n + e.fraction, 0);
  const anyOutOfBounds = raw.some(
    (e) => e.fraction < FRACTION_FLOOR || e.fraction > FRACTION_CEILING,
  );
  const sumOutOfBounds = sum < FRACTION_SUM_MIN || sum > FRACTION_SUM_MAX;

  if (!anyOutOfBounds && !sumOutOfBounds) {
    const normalized = clampAndRenormalize(raw);
    const renormalized =
      Math.abs(normalized.reduce((n, e) => n + e.fraction, 0) - 1) > 0.001;
    return {
      ok: true,
      fractions: normalized,
      validation: renormalized ? "accepted" : "accepted",
    };
  }

  if (anyOutOfBounds || sumOutOfBounds) {
    return { ok: false, reason: "out_of_bounds" };
  }

  return { ok: false, reason: "missing" };
}

function resolveFractions(
  slots: FashionSearchPlanSlot[],
  occasion: string,
): {
  fractions: Array<{ slot_id: string; fraction: number }>;
  validation: BudgetValidation;
  fraction_source: FractionSource;
} {
  const first = validatePlannerFractions(slots);
  if (first.ok) {
    return {
      fractions: first.fractions,
      validation: "accepted",
      fraction_source: "planner",
    };
  }

  if (first.reason === "out_of_bounds") {
    const clamped = clampAndRenormalize(
      slots.map((s) => ({
        slot_id: s.slot_id,
        fraction: s.budget_fraction ?? equalSplit(slots.length),
      })),
    );
    return {
      fractions: clamped,
      validation: "clamped",
      fraction_source: "clamped",
    };
  }

  const table = fallbackFractions(slots, occasion);
  const fractions = slots.map((s) => ({
    slot_id: s.slot_id,
    fraction: table[s.slot_id] ?? equalSplit(slots.length),
  }));
  return {
    fractions,
    validation: "fallback",
    fraction_source: "fallback",
  };
}

function buildSlotAllocations(params: {
  fractions: Array<{ slot_id: string; fraction: number }>;
  fraction_source: FractionSource;
  total_max: number;
  total_min?: number;
  currency: string;
  mode: "outfit" | "capsule";
  slots: FashionSearchPlanSlot[];
}): {
  per_slot: Record<string, SlotBudgetAllocation>;
  bounds: Map<string, { min?: number; max?: number }>;
} {
  const per_slot: Record<string, SlotBudgetAllocation> = {};
  const bounds = new Map<string, { min?: number; max?: number }>();
  const slotById = new Map(params.slots.map((s) => [s.slot_id, s]));

  for (const { slot_id, fraction } of params.fractions) {
    const allocated_max = params.total_max * fraction;

    if (params.mode === "capsule") {
      const planSlot = slotById.get(slot_id);
      const pieces = Math.max(1, planSlot?.options_wanted ?? 1);
      const set_allocation = allocated_max;
      const per_item_enforced =
        (params.total_max * fraction * CAPSULE_PIECE_PAD) / pieces;
      const per_item_guard = per_item_enforced * RELEVANCE_GUARD_MULTIPLIER;
      const entry: SlotBudgetAllocation = {
        fraction,
        fraction_source: params.fraction_source,
        allocated_max,
        padded_max: per_item_enforced,
        set_allocation,
        per_item_enforced,
        per_item_guard,
        pieces,
      };

      if (params.total_min != null && params.total_min > 0) {
        entry.allocated_min = params.total_min * fraction;
        entry.padded_min = (entry.allocated_min * ALLOCATION_PAD_MIN) / pieces;
      }

      per_slot[slot_id] = entry;
      bounds.set(slot_id, {
        max: per_item_enforced,
        ...(entry.padded_min != null ? { min: entry.padded_min } : {}),
      });
      continue;
    }

    const padded_max = allocated_max * ALLOCATION_PAD_MAX;
    const entry: SlotBudgetAllocation = {
      fraction,
      fraction_source: params.fraction_source,
      allocated_max,
      padded_max,
    };

    if (params.total_min != null && params.total_min > 0) {
      entry.allocated_min = params.total_min * fraction;
      entry.padded_min = entry.allocated_min * ALLOCATION_PAD_MIN;
    }

    per_slot[slot_id] = entry;
    bounds.set(slot_id, {
      max: padded_max,
      ...(entry.padded_min != null ? { min: entry.padded_min } : {}),
    });
  }

  return { per_slot, bounds };
}

function currenciesCompatible(
  briefCurrency: string | undefined,
  profileCurrency: string,
): boolean {
  const brief = briefCurrency?.trim().toUpperCase();
  const profile = profileCurrency.trim().toUpperCase();
  if (!brief || !profile) return true;
  return brief === profile;
}

/**
 * Resolve per-slot budget bounds from planner fractions.
 * Returns null for unstated budget or single_item (callers keep legacy path).
 */
export function resolveAllocation(
  plan: FashionSearchPlan,
  profileCurrency: string,
): ResolvedBudgetAllocation | null {
  const ctx = plan.brief.budget_context;
  if (!ctx.stated) return null;

  if (!currenciesCompatible(ctx.currency, profileCurrency)) return null;

  const mode = plan.mode;

  if (mode === "single_item") return null;

  // Stated per-item bound applies in ANY mode — no fraction split.
  if (ctx.scope === "per_item") {
    const total_max = ctx.max;
    if (total_max == null || !Number.isFinite(total_max)) return null;

    const paddedMax = total_max * LEGACY_BUDGET_PAD_MAX;
    const paddedMin =
      ctx.min != null && ctx.min > 0
        ? ctx.min * LEGACY_BUDGET_PAD_MIN
        : undefined;

    const per_slot: Record<string, SlotBudgetAllocation> = {};
    const bounds = new Map<string, { min?: number; max?: number }>();

    for (const slot of plan.slots) {
      per_slot[slot.slot_id] = {
        fraction: 1,
        fraction_source: "planner",
        allocated_max: total_max,
        padded_max: paddedMax,
        ...(ctx.min != null && ctx.min > 0
          ? {
              allocated_min: ctx.min,
              padded_min: paddedMin,
            }
          : {}),
      };
      bounds.set(slot.slot_id, {
        max: paddedMax,
        ...(paddedMin != null ? { min: paddedMin } : {}),
      });
    }

    return {
      bounds,
      per_slot,
      validation: "accepted",
      budget_interpretation: "per_item_stated",
    };
  }

  if (mode === "multi_item") {
    const total_max = ctx.max;
    if (total_max == null || !Number.isFinite(total_max)) return null;

    const paddedMax = total_max * LEGACY_BUDGET_PAD_MAX;
    const paddedMin =
      ctx.min != null && ctx.min > 0
        ? ctx.min * LEGACY_BUDGET_PAD_MIN
        : undefined;

    const per_slot: Record<string, SlotBudgetAllocation> = {};
    const bounds = new Map<string, { min?: number; max?: number }>();

    for (const slot of plan.slots) {
      per_slot[slot.slot_id] = {
        fraction: 1,
        fraction_source: "planner",
        allocated_max: total_max,
        padded_max: paddedMax,
        ...(ctx.min != null && ctx.min > 0
          ? {
              allocated_min: ctx.min,
              padded_min: paddedMin,
            }
          : {}),
      };
      bounds.set(slot.slot_id, {
        max: paddedMax,
        ...(paddedMin != null ? { min: paddedMin } : {}),
      });
    }

    return {
      bounds,
      per_slot,
      validation: "accepted",
      budget_interpretation:
        ctx.scope === "total" ? "total_stated" : "per_item_assumed",
    };
  }

  if (mode !== "outfit" && mode !== "capsule") return null;

  const total_max = ctx.max;
  if (total_max == null || !Number.isFinite(total_max)) return null;

  const { fractions, validation, fraction_source } = resolveFractions(
    plan.slots,
    plan.brief.occasion_context,
  );

  const { per_slot, bounds } = buildSlotAllocations({
    fractions,
    fraction_source,
    total_max,
    total_min: ctx.min,
    currency: ctx.currency ?? profileCurrency,
    mode,
    slots: plan.slots,
  });

  const constraint_type: BudgetConstraintType =
    mode === "capsule" ? "set_total" : "per_look";

  // Stated scope:"total" → total_stated; otherwise assume set/look total coverage.
  const budget_interpretation: BudgetInterpretation =
    ctx.scope === "total" ? "total_stated" : "set_total_assumed";

  return {
    bounds,
    per_slot,
    validation,
    budget_interpretation,
    budget_assembly: {
      total_max,
      currency: ctx.currency ?? profileCurrency,
      tolerance: BUDGET_ASSEMBLY_TOLERANCE,
      constraint_type,
      per_slot_allocated: per_slot,
    },
  };
}

export type PriceBoundsPurpose = "server_filter" | "client_enforcement";

export type PriceBoundsParams = {
  brief: FashionSearchBrief;
  mode: SearchPlanMode;
  slotId: string;
  allocation?: ResolvedBudgetAllocation | null;
  profileCurrency: string;
  /** Override padded max in major units (budget-lift retry). */
  liftedMax?: number;
  /**
   * server_filter → guard_max (padded × RELEVANCE_GUARD_MULTIPLIER) for UCP.
   * client_enforcement → padded_max for hard-drops (default).
   */
  purpose?: PriceBoundsPurpose;
};

/** Resolve enforcement ceiling (major units) before any guard multiplier. */
export function enforcedMaxMajor(params: {
  brief: FashionSearchBrief;
  mode: SearchPlanMode;
  slotId: string;
  allocation?: ResolvedBudgetAllocation | null;
  liftedMax?: number;
}): number | null {
  const ctx = params.brief.budget_context;
  if (!ctx.stated) return null;

  const useAllocation = Boolean(
    params.allocation?.per_slot[params.slotId] &&
      (params.mode === "outfit" ||
        params.mode === "capsule" ||
        params.mode === "multi_item"),
  );

  if (useAllocation) {
    const slotAlloc = params.allocation!.per_slot[params.slotId];
    if (!slotAlloc) return null;
    if (params.liftedMax != null && Number.isFinite(params.liftedMax)) {
      return params.liftedMax;
    }
    return slotAlloc.per_item_enforced ?? slotAlloc.padded_max;
  }

  if (ctx.max != null && Number.isFinite(ctx.max)) {
    return ctx.max * LEGACY_BUDGET_PAD_MAX;
  }
  return null;
}

export function guardMaxMajor(enforcedMajor: number): number {
  return enforcedMajor * RELEVANCE_GUARD_MULTIPLIER;
}

/**
 * Shared price bounds for retrieval filters and hard drops.
 * Returns cents, or null when no price filter applies.
 *
 * - client_enforcement (default): padded_max — the law
 * - server_filter: guard_max = padded_max × RELEVANCE_GUARD_MULTIPLIER — relevance guard only
 */
export function priceBoundsForSlot(
  params: PriceBoundsParams,
): { min?: number; max?: number } | null {
  const ctx = params.brief.budget_context;
  if (!ctx.stated) return null;

  const briefCurrency = ctx.currency?.trim().toUpperCase();
  const buyerCurrency = params.profileCurrency.trim().toUpperCase();
  if (briefCurrency && buyerCurrency && briefCurrency !== buyerCurrency) {
    return null;
  }

  const purpose = params.purpose ?? "client_enforcement";
  const useAllocation = Boolean(
    params.allocation?.per_slot[params.slotId] &&
      (params.mode === "outfit" ||
        params.mode === "capsule" ||
        params.mode === "multi_item"),
  );

  if (useAllocation) {
    const slotAlloc = params.allocation!.per_slot[params.slotId];
    if (!slotAlloc) return null;

    const enforcedMajor =
      params.liftedMax != null && Number.isFinite(params.liftedMax)
        ? params.liftedMax
        : (slotAlloc.per_item_enforced ?? slotAlloc.padded_max);

    const serverMax =
      purpose === "server_filter"
        ? (slotAlloc.per_item_guard ?? guardMaxMajor(enforcedMajor))
        : enforcedMajor;

    const price: { min?: number; max?: number } = {
      max: toMinorUnits(serverMax),
    };
    // Min bounds stay as-is — a stated min is rare and doesn't poison relevance.
    if (slotAlloc.padded_min != null && slotAlloc.padded_min > 0) {
      price.min = toMinorUnits(slotAlloc.padded_min);
    }
    return price;
  }

  const price: { min?: number; max?: number } = {};
  if (ctx.max != null && Number.isFinite(ctx.max)) {
    const enforced = ctx.max * LEGACY_BUDGET_PAD_MAX;
    price.max = toMinorUnits(
      purpose === "server_filter" ? guardMaxMajor(enforced) : enforced,
    );
  }
  if (ctx.min != null && Number.isFinite(ctx.min) && ctx.min > 0) {
    price.min = toMinorUnits(ctx.min * LEGACY_BUDGET_PAD_MIN);
  }
  if (price.min == null && price.max == null) return null;
  return price;
}

/** Interpretation for stated budgets when full allocation does not apply. */
export function statedBudgetInterpretation(
  brief: FashionSearchBrief,
  mode: SearchPlanMode,
): BudgetInterpretation | undefined {
  const ctx = brief.budget_context;
  if (!ctx.stated) return undefined;
  if (ctx.scope === "per_item") return "per_item_stated";
  if (ctx.scope === "total") return "total_stated";
  if (mode === "outfit" || mode === "capsule") return "set_total_assumed";
  if (mode === "multi_item") return "per_item_assumed";
  return "per_item_assumed";
}

/** Attach allocation to plan after planner + clamps. */
export function attachBudgetAllocation(
  plan: FashionSearchPlan,
  profileCurrency: string,
): FashionSearchPlan {
  const allocation = resolveAllocation(plan, profileCurrency);
  if (allocation) {
    if (
      plan.brief.budget_context.stated &&
      !allocation.budget_interpretation
    ) {
      // Invariant: stated budget must always announce interpretation.
      allocation.budget_interpretation = statedBudgetInterpretation(
        plan.brief,
        plan.mode,
      )!;
    }
    return {
      ...plan,
      budget_allocation: allocation,
    };
  }

  if (!plan.brief.budget_context.stated) return plan;

  // single_item / currency mismatch: still set interpretation (no assembly).
  const interpretation = statedBudgetInterpretation(plan.brief, plan.mode);
  if (!interpretation) return plan;
  return {
    ...plan,
    budget_allocation: {
      bounds: new Map(),
      per_slot: {},
      validation: "accepted",
      budget_interpretation: interpretation,
    },
  };
}
