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
import { runCatalogQueryWithTimeout } from "./query-runner";
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

  const variants = params.slot.query_variants.slice(0, 3);
  const variantPlans = buildVariantFilterPlans({
    garment: params.slot.garment,
    brief: params.brief,
    profile: params.profile,
    queries: variants,
    mode: params.mode,
    slotId: params.slot.slot_id,
    allocation: params.allocation,
    liftedMax: params.liftedMax,
  });

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
  const catalogById: Record<string, Record<string, unknown>> = {};

  const initialHits = await fanOutQueryVariants({
    accessToken: params.accessToken,
    slotId: params.slot.slot_id,
    variantPlans,
    buyerContext,
    intent,
    signal: params.signal,
    abortScope: params.abortScope,
    queryLogs,
    catalogById,
    reformulation: false,
    traceId: params.traceId,
    slotBudgetMeta,
  });

  let hits = initialHits;
  let reformulated = false;
  let queryVariantsUsed: FashionQueryVariantUsed[] = variantPlans.map((plan) => ({
    query: plan.query,
    category_filtered: plan.category_filtered,
    lane: plan.lane,
  }));

  const deduped = dedupeSlotCatalogHits(hits);
  if (!params.liftRetryOnly && deduped.length < THIN_SLOT_THRESHOLD) {
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
        options: { omitCategory: true, omitTargetGender: true },
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
        variantPlans: reformPlans,
        buyerContext,
        intent: reformIntent,
        signal: params.signal,
        abortScope: params.abortScope,
        queryLogs,
        catalogById,
        reformulation: true,
        variantIndexOffset: variants.length,
        traceId: params.traceId,
        slotBudgetMeta,
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
    },
  });

  logAiChat("info", "fashion_catalog_slot_complete", {
    slot_id: params.slot.slot_id,
    garment: params.slot.garment,
    unique_products: products.length,
    reformulated,
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
    catalog_by_id: catalogById,
  };
}

type SlotBudgetMeta = {
  fraction: number;
  fraction_source: string;
  allocated_max: number;
  padded_max: number;
  /** Client enforcement ceiling (major). */
  enforced_max?: number;
  /** Server relevance-guard ceiling (major) = enforced × RELEVANCE_GUARD_MULTIPLIER. */
  guard_max?: number;
};

async function fanOutQueryVariants(params: {
  accessToken: string;
  slotId: string;
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
  catalogById: Record<string, Record<string, unknown>>;
  reformulation: boolean;
  variantIndexOffset?: number;
  traceId?: string | null;
  slotBudgetMeta?: SlotBudgetMeta;
}): Promise<VariantQueryHit[]> {
  const offset = params.variantIndexOffset ?? 0;

  const settled = await Promise.allSettled(
    params.variantPlans.map((plan, idx) =>
      runCatalogQueryWithTimeout({
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
      }),
    ),
  );

  const hits: VariantQueryHit[] = [];

  settled.forEach((result, idx) => {
    const plan = params.variantPlans[idx]!;
    if (result.status === "fulfilled") {
      params.queryLogs.push(result.value.log);
      Object.assign(params.catalogById, result.value.catalogById);
      hits.push({
        variantIndex: offset + idx,
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
        variant_index: offset + idx,
        query: plan.query,
        reformulation: params.reformulation,
        status: "failed",
        raw_count: 0,
        duration_ms: 0,
        error: String(result.reason).slice(0, 240),
      });
    }
  });

  return hits;
}
