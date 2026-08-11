import { logAiChat } from "@/lib/ai-chat/observability";
import type { AbortScope } from "@/lib/ai-chat/abort-scope";
import { recordPipelineEvent } from "../observability/trace";
import type { CatalogSearchContext } from "@/lib/shopify/catalog";
import {
  enforcedMaxMajor,
  guardMaxMajor,
} from "../budget/budgetAllocation";
import {
  buildVariantFilterPlans,
  expectedCategoryGidsForGarment,
} from "./category-hedge";
import { summarizeCategoryHedgeCoverage } from "./category-coverage";
import {
  dedupeSlotCatalogHits,
  perVariantRawCounts,
  variantCarriesColor,
  type VariantQueryHit,
} from "./dedupe";
import { summarizeCatalogFieldCoverage } from "./normalize-hit";
import { buildReformulationQueryVariants } from "./reformulation";
import { CATALOG_QUERY_HEDGE_MS } from "../pipeline-cutoffs";
import { runCatalogQueryWithTimeout } from "./query-runner";
import { CATALOG_PRIMARY_QUERY_COUNT } from "../search-planner/query-rules";
import { buildSlotCatalogFilters } from "./slot-filters";
import { composeSlotIntentString } from "./slot-intent";
import type {
  FashionCatalogQueryLog,
  FashionQueryVariantUsed,
  FashionSlotCatalogResult,
  SearchCatalogForSlotParams,
} from "./types";

const THIN_SLOT_THRESHOLD = 15;

export async function searchCatalogForSlot(
  params: SearchCatalogForSlotParams,
): Promise<FashionSlotCatalogResult> {
  const buyerContext: CatalogSearchContext = {
    address_country: params.profile.countryCode,
    currency: params.profile.currency,
    ...(params.profile.language ? { language: params.profile.language } : {}),
  };

  const intent = composeSlotIntentString({
    slot: params.slot,
    brief: params.brief,
    profile: params.profile,
  });

  const allVariants = params.slot.query_variants;
  const primaryVariants = allVariants.slice(0, CATALOG_PRIMARY_QUERY_COUNT);
  const spareVariants = allVariants.slice(CATALOG_PRIMARY_QUERY_COUNT);

  const slotAlloc = params.allocation?.per_slot[params.slot.slot_id];
  const enforced =
    enforcedMaxMajor({
      brief: params.brief,
      mode: params.mode ?? params.brief.request_type,
      slotId: params.slot.slot_id,
      allocation: params.allocation,
      liftedMax: params.liftedMax,
    }) ?? slotAlloc?.padded_max;
  const slotBudgetMeta = slotAlloc
    ? {
        fraction: slotAlloc.fraction,
        fraction_source: slotAlloc.fraction_source,
        allocated_max: slotAlloc.allocated_max,
        padded_max: slotAlloc.padded_max,
        enforced_max: enforced,
        guard_max: enforced != null ? guardMaxMajor(enforced) : undefined,
      }
    : undefined;

  const queryLogs: FashionCatalogQueryLog[] = [];

  const primaryPlans = buildVariantFilterPlans({
    garment: params.slot.garment,
    brief: params.brief,
    profile: params.profile,
    queries: primaryVariants,
    mode: params.mode,
    slotId: params.slot.slot_id,
    allocation: params.allocation,
    liftedMax: params.liftedMax,
  });

  /** Race first spare at hedge tripwire while primary is still in flight. */
  let hedgePromise: Promise<{
    hits: VariantQueryHit[];
    plans: ReturnType<typeof buildVariantFilterPlans>;
    hedgeLogs: FashionCatalogQueryLog[];
  }> | null = null;
  let hedgeStarted = false;

  const fireFirstSpareHedge = (): Promise<{
    hits: VariantQueryHit[];
    plans: ReturnType<typeof buildVariantFilterPlans>;
    hedgeLogs: FashionCatalogQueryLog[];
  }> => {
    if (hedgeStarted || params.liftRetryOnly || !spareVariants[0]) {
      return Promise.resolve({
        hits: [],
        plans: [],
        hedgeLogs: [],
      });
    }
    hedgeStarted = true;
    const spareQuery = spareVariants[0]!;
    const sparePlans = buildVariantFilterPlans({
      garment: params.slot.garment,
      brief: params.brief,
      profile: params.profile,
      queries: [spareQuery],
      mode: params.mode,
      slotId: params.slot.slot_id,
      allocation: params.allocation,
      liftedMax: params.liftedMax,
    });
    logAiChat("info", "fashion_catalog_hedge_spare", {
      slot_id: params.slot.slot_id,
      hedge_ms: CATALOG_QUERY_HEDGE_MS,
      raced: true,
    });
    const hedgeLogs: FashionCatalogQueryLog[] = [];
    return fanOutQueryVariants({
      accessToken: params.accessToken,
      slotId: params.slot.slot_id,
      garment: params.slot.garment,
      variantPlans: sparePlans,
      buyerContext,
      intent,
      signal: params.signal,
      abortScope: params.abortScope,
      queryLogs: hedgeLogs,
      reformulation: false,
      variantIndexOffset: CATALOG_PRIMARY_QUERY_COUNT,
      traceId: params.traceId,
      slotBudgetMeta,
      onVariantHit: params.onVariantHit,
    }).then((hits) => ({
      hits,
      plans: sparePlans,
      hedgeLogs,
    }));
  };

  const primaryPromise = fanOutQueryVariants({
    accessToken: params.accessToken,
    slotId: params.slot.slot_id,
    garment: params.slot.garment,
    variantPlans: primaryPlans,
    buyerContext,
    intent,
    signal: params.signal,
    abortScope: params.abortScope,
    queryLogs,
    reformulation: false,
    traceId: params.traceId,
    slotBudgetMeta,
    onVariantHit: params.onVariantHit,
  });

  const hedgeTimer =
    !params.liftRetryOnly && spareVariants.length > 0
      ? setTimeout(() => {
          hedgePromise = fireFirstSpareHedge();
        }, CATALOG_QUERY_HEDGE_MS)
      : null;

  let hits: VariantQueryHit[];
  try {
    hits = await primaryPromise;
  } finally {
    if (hedgeTimer) clearTimeout(hedgeTimer);
  }

  let queryVariantsUsed: FashionQueryVariantUsed[] = primaryPlans.map((plan) => ({
    query: plan.query,
    category_filtered: plan.category_filtered,
    lane: plan.lane,
  }));

  let reformulated = false;
  const spareIndicesFired: number[] = [];

  const primaryThin = () => {
    const deduped = dedupeSlotCatalogHits(hits);
    const primaryHits = hits.filter((h) => h.variantIndex < CATALOG_PRIMARY_QUERY_COUNT);
    const anyPrimaryEmpty = primaryHits.some((h) => h.products.length === 0);
    const anyPrimaryFailed = queryLogs.some(
      (l) =>
        l.variant_index < CATALOG_PRIMARY_QUERY_COUNT &&
        l.status === "failed",
    );
    return (
      deduped.length < THIN_SLOT_THRESHOLD || anyPrimaryEmpty || anyPrimaryFailed
    );
  };

  // Merge raced hedge if it already started; else fire first spare when thin.
  if (!params.liftRetryOnly && spareVariants.length > 0) {
    if (!hedgePromise && primaryThin()) {
      hedgePromise = fireFirstSpareHedge();
    }
    if (hedgePromise) {
      const {
        hits: spareHits,
        plans: sparePlans,
        hedgeLogs,
      } = await hedgePromise;
      queryLogs.push(...hedgeLogs);
      hits = [...hits, ...spareHits];
      if (sparePlans.length) {
        spareIndicesFired.push(CATALOG_PRIMARY_QUERY_COUNT);
        queryVariantsUsed = [
          ...queryVariantsUsed,
          ...sparePlans.map((plan) => ({
            query: plan.query,
            category_filtered: plan.category_filtered,
            lane: plan.lane,
          })),
        ];
      }
      logAiChat("info", "fashion_catalog_hedge_merged", {
        slot_id: params.slot.slot_id,
        unique_after: dedupeSlotCatalogHits(hits).length,
        raced: hedgeStarted,
      });
    }

    // Additional spares while still thin (skip index 0 — already hedged).
    for (let i = 1; i < spareVariants.length; i++) {
      if (!primaryThin()) break;
      const spareQuery = spareVariants[i]!;
      const sparePlans = buildVariantFilterPlans({
        garment: params.slot.garment,
        brief: params.brief,
        profile: params.profile,
        queries: [spareQuery],
        mode: params.mode,
        slotId: params.slot.slot_id,
        allocation: params.allocation,
        liftedMax: params.liftedMax,
      });

      const spareHits = await fanOutQueryVariants({
        accessToken: params.accessToken,
        slotId: params.slot.slot_id,
        garment: params.slot.garment,
        variantPlans: sparePlans,
        buyerContext,
        intent,
        signal: params.signal,
        abortScope: params.abortScope,
        queryLogs,
        reformulation: false,
        variantIndexOffset: CATALOG_PRIMARY_QUERY_COUNT + i,
        traceId: params.traceId,
        slotBudgetMeta,
        onVariantHit: params.onVariantHit,
      });

      hits = [...hits, ...spareHits];
      queryVariantsUsed = [
        ...queryVariantsUsed,
        ...sparePlans.map((plan) => ({
          query: plan.query,
          category_filtered: plan.category_filtered,
          lane: plan.lane,
        })),
      ];
      spareIndicesFired.push(CATALOG_PRIMARY_QUERY_COUNT + i);
    }
  }

  if (!params.liftRetryOnly && primaryThin()) {
    const reformVariants = buildReformulationQueryVariants({
      slot: params.slot,
      priorVariants: queryVariantsUsed.map((v) => v.query),
      department:
        params.brief.knowledge_state?.department ?? params.brief.department_scope,
    });

    if (reformVariants.length >= 2) {
      reformulated = true;

      const reformIntent = composeSlotIntentString({
        slot: params.slot,
        brief: params.brief,
        profile: params.profile,
        dropColorNudge: true,
      });

      const reformFilters = buildSlotCatalogFilters({
        brief: params.brief,
        profile: params.profile,
        garment: params.slot.garment,
        mode: params.mode,
        slotId: params.slot.slot_id,
        allocation: params.allocation,
        liftedMax: params.liftedMax,
        options: { omitCategory: true },
      });

      const reformPlans = reformVariants.map((query) => ({
        query,
        filters: reformFilters,
        category_filtered: false,
        lane: "A" as const,
      }));

      queryVariantsUsed = [
        ...queryVariantsUsed,
        ...reformPlans.map((plan) => ({
          query: plan.query,
          category_filtered: plan.category_filtered,
          lane: plan.lane,
        })),
      ];

      const reformHits = await fanOutQueryVariants({
        accessToken: params.accessToken,
        slotId: params.slot.slot_id,
        garment: params.slot.garment,
        variantPlans: reformPlans,
        buyerContext,
        intent: reformIntent,
        signal: params.signal,
        abortScope: params.abortScope,
        queryLogs,
        reformulation: true,
        variantIndexOffset: allVariants.length,
        traceId: params.traceId,
        slotBudgetMeta,
        onVariantHit: params.onVariantHit,
      });

      hits = [...hits, ...reformHits];
    }
  }

  const products = dedupeSlotCatalogHits(hits);
  const unfilteredVariantIndices = new Set(
    hits.filter((h) => !h.category_filtered).map((h) => h.variantIndex),
  );
  const categoryCoverage = summarizeCategoryHedgeCoverage({
    products,
    expectedCategoryGids: expectedCategoryGidsForGarment(params.slot.garment),
    unfilteredVariantIndices,
  });

  recordPipelineEvent({
    traceId: params.traceId,
    stage: "ucp_coverage",
    payload: {
      slot_id: params.slot.slot_id,
      garment: params.slot.garment,
      ...summarizeCatalogFieldCoverage(products),
      ...categoryCoverage,
      spare_indices_fired: spareIndicesFired,
    },
  });

  logAiChat("info", "fashion_catalog_slot_complete", {
    slot_id: params.slot.slot_id,
    garment: params.slot.garment,
    unique_products: products.length,
    reformulated,
    spare_indices_fired: spareIndicesFired,
    query_count: queryLogs.length,
    unfiltered_lane_unique: categoryCoverage.unfiltered_lane_unique,
  });

  return {
    slot_id: params.slot.slot_id,
    garment: params.slot.garment,
    products,
    query_variants_used: queryVariantsUsed,
    counts: {
      unique_products: products.length,
      per_variant: perVariantRawCounts(hits),
      reformulated,
    },
    query_logs: queryLogs,
  };
}

type SlotBudgetMeta = {
  fraction: number;
  fraction_source: string;
  allocated_max: number;
  padded_max: number;
  enforced_max?: number;
  guard_max?: number;
};

async function fanOutQueryVariants(params: {
  accessToken: string;
  slotId: string;
  garment: string;
  variantPlans: Array<{
    query: string;
    filters: ReturnType<typeof buildSlotCatalogFilters>;
    category_filtered: boolean;
    lane?: import("./category-hedge").CatalogLane;
  }>;
  buyerContext: CatalogSearchContext;
  intent: string;
  signal?: AbortSignal;
  abortScope?: AbortScope;
  queryLogs: FashionCatalogQueryLog[];
  reformulation: boolean;
  variantIndexOffset?: number;
  traceId?: string | null;
  slotBudgetMeta?: SlotBudgetMeta;
  onVariantHit?: SearchCatalogForSlotParams["onVariantHit"];
}): Promise<VariantQueryHit[]> {
  const offset = params.variantIndexOffset ?? 0;

  const settled = await Promise.all(
    params.variantPlans.map(async (plan, idx) => {
      try {
        const value = await runCatalogQueryWithTimeout({
          accessToken: params.accessToken,
          query: plan.query,
          filters: plan.filters,
          buyerContext: params.buyerContext,
          intent: params.intent,
          signal: params.signal,
          abortScope: params.abortScope,
          slotId: params.slotId,
          variantIndex: offset + idx,
          reformulation: params.reformulation,
          traceId: params.traceId,
        });
        if (value.products.length > 0) {
          params.onVariantHit?.({
            products: value.products,
            slotId: params.slotId,
            garment: params.garment,
          });
        }
        return { status: "fulfilled" as const, value, plan, idx };
      } catch (reason) {
        return { status: "rejected" as const, reason, plan, idx };
      }
    }),
  );

  const hits: VariantQueryHit[] = [];

  for (const result of settled) {
    const plan = result.plan;
    if (result.status === "fulfilled") {
      params.queryLogs.push(result.value.log);
      hits.push({
        variantIndex: offset + result.idx,
        products: result.value.products,
        carriesColor: variantCarriesColor(plan.query),
        category_filtered: plan.category_filtered,
        lane: plan.lane,
      });
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "ucp_query",
        payload: {
          slot_id: params.slotId,
          query: result.value.log.query,
          filters: plan.filters,
          category_filtered: plan.category_filtered,
          lane: plan.lane,
          result_count: result.value.log.raw_count,
          latency_ms: result.value.log.duration_ms,
          reformulation: params.reformulation,
          ...(params.slotBudgetMeta
            ? {
                fraction: params.slotBudgetMeta.fraction,
                fraction_source: params.slotBudgetMeta.fraction_source,
                allocated_max: params.slotBudgetMeta.allocated_max,
                padded_max: params.slotBudgetMeta.padded_max,
                enforced_max:
                  params.slotBudgetMeta.enforced_max ??
                  params.slotBudgetMeta.padded_max,
                guard_max: params.slotBudgetMeta.guard_max,
              }
            : {}),
        },
      });
    } else {
      params.queryLogs.push({
        slot_id: params.slotId,
        variant_index: offset + result.idx,
        query: plan.query,
        reformulation: params.reformulation,
        status: "failed",
        raw_count: 0,
        duration_ms: 0,
        error: String(result.reason).slice(0, 240),
      });
    }
  }

  return hits;
}
