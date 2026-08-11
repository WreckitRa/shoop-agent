import { logAiChat } from "@/lib/ai-chat/observability";
import { createAbortScope } from "@/lib/ai-chat/abort-scope";
import { extractCatalogImageUrl } from "@/lib/shopify/catalog";
import { applyHardDropsForSlots } from "../hard-drops/orchestrator";
import { hydrateCatalogSlots } from "../hydration/orchestrator";
import { normalizeCatalogSearchSlots } from "../normalize/orchestrator";
import { scoreCatalogSlots } from "../scoring/orchestrator";
import {
  applyLiftedMax,
  evaluateBudgetLift,
  LIFT_READMIT_MIN,
  readmitBudgetDroppedProducts,
} from "../budget/budgetLift";
import { resolveAllocation } from "../budget/budgetAllocation";
import { computeBudgetTension } from "../budget/budgetTension";
import {
  buildBudgetRaiseAskFromContext,
  type BudgetRaiseAsk,
} from "../budget/budget-raise-ask";
import { recordPipelineEvent } from "../observability/trace";
import { resolveBrandForCatalogSlots } from "./resolve-brand-slots";
import { searchCatalogForSlot } from "./search-catalog-for-slot";
import { dedupeProductsAcrossSlots } from "./dedupe";
import type {
  FashionCatalogSearchResult,
  FashionSlotCatalogProduct,
  FashionSlotCatalogResult,
  MessageFashionCatalogSearchMetaV1,
  SearchFashionCatalogPlanParams,
} from "./types";
import type { FashionSearchPlan } from "../search-planner/types";
import type { FashionFactRow } from "../types";
import { statedBrands, translateBrandStyle } from "../brand/brand-handling";
import type { HardDropMetrics } from "../hard-drops/types";
import { runFashionCuration } from "../curation/run-curation";
import { buildProvisionalPresentation } from "../curation/provisional-rack";
import type { SlotPool } from "../hydration/types";
import { persistAllSlotPools } from "../hydration/pool-persistence";
import { buildCatalogCallContext } from "@/lib/shopify/catalog";
import { scheduleDetachedWork } from "../schedule-detached";
import {
  FASHION_PROVISIONAL_RACK_ENABLED,
  FASHION_CURATION_SPLIT_ENABLED,
  STAGE_A_EARMARK_MS,
  PRE_CURATION_POCKET_MS,
  CURATION_STAGE_A_HARD_MS,
  chooseStageARung,
} from "../pipeline-cutoffs";

const LOADER_PREVIEW_LIMIT = 8;
const LOADER_DROP_LIMIT = 8;

function uniqueImageUrls(
  urls: Array<string | undefined | null>,
  limit: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

function previewUrlsFromSlotProducts(
  products: Array<Pick<FashionSlotCatalogProduct, "image_urls">>,
  limit = LOADER_PREVIEW_LIMIT,
): string[] {
  return uniqueImageUrls(
    products.map((p) => p.image_urls[0]),
    limit,
  );
}

function previewUrlsFromSlots(
  slots: FashionSlotCatalogResult[],
  limit = LOADER_PREVIEW_LIMIT,
): string[] {
  return uniqueImageUrls(
    slots.flatMap((s) => s.products.map((p) => p.image_urls[0])),
    limit,
  );
}

function droppedUrlsFromSlots(
  slots: FashionSlotCatalogResult[],
  limit = LOADER_DROP_LIMIT,
): string[] {
  return uniqueImageUrls(
    slots.flatMap((s) => (s.dropped ?? []).map((d) => d.image_url)),
    limit,
  );
}

function verifiedUrlsFromSlots(
  slots: FashionSlotCatalogResult[],
  limit = LOADER_PREVIEW_LIMIT,
): string[] {
  return uniqueImageUrls(
    slots.flatMap((s) => (s.verified_pool ?? []).map((c) => c.media_urls?.[0])),
    limit,
  );
}
/** Normalize → hard drops → scoring (no catalog I/O). */
export async function postProcessFashionCatalogSlots(params: {
  traceId?: string | null;
  plan: FashionSearchPlan;
  slots: FashionSlotCatalogResult[];
  recipientFacts?: FashionFactRow[];
  signal?: AbortSignal;
  profileCurrency?: string;
  liftedMaxBySlot?: Map<string, number>;
}): Promise<{
  slots: FashionSlotCatalogResult[];
  normalize_ms: number;
  hard_drop_ms: number;
  scoring_ms: number;
  hardDropMetrics: HardDropMetrics[];
}> {
  const normalized = await normalizeCatalogSearchSlots({
    traceId: params.traceId,
    slots: params.slots,
    signal: params.signal,
  });

  const hardDropped = await applyHardDropsForSlots({
    traceId: params.traceId,
    slots: normalized.slots,
    recipientFacts: params.recipientFacts ?? [],
    brief: params.plan.brief,
    mode: params.plan.mode,
    allocation: params.plan.budget_allocation,
    profileCurrency: params.profileCurrency,
    liftedMaxBySlot: params.liftedMaxBySlot,
  });

  const scored = scoreCatalogSlots({
    traceId: params.traceId,
    planSlots: params.plan.slots,
    brief: params.plan.brief,
    recipientFacts: params.recipientFacts ?? [],
    slots: hardDropped.slots,
  });

  const slots = dedupeProductsAcrossSlots(scored.slots);

  return {
    slots,
    normalize_ms: normalized.metrics.ms,
    hard_drop_ms: hardDropped.metrics.reduce((n, m) => n + m.ms, 0),
    scoring_ms: scored.metrics.reduce((n, m) => n + m.ms, 0),
    hardDropMetrics: hardDropped.metrics,
  };
}

/** Normalize → hard drops → scoring → hydration. Hydration skipped when token/profile not passed. */
export async function postProcessAndHydrateFashionCatalogSlots(params: {
  traceId?: string | null;
  plan: FashionSearchPlan;
  slots: FashionSlotCatalogResult[];
  recipientFacts?: FashionFactRow[];
  accessToken?: string | null;
  profile?: SearchFashionCatalogPlanParams["profile"] | null;
  signal?: AbortSignal;
  abortScope?: import("@/lib/ai-chat/abort-scope").AbortScope;
  liftedMaxBySlot?: Map<string, number>;
}): Promise<{
  slots: FashionSlotCatalogResult[];
  normalize_ms: number;
  hard_drop_ms: number;
  scoring_ms: number;
  hydration_ms: number;
  hardDropMetrics: HardDropMetrics[];
}> {
  const processed = await postProcessFashionCatalogSlots({
    traceId: params.traceId,
    plan: params.plan,
    slots: params.slots,
    recipientFacts: params.recipientFacts,
    signal: params.signal,
    profileCurrency: params.profile?.currency,
    liftedMaxBySlot: params.liftedMaxBySlot,
  });

  if (params.accessToken == null || params.profile == null) {
    logAiChat("warn", "fashion_catalog_hydration_skipped", {
      traceId: params.traceId,
      reason:
        params.accessToken == null
          ? "missing_access_token"
          : "missing_profile",
    });
    return { ...processed, hydration_ms: 0 };
  }

  const started = Date.now();
  const hydrated = await hydrateCatalogSlots({
    traceId: params.traceId,
    plan: params.plan,
    slots: processed.slots,
    recipientFacts: params.recipientFacts ?? [],
    accessToken: params.accessToken,
    profile: params.profile,
    signal: params.signal,
    abortScope: params.abortScope,
  });

  return {
    slots: hydrated.slots,
    normalize_ms: processed.normalize_ms,
    hard_drop_ms: processed.hard_drop_ms,
    scoring_ms: processed.scoring_ms,
    hydration_ms: Date.now() - started,
    hardDropMetrics: processed.hardDropMetrics,
  };
}

async function runBudgetLiftRetries(params: {
  plan: FashionSearchPlan;
  slots: FashionSlotCatalogResult[];
  hardDropMetrics: HardDropMetrics[];
  accessToken: string;
  profile: SearchFashionCatalogPlanParams["profile"];
  signal?: AbortSignal;
  abortScope?: import("@/lib/ai-chat/abort-scope").AbortScope;
  traceId?: string | null;
  recipientFacts?: FashionFactRow[];
}): Promise<{
  plan: FashionSearchPlan;
  slots: FashionSlotCatalogResult[];
  hardDropMetrics: HardDropMetrics[];
  liftedSlots: Set<string>;
  preLiftSurvivorCounts: Map<string, number>;
  preLiftBudgetDrops: Map<string, number>;
}> {
  const allocation = params.plan.budget_allocation;
  if (
    !allocation?.budget_assembly ||
    (params.plan.mode !== "outfit" && params.plan.mode !== "capsule")
  ) {
    return {
      plan: params.plan,
      slots: params.slots,
      hardDropMetrics: params.hardDropMetrics,
      liftedSlots: new Set(),
      preLiftSurvivorCounts: new Map(),
      preLiftBudgetDrops: new Map(),
    };
  }

  const preLiftSurvivorCounts = new Map<string, number>();
  const preLiftBudgetDrops = new Map<string, number>();
  const rawCounts = new Map<string, number>();

  for (let i = 0; i < params.slots.length; i++) {
    const slot = params.slots[i]!;
    const metrics = params.hardDropMetrics[i];
    preLiftSurvivorCounts.set(slot.slot_id, slot.products.length);
    preLiftBudgetDrops.set(
      slot.slot_id,
      metrics?.drops_by_rule?.budget ?? 0,
    );
    rawCounts.set(
      slot.slot_id,
      slot.products.length + (metrics?.drops_by_rule?.budget ?? 0),
    );
  }

  const decisions = evaluateBudgetLift({
    allocation,
    slots: params.slots.map((s) => ({
      slot_id: s.slot_id,
      products: s.products,
      market_prices: s.market_prices,
      budget_dropped_pool: s.budget_dropped_pool,
    })),
    hardDropMetrics: params.hardDropMetrics,
    rawCounts,
    budgetDrops: preLiftBudgetDrops,
  });

  let plan = params.plan;
  let slots = [...params.slots];
  let hardDropMetrics = params.hardDropMetrics;
  const liftedSlots = new Set<string>();

  type LiftWork = {
    decision: (typeof decisions)[number];
    slotIdx: number;
    planSlot: (typeof plan.slots)[number];
    existing: FashionSlotCatalogResult;
    liftedMax: number;
  };

  const liftWork: LiftWork[] = [];
  for (const decision of decisions) {
    if (!decision.should_lift || decision.lifted_max == null) {
      if (decision.skip_reason === "no_room") {
        recordPipelineEvent({
          traceId: params.traceId,
          stage: "budget_lift",
          payload: {
            slot_id: decision.slot_id,
            skipped: true,
            reason: "no_room",
            from: decision.original_padded_max,
            cheapest_viables: decision.cheapest_viables,
          },
        });
      }
      continue;
    }

    const slotIdx = slots.findIndex((s) => s.slot_id === decision.slot_id);
    if (slotIdx === -1) continue;
    const planSlot = plan.slots.find((s) => s.slot_id === decision.slot_id);
    if (!planSlot) continue;

    plan = {
      ...plan,
      budget_allocation: applyLiftedMax(
        plan.budget_allocation!,
        decision.slot_id,
        decision.lifted_max,
      ),
    };
    liftWork.push({
      decision,
      slotIdx,
      planSlot,
      existing: slots[slotIdx]!,
      liftedMax: decision.lifted_max,
    });
  }

  if (liftWork.length === 0) {
    return {
      plan,
      slots,
      hardDropMetrics,
      liftedSlots,
      preLiftSurvivorCounts,
      preLiftBudgetDrops,
    };
  }

  const liftResults = await Promise.all(
    liftWork.map(async ({ decision, slotIdx, planSlot, existing, liftedMax }) => {
      let mergedProducts = [...existing.products];
      let queryLogs = existing.query_logs;
      let queryVariantsUsed = existing.query_variants_used;
      let readmitted = 0;
      let requeryRan = false;

      const readmittedProducts = readmitBudgetDroppedProducts({
        pool: existing.budget_dropped_pool ?? [],
        liftedMaxMajor: liftedMax,
      });
      if (readmittedProducts.length) {
        readmitted = readmittedProducts.length;
        const byId = new Map(mergedProducts.map((p) => [p.id, p]));
        for (const p of readmittedProducts) {
          byId.set(p.id, p);
        }
        mergedProducts = [...byId.values()];
      }

      if (mergedProducts.length < LIFT_READMIT_MIN) {
        if (decision.skip_requery) {
          logAiChat("info", "fashion_budget_lift_skip_requery", {
            traceId: params.traceId,
            slot_id: decision.slot_id,
            readmitted,
            survivors: mergedProducts.length,
            reason: "tight_or_infeasible_market",
          });
        } else {
          requeryRan = true;
          const liftResult = await searchCatalogForSlot({
            slot: planSlot,
            brief: plan.brief,
            profile: params.profile,
            accessToken: params.accessToken,
            signal: params.signal,
            abortScope: params.abortScope,
            traceId: params.traceId,
            mode: plan.mode,
            allocation: plan.budget_allocation,
            liftedMax,
            liftRetryOnly: true,
          });

          const readmitIds = new Set(readmittedProducts.map((p) => p.id));
          const byId = new Map(
            mergedProducts.map((p) => [
              p.id,
              readmitIds.has(p.id) ? { ...p, budget_lift_readmitted: true } : p,
            ]),
          );
          for (const p of liftResult.products) {
            if (!byId.has(p.id)) byId.set(p.id, p);
          }
          mergedProducts = [...byId.values()];

          queryLogs = [...existing.query_logs, ...liftResult.query_logs];
          queryVariantsUsed = [
            ...existing.query_variants_used,
            ...liftResult.query_variants_used,
          ];
        }
      }

      const mergedSlot: FashionSlotCatalogResult = {
        ...existing,
        products: mergedProducts,
        query_logs: queryLogs,
        query_variants_used: queryVariantsUsed,
        counts: {
          ...existing.counts,
          unique_products: mergedProducts.length,
        },
        budget_dropped_pool: [],
      };

      return {
        decision,
        slotIdx,
        existing,
        mergedSlot,
        liftedMax,
        readmitted,
        requeryRan,
      };
    }),
  );

  const nextSlots = slots.map((s) => s);
  const liftedMaxBySlot = new Map<string, number>();
  for (const row of liftResults) {
    nextSlots[row.slotIdx] = row.mergedSlot;
    liftedMaxBySlot.set(row.decision.slot_id, row.liftedMax);
    liftedSlots.add(row.decision.slot_id);
  }

  const reprocessed = await postProcessFashionCatalogSlots({
    traceId: params.traceId,
    plan,
    slots: nextSlots,
    recipientFacts: params.recipientFacts,
    signal: params.signal,
    profileCurrency: params.profile.currency,
    liftedMaxBySlot,
  });

  slots = reprocessed.slots;
  hardDropMetrics = reprocessed.hardDropMetrics;

  for (const row of liftResults) {
    const reprocessedSlot = slots[row.slotIdx]!;
    if (row.existing.market_prices && !reprocessedSlot.market_prices) {
      reprocessedSlot.market_prices = row.existing.market_prices;
    }
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "budget_lift",
      payload: {
        slot_id: row.decision.slot_id,
        from: row.decision.original_padded_max,
        to: row.liftedMax,
        cheapest_viables: row.decision.cheapest_viables,
        readmitted: row.readmitted,
        requery_ran: row.requeryRan,
        market_p10: row.existing.market_prices?.p10,
      },
    });
  }

  return {
    plan,
    slots,
    hardDropMetrics,
    liftedSlots,
    preLiftSurvivorCounts,
    preLiftBudgetDrops,
  };
}

export async function searchFashionCatalogPlan(
  params: SearchFashionCatalogPlanParams,
): Promise<FashionCatalogSearchResult> {
  const started = Date.now();
  const abortScope = createAbortScope(params.signal);

  let plan: FashionSearchPlan = {
    ...params.plan,
    budget_allocation:
      resolveAllocation(params.plan, params.profile.currency) ??
      params.plan.budget_allocation,
  };

  // Pocket budgeting (v1.1): Stage A earmark is reserved at t=0 and never
  // skipped. Pre-curation overruns are logged; they do not delete curation.
  const stageAEarmarkMs = STAGE_A_EARMARK_MS;
  const preCurationPocketMs = FASHION_CURATION_SPLIT_ENABLED
    ? PRE_CURATION_POCKET_MS
    : PRE_CURATION_POCKET_MS + STAGE_A_EARMARK_MS;

  const brandsListed = statedBrands(plan.brief);
  const brandTranslatePromise =
    brandsListed.length > 0
      ? Promise.all(
          plan.slots.map(async (slot) => {
            const translation = await translateBrandStyle({
              brand: brandsListed[0]!,
              garment: slot.garment,
              brief: plan.brief,
              signal: params.signal,
              traceId: params.traceId,
              createMessage: params.createMessage,
            });
            return { slot_id: slot.slot_id, translation };
          }),
        ).catch((error) => {
          logAiChat("warn", "fashion_brand_prefetch_failed", {
            traceId: params.traceId,
            error: String(error).slice(0, 200),
          });
          return [] as Array<{
            slot_id: string;
            translation: Awaited<ReturnType<typeof translateBrandStyle>>;
          }>;
        })
      : null;

  const settled = await Promise.allSettled(
    plan.slots.map(async (slot) => {
      const result = await searchCatalogForSlot({
        slot,
        brief: plan.brief,
        profile: params.profile,
        accessToken: params.accessToken,
        signal: params.signal,
        abortScope,
        traceId: params.traceId,
        mode: plan.mode,
        allocation: plan.budget_allocation,
        onVariantHit: ({ products }) => {
          const previewImages = uniqueImageUrls(
            products.map((product) => extractCatalogImageUrl(product)),
            LOADER_PREVIEW_LIMIT,
          );
          if (!previewImages.length) return;
          // Image-only update — don't spam narration lines per query variant.
          params.onPhase?.({ previewImages });
        },
      });
      const previewImages = previewUrlsFromSlotProducts(result.products);
      const garment = result.garment?.trim() || "pieces";
      params.onPhase?.({
        line: `Pulling in ${garment}…`,
        previewImages,
      });
      return result;
    }),
  );

  let slots: FashionSlotCatalogResult[] = settled.map((result, idx) => {
    if (result.status === "fulfilled") return result.value;
    const slotId = plan.slots[idx]?.slot_id ?? `slot_${idx}`;
    const error = String(result.reason).slice(0, 240);
    logAiChat("warn", "fashion_catalog_slot_failed", {
      slot_id: slotId,
      error,
    });
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "catalog_slot_failed",
      payload: {
        slot_id: slotId,
        garment: plan.slots[idx]?.garment ?? slotId,
        error,
      },
    });
    return {
      slot_id: slotId,
      garment: plan.slots[idx]?.garment ?? slotId,
      products: [],
      query_variants_used: (plan.slots[idx]?.query_variants ?? []).map(
        (query) => ({ query, category_filtered: false }),
      ),
      counts: {
        unique_products: 0,
        per_variant: [],
        reformulated: false,
      },
      query_logs: [],
      thin_slot: true,
    };
  });

  const timing_ms = Date.now() - started;

  let brandNarration: string | null = null;

  if (brandsListed.length) {
    const prefetched = brandTranslatePromise
      ? await brandTranslatePromise
      : [];
    const preTranslations = new Map(
      prefetched.map((row) => [row.slot_id, row.translation]),
    );
    const resolved = await resolveBrandForCatalogSlots({
      plan,
      slots,
      profile: params.profile,
      accessToken: params.accessToken,
      signal: params.signal,
      abortScope,
      traceId: params.traceId,
      createMessage: params.createMessage,
      preTranslations,
    });
    plan = resolved.plan;
    slots = resolved.slots;
    brandNarration = resolved.brandNarration;
  }

  const initialProcessed = await postProcessFashionCatalogSlots({
    traceId: params.traceId,
    plan,
    slots,
    recipientFacts: params.recipientFacts,
    signal: params.signal,
    profileCurrency: params.profile.currency,
  });

  params.onPhase?.({
    line: "Cutting what doesn’t match the brief",
    previewImages: previewUrlsFromSlots(initialProcessed.slots),
    droppedImages: droppedUrlsFromSlots(initialProcessed.slots),
  });

  const liftResult = await runBudgetLiftRetries({
    plan,
    slots: initialProcessed.slots,
    hardDropMetrics: initialProcessed.hardDropMetrics,
    accessToken: params.accessToken,
    profile: params.profile,
    signal: params.signal,
    abortScope,
    traceId: params.traceId,
    recipientFacts: params.recipientFacts,
  });

  plan = liftResult.plan;
  slots = liftResult.slots;

  if (liftResult.liftedSlots.size > 0) {
    params.onPhase?.({
      line: "Giving the budget a little more room",
      previewImages: previewUrlsFromSlots(slots),
      droppedImages: droppedUrlsFromSlots(slots),
    });
  }

  let budget_tension;
  if (plan.budget_allocation?.budget_assembly) {
    budget_tension = computeBudgetTension({
      allocation: plan.budget_allocation,
      slots: slots.map((s) => ({
        slot_id: s.slot_id,
        products: s.products,
        market_prices: s.market_prices,
      })),
      hardDropMetrics: liftResult.hardDropMetrics,
      liftedSlots: liftResult.liftedSlots,
      preLiftSurvivorCounts: liftResult.preLiftSurvivorCounts,
      preLiftBudgetDrops: liftResult.preLiftBudgetDrops,
    });
  }

  const budgetRaiseAsk: BudgetRaiseAsk | null = params.skipBudgetRaiseAsk
    ? null
    : buildBudgetRaiseAskFromContext({
        plan,
        tension: budget_tension,
        slots,
      });

  if (budgetRaiseAsk) {
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "budget_raise_ask",
      payload: {
        reason: budgetRaiseAsk.reason,
        stated_max: budgetRaiseAsk.stated_max,
        min_viable_total: budgetRaiseAsk.min_viable_total,
      },
    });
    logAiChat("info", "fashion_budget_raise_ask", {
      traceId: params.traceId,
      reason: budgetRaiseAsk.reason,
      stated_max: budgetRaiseAsk.stated_max,
      min_viable_total: budgetRaiseAsk.min_viable_total,
      budget_tension: budget_tension?.severity,
    });
    logAiChat("info", "fashion_catalog_plan_complete", {
      mode: plan.mode,
      slot_count: slots.length,
      total_products: slots.reduce((n, s) => n + s.counts.unique_products, 0),
      verified_pool: 0,
      brand_statuses: plan.slots.map((s) => s.brand_status),
      timing_ms,
      normalize_ms: initialProcessed.normalize_ms,
      hard_drop_ms: initialProcessed.hard_drop_ms,
      scoring_ms: initialProcessed.scoring_ms,
      hydration_ms: 0,
      curation_ms: 0,
      budget_tension: budget_tension?.severity,
      budget_raise_ask: true,
    });
    return {
      version: 1,
      plan,
      slots,
      timing_ms,
      brand_narration: brandNarration ?? undefined,
      budget_assembly: plan.budget_allocation?.budget_assembly,
      budget_interpretation: plan.budget_allocation?.budget_interpretation,
      budget_tension,
      budget_raise_ask: budgetRaiseAsk,
    };
  }

  let hydration_ms = 0;
  let curation_ms = 0;
  let curation;
  let pools: Map<string, SlotPool> | undefined;

  if (params.accessToken != null && params.profile != null) {
    params.onPhase?.({
      line: "Checking stock and your size",
      previewImages: previewUrlsFromSlots(slots),
      droppedImages: droppedUrlsFromSlots(slots),
    });
    const hydrateStarted = Date.now();
    const hydrated = await hydrateCatalogSlots({
      traceId: params.traceId,
      plan,
      slots,
      recipientFacts: params.recipientFacts ?? [],
      accessToken: params.accessToken,
      profile: params.profile,
      signal: params.signal,
      abortScope,
    });
    slots = hydrated.slots;
    pools = hydrated.pools;
    hydration_ms = Date.now() - hydrateStarted;

    const { isCoverageGapPool, recordFamilyCoverage } = await import(
      "./family-coverage"
    );
    slots = slots.map((slot) => {
      const pool = pools?.get(slot.slot_id);
      const survivors = pool?.verified.length ?? slot.verified_pool?.length ?? 0;
      recordFamilyCoverage({
        garment: slot.garment,
        survivorsAfterDrops: survivors,
      });
      const coverage_gap = isCoverageGapPool(survivors);
      return {
        ...slot,
        verified_pool: pool?.verified ?? slot.verified_pool,
        overflow_items: pool?.getOverflow() ?? slot.overflow_items,
        thin_slot: Boolean(pool?.thin || slot.thin_slot || coverage_gap),
        coverage_gap,
      };
    });

    if (FASHION_PROVISIONAL_RACK_ENABLED && params.onProvisional) {
      const provisional = buildProvisionalPresentation({
        plan,
        slots,
        pools,
      });
      if (provisional) {
        params.onPhase?.({
          line: "Hanging verified pieces while I finish styling",
          previewImages: verifiedUrlsFromSlots(slots),
        });
        params.onProvisional({ curation: provisional });
      }
    }

    // Prefetch/resize finalist images while provisional renders + profile loads.
    try {
      const { prefetchCurationImageUrls } = await import(
        "../curation/curation-images"
      );
      const { imageBudgetForSlot } = await import("../curation/deliverables");
      const prefetchUrls: string[] = [];
      for (const slot of slots) {
        const planSlot = plan.slots.find((p) => p.slot_id === slot.slot_id);
        if (!planSlot) continue;
        const budget = imageBudgetForSlot({
          mode: plan.mode,
          role: planSlot.role,
        });
        const ranked = [...(slot.verified_pool ?? [])].sort(
          (a, b) => (b.score?.final ?? 0) - (a.score?.final ?? 0),
        );
        for (const c of ranked.slice(0, budget)) {
          const url = c.media_urls?.[0] ?? c.image_urls?.[0];
          if (url) prefetchUrls.push(url);
        }
      }
      prefetchCurationImageUrls(prefetchUrls, params.signal);
    } catch {
      /* non-fatal */
    }

    const tasteSignals =
      params.tasteSignals ??
      params.profile.positiveSignals.map((s) => ({
        attribute_type: "style",
        attribute_value: s,
        polarity: 1,
      }));

    let recipientProfile = params.recipientProfile;
    if (!recipientProfile?.trim() && params.userId && plan.brief.recipient_person_id) {
      const { buildRecipientProfileBlockForPlanner } = await import(
        "../search-planner/recipient-profile"
      );
      recipientProfile = await buildRecipientProfileBlockForPlanner({
        userId: params.userId,
        recipientPersonId: plan.brief.recipient_person_id,
        guestSnapshot: params.guestSnapshot,
      });
    }

    const survivorThumbs = (() => {
      const verified = verifiedUrlsFromSlots(slots);
      return verified.length > 0 ? verified : previewUrlsFromSlots(slots);
    })();
    params.onPhase?.({
      line: "Choosing what I’d actually put on you",
      previewImages: survivorThumbs,
      droppedImages: droppedUrlsFromSlots(slots),
    });
    const curationStarted = Date.now();
    const preCurationElapsed = curationStarted - started;
    // Unused pre-curation pocket rolls into Stage A; earmark is the floor.
    const unusedPreCuration = Math.max(
      0,
      preCurationPocketMs - preCurationElapsed,
    );
    const earmarkRemainingMs = stageAEarmarkMs + unusedPreCuration;
    // Quality: always full vision. Earmark is observability only.
    const rung = chooseStageARung(earmarkRemainingMs);

    recordPipelineEvent({
      traceId: params.traceId,
      stage: "turn_budget",
      payload: {
        pre_curation_elapsed_ms: preCurationElapsed,
        pre_curation_pocket_ms: preCurationPocketMs,
        pre_curation_overrun: preCurationElapsed > preCurationPocketMs,
        stage_a_earmark_ms: stageAEarmarkMs,
        earmark_remaining_ms: earmarkRemainingMs,
        rung,
        // Never "skip" — skip deleted from vocabulary (v1.1).
        skip_reason: null,
      },
    });
    if (preCurationElapsed > preCurationPocketMs) {
      logAiChat("warn", "fashion_pre_curation_pocket_overrun", {
        traceId: params.traceId,
        elapsed_ms: preCurationElapsed,
        pocket_ms: preCurationPocketMs,
        rung,
      });
    }

    const curationResult = await runFashionCuration({
      traceId: params.traceId,
      plan,
      slots: slots.map((s) => ({
        slot_id: s.slot_id,
        garment: s.garment,
        verified_pool: s.verified_pool,
        overflow_items: s.overflow_items,
        thin_slot: s.thin_slot,
        coverage_gap: s.coverage_gap,
        curator_exclusions: s.curator_exclusions,
        brand_status: s.brand_status ?? plan.slots.find((p) => p.slot_id === s.slot_id)?.brand_status,
        brand_sanity_note: s.brand_sanity_note,
        brand_confirmed_count: s.brand_confirmed_count,
      })),
      pools,
      tasteSignals,
      budget_assembly: plan.budget_allocation?.budget_assembly,
      budget_tension,
      budget_interpretation: plan.budget_allocation?.budget_interpretation,
      recipientRelation: params.recipientRelation,
      department:
        plan.brief.knowledge_state?.department ?? plan.brief.department_scope,
      recipientProfile,
      excludedRefs: params.excludedRefs,
      signal: params.signal,
      // Hang-safety ceiling only — never half-images / text-only / deterministic
      // from clock pressure (that path skipped visual department vetoes).
      timeoutMs: CURATION_STAGE_A_HARD_MS,
      createMessage: params.createMessage
        ? async (curationParams) =>
            params.createMessage!({
              traceId: curationParams.traceId,
              stage: "curation",
              model: "curation-mock",
              systemPrompt: curationParams.systemPrompt,
              inputMessages: curationParams.userMessages,
              signal: curationParams.signal,
            })
        : undefined,
      resolveCurationMessage: params.resolveCurationMessage,
    });
    curation = curationResult.presentation;
    curation_ms = Date.now() - curationStarted;
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "curation",
      payload: {
        ms: curation_ms,
        fallback: curation?.meta?.fallback ?? false,
        looks_delivered: curation?.looks?.length ?? 0,
        rung,
        outfit_looks_missing:
          plan.mode === "outfit" && (curation?.looks?.length ?? 0) === 0,
      },
    });

    if (params.searchId && params.userId && pools) {
      const catalogContext = buildCatalogCallContext(
        { ships_to: { country: params.profile.countryCode } },
        {
          currency: params.profile.currency,
          language: params.profile.language,
        },
      );
      const contexts = new Map(
        plan.slots.map((planSlot) => [
          planSlot.slot_id,
          {
            slot: planSlot,
            brief: plan.brief,
            recipientFacts: params.recipientFacts ?? [],
            accessToken: params.accessToken,
            catalogContext,
            traceId: params.traceId,
          },
        ]),
      );
      const searchId = params.searchId;
      const userId = params.userId;
      const traceId = params.traceId;
      const poolsToPersist = pools;
      // Persist off the hot path — UI already has curated racks.
      scheduleDetachedWork(() => {
        void persistAllSlotPools({
          searchId,
          userId,
          pools: poolsToPersist,
          contexts,
        }).catch((err) => {
          logAiChat("warn", "fashion_pool_persist_failed", {
            traceId,
            searchId,
            error: String(err).slice(0, 200),
          });
        });
      });
    }
  } else {
    logAiChat("warn", "fashion_catalog_hydration_skipped", {
      traceId: params.traceId,
      reason:
        params.accessToken == null
          ? "missing_access_token"
          : "missing_profile",
    });
  }

  logAiChat("info", "fashion_catalog_plan_complete", {
    mode: plan.mode,
    slot_count: slots.length,
    total_products: slots.reduce((n, s) => n + s.counts.unique_products, 0),
    verified_pool: slots.reduce((n, s) => n + (s.verified_pool?.length ?? 0), 0),
    brand_statuses: plan.slots.map((s) => s.brand_status),
    timing_ms,
    normalize_ms: initialProcessed.normalize_ms,
    hard_drop_ms: initialProcessed.hard_drop_ms,
    scoring_ms: initialProcessed.scoring_ms,
    hydration_ms,
    curation_ms,
    budget_tension: budget_tension?.severity,
    curation_fallback: curation?.meta.fallback,
  });

  return {
    version: 1,
    plan,
    slots,
    timing_ms,
    brand_narration: brandNarration ?? undefined,
    budget_assembly: plan.budget_allocation?.budget_assembly,
    budget_interpretation: plan.budget_allocation?.budget_interpretation,
    budget_tension,
    curation,
    curation_ms,
  };
}

export function fashionCatalogSearchToMetadata(
  result: FashionCatalogSearchResult,
  extras?: { trace_id?: string },
): MessageFashionCatalogSearchMetaV1 {
  return {
    version: 1,
    slots: result.slots.map((slot) => ({
      slot_id: slot.slot_id,
      garment: slot.garment,
      dropped: slot.dropped,
      curator_exclusions: slot.curator_exclusions,
      query_variants_used: slot.query_variants_used,
      counts: slot.counts,
      verified_pool: slimVerifiedPoolForMetadata(slot.verified_pool),
      overflow_items: slot.overflow_items,
      thin_slot: slot.thin_slot,
      brand_status: slot.brand_status,
      brand_sanity_note: slot.brand_sanity_note,
      brand_confirmed_count: slot.brand_confirmed_count,
      market_prices: slot.market_prices,
      guard_band_count: slot.guard_band_count,
      enforced_max: slot.enforced_max,
      guard_max: slot.guard_max,
    })),
    timing_ms: result.timing_ms,
    brand_narration: result.brand_narration,
    trace_id: extras?.trace_id,
    budget_assembly: result.budget_assembly,
    budget_interpretation: result.budget_interpretation,
    budget_tension: result.budget_tension,
    curation: result.curation
      ? { version: 1 as const, ...result.curation, trace_id: extras?.trace_id }
      : undefined,
  };
}

function slimVerifiedPoolForMetadata(
  pool: FashionSlotCatalogResult["verified_pool"],
): MessageFashionCatalogSearchMetaV1["slots"][number]["verified_pool"] {
  if (!pool?.length) return undefined;
  return pool.map(
    ({ detail, raw, ...candidate }) => candidate,
  ) as MessageFashionCatalogSearchMetaV1["slots"][number]["verified_pool"];
}
