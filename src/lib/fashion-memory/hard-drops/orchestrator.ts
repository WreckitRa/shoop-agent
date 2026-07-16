import { logAiChat } from "@/lib/ai-chat/observability";
import { recordPipelineEvent } from "../observability/trace";
import {
  guardMaxMajor,
  RELEVANCE_GUARD_MULTIPLIER,
} from "../budget/budgetAllocation";
import { recordPricedLaneJunkShare } from "../budget/junk-share-metrics";
import type { FashionSearchBrief } from "../router/types";
import type { FashionFactRow } from "../types";
import type { FashionSlotCatalogResult } from "../catalog-search/types";
import { applyHardDrops } from "./apply-hard-drops";
import type { HardDropMetrics, HardDropRule } from "./types";
import { prefetchFxRates } from "@/lib/money/fx";

const EXCESSIVE_DROP_RATIO = 0.7;
const JUNK_FILL_RATIO = 0.5;

function tallyRule(
  counts: Partial<Record<HardDropRule, number>>,
  rule: HardDropRule,
): void {
  counts[rule] = (counts[rule] ?? 0) + 1;
}

function tallySuspicion(
  counts: Record<string, number>,
  rule: string,
): void {
  counts[rule] = (counts[rule] ?? 0) + 1;
}

function maybeEmitJunkFillTripwire(params: {
  traceId?: string | null;
  slot: FashionSlotCatalogResult;
  dropsByRule: Partial<Record<HardDropRule, number>>;
  brief: FashionSearchBrief;
}): void {
  if (!params.brief.budget_context.stated) return;

  const pricedLaneProducts = params.slot.products.filter(
    (p) =>
      p.matched_by_lanes?.includes("A") || p.matched_by_lanes?.includes("C"),
  );
  // After hard drops, products are survivors only — use in-count from metrics
  // via priced-lane bookkeeping on the pre-drop set is unavailable here.
  // Approximate: junk-fill = (category_mismatch + department_mismatch) / in
  // when those two dominate a priced search. Caller passes pre-drop via slot
  // before mutation — we read from drops + original length stored on metrics.
}

export async function applyHardDropsForSlots<T extends FashionSlotCatalogResult>(params: {
  traceId?: string | null;
  slots: T[];
  recipientFacts: FashionFactRow[];
  brief: FashionSearchBrief;
  mode?: import("../search-planner/types").SearchPlanMode;
  allocation?: import("../budget/budgetAllocation").ResolvedBudgetAllocation | null;
  profileCurrency?: string;
  liftedMaxBySlot?: Map<string, number>;
}): Promise<{ slots: T[]; metrics: HardDropMetrics[] }> {
  const buyerCurrency =
    params.profileCurrency ??
    params.brief.budget_context.currency ??
    "USD";
  const productCurrencies = params.slots.flatMap((s) =>
    s.products
      .map((p) => p.price?.currency)
      .filter((c): c is string => Boolean(c?.trim())),
  );
  await prefetchFxRates({
    buyerCurrency,
    productCurrencies,
  });

  const metrics: HardDropMetrics[] = [];

  for (const slot of params.slots) {
    const started = Date.now();
    const preDropProducts = slot.products;
    const partition = applyHardDrops({
      traceId: params.traceId,
      slot: { slot_id: slot.slot_id, garment: slot.garment },
      products: preDropProducts,
      recipientFacts: params.recipientFacts,
      brief: params.brief,
      mode: params.mode,
      allocation: params.allocation,
      profileCurrency: params.profileCurrency,
      liftedMax: params.liftedMaxBySlot?.get(slot.slot_id),
    });

    const slotMetrics: HardDropMetrics = {
      in: preDropProducts.length,
      out: partition.survivors.length,
      drops_by_rule: {},
      suspicions_by_rule: {},
      ms: Date.now() - started,
    };

    for (const drop of partition.dropped) {
      tallyRule(slotMetrics.drops_by_rule, drop.rule);
    }
    for (const survivor of partition.survivors) {
      for (const s of survivor.suspicions) {
        tallySuspicion(slotMetrics.suspicions_by_rule, s.rule);
      }
    }

    const enforced = params.allocation?.per_slot[slot.slot_id]?.padded_max;
    const guard =
      enforced != null ? guardMaxMajor(enforced) : undefined;

    slot.products = partition.survivors;
    const imageById = new Map(
      preDropProducts
        .map((p) => [p.id, p.image_urls[0]] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    );
    slot.dropped = partition.dropped.map((drop) => ({
      ...drop,
      image_url: drop.image_url ?? imageById.get(drop.product_id),
    }));
    slot.curator_exclusions = partition.curator_exclusions;
    slot.market_prices = partition.market_prices;
    slot.budget_dropped_pool = partition.budget_dropped_pool;
    slot.guard_band_count = partition.guard_band_count;
    slot.enforced_max = enforced;
    slot.guard_max = guard;
    slot.counts = {
      ...slot.counts,
      unique_products: partition.survivors.length,
    };

    metrics.push(slotMetrics);

    recordPipelineEvent({
      traceId: params.traceId,
      stage: "hard_drops",
      payload: {
        slot_id: slot.slot_id,
        garment: slot.garment,
        ...slotMetrics,
        market_prices: partition.market_prices,
      },
    });

    if (
      slotMetrics.in > 0 &&
      partition.dropped.length / slotMetrics.in > EXCESSIVE_DROP_RATIO
    ) {
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "invariant_warning",
        payload: {
          kind: "hard_drops_excessive",
          slot_id: slot.slot_id,
          in: slotMetrics.in,
          dropped: partition.dropped.length,
          ratio: partition.dropped.length / slotMetrics.in,
          drops_by_rule: slotMetrics.drops_by_rule,
        },
      });
      logAiChat("warn", "fashion_hard_drops_excessive", {
        traceId: params.traceId,
        slot_id: slot.slot_id,
        in: slotMetrics.in,
        dropped: partition.dropped.length,
      });
    }

    // Junk-fill tripwire: majority of a PRICED lane's results were wrong garment/dept.
    if (params.brief.budget_context.stated && preDropProducts.length > 0) {
      const pricedLaneIds = new Set(
        preDropProducts
          .filter(
            (p) =>
              p.matched_by_lanes?.includes("A") ||
              p.matched_by_lanes?.includes("C"),
          )
          .map((p) => p.id),
      );
      const pricedLaneCount = pricedLaneIds.size || preDropProducts.length;
      const junkDrops = partition.dropped.filter(
        (d) =>
          (d.rule === "category_mismatch" ||
            d.rule === "department_mismatch" ||
            d.rule === "item_type_mismatch") &&
          (pricedLaneIds.size === 0 || pricedLaneIds.has(d.product_id)),
      ).length;
      const junkRatio = junkDrops / pricedLaneCount;
      const enforced = params.allocation?.per_slot[slot.slot_id]?.padded_max;
      const guard =
        enforced != null ? guardMaxMajor(enforced) : undefined;

      recordPricedLaneJunkShare({
        slot_id: slot.slot_id,
        junk_ratio: junkRatio,
        priced_lane_count: pricedLaneCount,
        junk_drops: junkDrops,
        guard_band_count: partition.guard_band_count ?? 0,
        enforced_max: enforced,
        guard_max: guard,
        ts: Date.now(),
      });

      if (junkRatio > JUNK_FILL_RATIO) {
        recordPipelineEvent({
          traceId: params.traceId,
          stage: "invariant_warning",
          payload: {
            kind: "price_bound_junk_fill",
            slot_id: slot.slot_id,
            garment: slot.garment,
            bound: enforced,
            enforced_max: enforced,
            guard_max: guard,
            relevance_guard_multiplier: RELEVANCE_GUARD_MULTIPLIER,
            guard_band_count: partition.guard_band_count ?? 0,
            priced_lane_count: pricedLaneCount,
            junk_drops: junkDrops,
            ratio: junkRatio,
            drops_by_rule: {
              category_mismatch:
                slotMetrics.drops_by_rule.category_mismatch ?? 0,
              department_mismatch:
                slotMetrics.drops_by_rule.department_mismatch ?? 0,
              item_type_mismatch:
                slotMetrics.drops_by_rule.item_type_mismatch ?? 0,
            },
          },
        });
        logAiChat("warn", "fashion_price_bound_junk_fill", {
          traceId: params.traceId,
          slot_id: slot.slot_id,
          bound: enforced,
          guard_max: guard,
          guard_band_count: partition.guard_band_count ?? 0,
          ratio: junkRatio,
        });
      }
    }
  }

  return { slots: params.slots, metrics };
}
