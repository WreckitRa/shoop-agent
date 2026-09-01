import { logAiChat } from "@/lib/ai-chat/observability";
import { createAbortScope } from "@/lib/ai-chat/abort-scope";
import { extractCatalogImageUrl } from "@/lib/shopify/catalog";
import { applyHardDropsForSlots } from "../hard-drops/orchestrator";
import { hydrateCatalogSlots } from "../hydration/orchestrator";
import { createConcurrencyGate } from "../hydration/concurrency-gate";
import { HYDRATION_MAX_CONCURRENCY } from "../hydration/config";
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
  budgetProceedNote,
  ensureLoosenBudgetChip,
  type BudgetRaiseAsk,
} from "../budget/budget-raise-ask";
import { recordPipelineEvent } from "../observability/trace";
import {
  emptyStageLatency,
  laneMixFromRatings,
  mcpHitsFromQueryLogs,
  mcpQueryDurationStats,
  type SearchFunnelSlotCounts,
  type SearchObservability,
  type SearchSlotLaneLog,
} from "../observability/search-observability";
import { tasteFitForHeroes } from "../scoring/taste-fit";
import { applyTasteRerankToSlots, hashTasteSignals } from "../scoring/taste-rerank";
import { isTasteScoringEnabled } from "../scoring/weights";
import { loadRecipientTasteFitSignals } from "./profile";
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
import { persistAllSlotPools, loadPoolsForSearch } from "../hydration/pool-persistence";
import { createSlotPool } from "../hydration/pool";
import {
  attachReusedVerified,
  bindReusedSlot,
  familyKeyForSlot,
  indexPoolsByFamily,
  reusedBenchIsAssembled,
} from "./reuse-slots";
import { buildCatalogCallContext } from "@/lib/shopify/catalog";
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
  funnel_mid: Array<{
    slot_id: string;
    normalized: number;
    hard_drop_survivors: number;
    scored: number;
  }>;
}> {
  const normalized = await normalizeCatalogSearchSlots({
    traceId: params.traceId,
    slots: params.slots,
    signal: params.signal,
  });
  const normalizedCounts = new Map(
    normalized.slots.map((s) => [s.slot_id, s.products.length]),
  );

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
  const survivorCounts = new Map(
    hardDropped.slots.map((s) => [s.slot_id, s.products.length]),
  );

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
    funnel_mid: slots.map((s) => ({
      slot_id: s.slot_id,
      normalized: normalizedCounts.get(s.slot_id) ?? s.products.length,
      hard_drop_survivors: survivorCounts.get(s.slot_id) ?? s.products.length,
      scored: s.products.length,
    })),
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
  let total_to_provisional_ms: number | null = null;
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

  const refinementMode = params.refinement?.mode ?? "full";
  const reuseVerifiedBySlot = new Map<
    string,
    import("../hydration/types").HydratedCandidate[]
  >();
  const previousPoolRows =
    refinementMode !== "full" &&
    params.refinement?.previousSearchId &&
    params.userId
      ? await loadPoolsForSearch({
          searchId: params.refinement.previousSearchId,
          userId: params.userId,
        })
      : [];
  if (previousPoolRows.length) {
    const { seedCurationImageCache } = await import(
      "../curation/curation-images"
    );
    for (const row of previousPoolRows) {
      if (row.state.prepared_images) {
        seedCurationImageCache(row.state.prepared_images);
      }
    }
  }
  const reusedByFamily = indexPoolsByFamily(previousPoolRows);
  const canRescore =
    refinementMode === "rescore-only" && reusedByFamily.size > 0;
  const effectiveMode =
    refinementMode !== "full" && reusedByFamily.size === 0
      ? "full"
      : refinementMode;
  if (
    refinementMode !== "full" &&
    effectiveMode === "full" &&
    params.refinement?.previousSearchId
  ) {
    logAiChat("info", "fashion_refinement_reuse_miss", {
      traceId: params.traceId,
      mode: refinementMode,
      previous_search_id: params.refinement.previousSearchId,
    });
  }

  if (canRescore && params.onProvisional) {
    const earlySlots = plan.slots.map((planSlot) => {
      const reused = reusedByFamily.get(familyKeyForSlot(planSlot.garment));
      if (!reused) {
        return {
          slot_id: planSlot.slot_id,
          garment: planSlot.garment,
          products: [],
          query_variants_used: [],
          counts: { unique_products: 0, per_variant: [], reformulated: false },
          query_logs: [],
        } satisfies FashionSlotCatalogResult;
      }
      const bound = bindReusedSlot(planSlot, reused.slot);
      reuseVerifiedBySlot.set(planSlot.slot_id, reused.verified);
      return { ...bound, verified_pool: reused.verified };
    });
    const provisional = buildProvisionalPresentation({
      plan,
      slots: earlySlots,
      traceId: params.traceId,
    });
    if (provisional) {
      params.onProvisional({ curation: provisional });
      if (total_to_provisional_ms == null) {
        total_to_provisional_ms = Date.now() - started;
      }
    }
  }

  const fanOutStarted = Date.now();
  const settled = await Promise.allSettled(
    plan.slots.map(async (slot) => {
      const family = familyKeyForSlot(slot.garment);
      const reused = effectiveMode !== "full" ? reusedByFamily.get(family) : undefined;
      if (reused && (canRescore || effectiveMode === "partial")) {
        reuseVerifiedBySlot.set(slot.slot_id, reused.verified);
        return bindReusedSlot(slot, reused.slot);
      }
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
  const fan_out_ms = Date.now() - fanOutStarted;
  const retrievalBySlot = new Map(
    slots.map((s) => [
      s.slot_id,
      {
        garment: s.garment,
        mcp_hits: mcpHitsFromQueryLogs(s.query_logs),
        deduped: s.products.length,
      },
    ]),
  );

  const timing_ms = Date.now() - started;

  let brandNarration: string | null = null;

  if (brandsListed.length && !canRescore) {
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

  const liftResult = canRescore
    ? {
        plan,
        slots: initialProcessed.slots,
        hardDropMetrics: initialProcessed.hardDropMetrics,
        liftedSlots: new Set<string>(),
        preLiftSurvivorCounts: new Map<string, number>(),
        preLiftBudgetDrops: new Map<string, number>(),
      }
    : await runBudgetLiftRetries({
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

  const skipHydrateForReuse = reusedBenchIsAssembled({
    mode: effectiveMode === "rescore-only" ? "rescore-only" : "full",
    reusedByFamily,
    planSlots: plan.slots,
  });

  let hydration_ms = 0;
  let taste_rerank_ms = 0;
  let tasteRerankStats = {
    calls: 0,
    aborted: 0,
    rated: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_hits: 0,
  };
  let curation_ms = 0;
  let stage_a_ms = 0;
  let stage_b_ms = 0;
  let image_prep_ms = 0;
  let curation;
  let curationRegistry: import("../curation/types").CurationRefRegistry | undefined;
  let pools: Map<string, SlotPool> | undefined;

  if (params.accessToken != null && params.profile != null) {
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

    const tasteSignals =
      params.tasteSignals ??
      params.profile.positiveSignals.map((s) => ({
        attribute_type: "style",
        attribute_value: s,
        polarity: 1,
      }));
    const signalsHash = hashTasteSignals(
      tasteSignals.map((s) => ({
        signal_type: s.attribute_type,
        value: s.attribute_value,
        polarity: s.polarity,
      })),
    );

    const { isCoverageGapPool, recordFamilyCoverage } = await import(
      "./family-coverage"
    );

    const attachCoverage = (slot: FashionSlotCatalogResult) => {
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
    };

    if (skipHydrateForReuse && params.accessToken) {
      const tasteStarted = Date.now();
      if (isTasteScoringEnabled()) {
        const reranked = await applyTasteRerankToSlots({
          slots,
          planSlots: plan.slots,
          brief: plan.brief,
          recipientFacts: params.recipientFacts ?? [],
          recipientProfile: recipientProfile ?? "",
          recipientPersonId: plan.brief.recipient_person_id,
          signalsHash,
          signal: params.signal,
          traceId: params.traceId,
          createMessage: params.createMessage,
        });
        slots = reranked.slots;
        tasteRerankStats = reranked.stats;
      }
      taste_rerank_ms = Date.now() - tasteStarted;

      slots = attachReusedVerified({ slots, reuseVerifiedBySlot });
      pools = new Map();
      for (const slot of slots) {
        const planSlot = plan.slots.find((p) => p.slot_id === slot.slot_id);
        if (!planSlot) continue;
        const verified = slot.verified_pool ?? [];
        const verifiedIds = new Set(verified.map((c) => c.id));
        const pool = createSlotPool({
          slot: planSlot,
          scoredProducts: slot.products,
          brief: plan.brief,
          recipientFacts: params.recipientFacts ?? [],
          accessToken: params.accessToken,
          skipInitialFill: true,
          initialState: {
            verified,
            reserve: slot.products.filter((p) => !verifiedIds.has(p.id)),
            dead: [],
            thin: verified.length < 3,
          },
        });
        pools.set(slot.slot_id, pool);
      }
      slots = slots.map(attachCoverage);
    } else {
      params.onPhase?.({
        line: "Checking stock and your size",
        previewImages: previewUrlsFromSlots(slots),
        droppedImages: droppedUrlsFromSlots(slots),
      });
      const hydrateGate = createConcurrencyGate(HYDRATION_MAX_CONCURRENCY);
      const nextSlots = [...slots];
      const nextPools = new Map<string, SlotPool>();
      const tasteParts: Array<{ ms: number; stats: typeof tasteRerankStats }> =
        [];
      const hydrateStarts: number[] = [];
      const hydrateEnds: number[] = [];

      await Promise.all(
        nextSlots.map(async (slot, idx) => {
          let working = slot;
          if (isTasteScoringEnabled()) {
            const t0 = Date.now();
            const reranked = await applyTasteRerankToSlots({
              slots: [working],
              planSlots: plan.slots,
              brief: plan.brief,
              recipientFacts: params.recipientFacts ?? [],
              recipientProfile: recipientProfile ?? "",
              recipientPersonId: plan.brief.recipient_person_id,
              signalsHash,
              signal: params.signal,
              traceId: params.traceId,
              createMessage: params.createMessage,
            });
            tasteParts.push({ ms: Date.now() - t0, stats: reranked.stats });
            working = reranked.slots[0]!;
          }
          const h0 = Date.now();
          hydrateStarts.push(h0);
          const hydrated = await hydrateCatalogSlots({
            traceId: params.traceId,
            plan,
            slots: [working],
            recipientFacts: params.recipientFacts ?? [],
            accessToken: params.accessToken!,
            profile: params.profile!,
            signal: params.signal,
            abortScope,
            concurrencyGate: hydrateGate,
            ...(reuseVerifiedBySlot.size ? { reuseVerifiedBySlot } : {}),
          });
          hydrateEnds.push(Date.now());
          nextSlots[idx] = hydrated.slots[0]!;
          for (const [id, pool] of hydrated.pools) nextPools.set(id, pool);
        }),
      );

      taste_rerank_ms = tasteParts.reduce((n, p) => Math.max(n, p.ms), 0);
      tasteRerankStats = tasteParts.reduce(
        (acc, p) => ({
          calls: acc.calls + p.stats.calls,
          aborted: acc.aborted + p.stats.aborted,
          rated: acc.rated + p.stats.rated,
          input_tokens: acc.input_tokens + p.stats.input_tokens,
          output_tokens: acc.output_tokens + p.stats.output_tokens,
          cache_hits: acc.cache_hits + p.stats.cache_hits,
        }),
        tasteRerankStats,
      );
      hydration_ms =
        hydrateStarts.length > 0
          ? Math.max(...hydrateEnds) - Math.min(...hydrateStarts)
          : 0;
      slots = nextSlots;
      pools = nextPools;
      slots = slots.map(attachCoverage);
    }

    const budgetRaiseAsk: BudgetRaiseAsk | null = params.skipBudgetRaiseAsk
      ? null
      : buildBudgetRaiseAskFromContext({
          plan,
          tension: budget_tension,
          slots: slots.map((s) => ({
            slot_id: s.slot_id,
            garment: s.garment,
            market_prices: s.market_prices,
            verified_count: s.verified_pool?.length ?? 0,
          })),
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
        verified_pool: slots.reduce(
          (n, s) => n + (s.verified_pool?.length ?? 0),
          0,
        ),
        brand_statuses: plan.slots.map((s) => s.brand_status),
        timing_ms,
        normalize_ms: initialProcessed.normalize_ms,
        hard_drop_ms: initialProcessed.hard_drop_ms,
        scoring_ms: initialProcessed.scoring_ms,
        hydration_ms,
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
        search_observability: await assembleCatalogObservability({
          plan,
          slots,
          retrievalBySlot,
          funnelMid: initialProcessed.funnel_mid,
          latency: {
            fan_out_ms,
            normalize_ms: initialProcessed.normalize_ms,
            hard_drops_ms: initialProcessed.hard_drop_ms,
            score_ms: initialProcessed.scoring_ms,
            taste_rerank_ms,
            hydrate_ms: hydration_ms,
            image_prep_ms: 0,
            total_to_final_ms: Date.now() - started,
          },
          userId: params.userId,
          guestSnapshot: params.guestSnapshot,
          tasteSignals: params.tasteSignals,
          traceId: params.traceId,
          refinement_mode: effectiveMode,
        }),
      };
    }

    if (FASHION_PROVISIONAL_RACK_ENABLED && params.onProvisional) {
      const provisional = buildProvisionalPresentation({
        plan,
        slots,
        pools,
      });
      if (provisional) {
        params.onPhase?.({
          line: skipHydrateForReuse
            ? "Choosing what I’d actually put on you"
            : "Hanging verified pieces while I finish styling",
          previewImages: verifiedUrlsFromSlots(slots),
        });
        params.onProvisional({ curation: provisional });
        if (total_to_provisional_ms == null) {
          total_to_provisional_ms = Date.now() - started;
        }
      }
    }

    if (!skipHydrateForReuse) {
    // Prefetch/resize finalist images while provisional renders + profile loads.
    try {
      const { prefetchCurationImageUrls } = await import(
        "../curation/curation-images"
      );
      const { imageBudgetForSlot } = await import("../curation/deliverables");
      const { pickImagedIds } = await import("../curation/refs");
      const prefetchUrls: string[] = [];
      for (const slot of slots) {
        const planSlot = plan.slots.find((p) => p.slot_id === slot.slot_id);
        if (!planSlot) continue;
        const budget = imageBudgetForSlot({
          mode: plan.mode,
          role: planSlot.role,
          brief: plan.brief,
        });
        const ranked = [...(slot.verified_pool ?? [])].sort(
          (a, b) => (b.score?.final ?? 0) - (a.score?.final ?? 0),
        );
        const imagedIds = pickImagedIds({
          candidates: ranked,
          budget,
          anchor: plan.brief.preference_anchor,
        });
        for (const c of ranked) {
          if (!imagedIds.has(c.id)) continue;
          const url = c.media_urls?.[0] ?? c.image_urls?.[0];
          if (url) prefetchUrls.push(url);
        }
      }
      prefetchCurationImageUrls(prefetchUrls, params.signal);
    } catch {
      /* non-fatal */
    }
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
    if (
      curation &&
      (budget_tension?.severity === "tight" ||
        budget_tension?.severity === "infeasible")
    ) {
      const assembly = plan.budget_allocation?.budget_assembly;
      const stated = assembly?.total_max;
      if (stated && stated > 0) {
        const narration = curation.narration;
        if (!narration.budget_note?.trim()) {
          narration.budget_note = budgetProceedNote(
            stated,
            assembly?.currency || "USD",
          );
        }
        narration.next_step_offer = ensureLoosenBudgetChip(
          narration.next_step_offer ?? {
            text: "Want me to tweak a piece, or pull another round from here?",
            chips: ["Swap a piece", "Bolder on top", "2 more looks"],
          },
        );
      }
    }
    curationRegistry = curationResult.registry;
    curation_ms = Date.now() - curationStarted;
    image_prep_ms = curationResult.image_prep_ms ?? 0;
    stage_a_ms = curationResult.stage_a_ms ?? curation_ms;
    stage_b_ms = curationResult.stage_b_ms ?? 0;
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
            plan,
            recipientFacts: params.recipientFacts ?? [],
            accessToken: params.accessToken,
            catalogContext,
            traceId: params.traceId,
          },
        ]),
      );
      const survivorsBySlot = new Map(
        slots.map((s) => [s.slot_id, s.products]),
      );
      try {
        await persistAllSlotPools({
          searchId: params.searchId,
          userId: params.userId,
          pools,
          contexts,
          survivorsBySlot,
        });
      } catch (err) {
        logAiChat("warn", "fashion_pool_persist_failed", {
          traceId: params.traceId,
          searchId: params.searchId,
          error: String(err).slice(0, 200),
        });
      }
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

  const search_observability = await assembleCatalogObservability({
    plan,
    slots,
    retrievalBySlot,
    funnelMid: initialProcessed.funnel_mid,
    pools,
    registry: curationRegistry,
    presentation: curation,
    latency: {
      fan_out_ms,
      normalize_ms: initialProcessed.normalize_ms,
      hard_drops_ms: initialProcessed.hard_drop_ms,
      score_ms: initialProcessed.scoring_ms,
      taste_rerank_ms,
      hydrate_ms: hydration_ms,
      image_prep_ms,
      stage_a_ms,
      stage_b_ms,
      total_to_provisional_ms,
      total_to_final_ms: Date.now() - started,
    },
    userId: params.userId,
    guestSnapshot: params.guestSnapshot,
    tasteSignals: params.tasteSignals,
    traceId: params.traceId,
    tasteRerank: tasteRerankStats,
    refinement_mode: effectiveMode,
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
    search_observability,
  };
}

async function assembleCatalogObservability(params: {
  plan: FashionSearchPlan;
  slots: FashionSlotCatalogResult[];
  retrievalBySlot: Map<
    string,
    { garment: string; mcp_hits: number; deduped: number }
  >;
  funnelMid: Array<{
    slot_id: string;
    normalized: number;
    hard_drop_survivors: number;
    scored: number;
  }>;
  pools?: Map<string, SlotPool>;
  registry?: import("../curation/types").CurationRefRegistry;
  presentation?: import("../curation/types").FashionCurationPresentation;
  latency: Partial<import("../observability/search-observability").SearchStageLatency>;
  userId?: string;
  guestSnapshot?: import("../local/store").GuestFashionMemorySnapshot;
  tasteSignals?: SearchFashionCatalogPlanParams["tasteSignals"];
  traceId?: string | null;
  tasteRerank?: {
    calls: number;
    aborted: number;
    rated: number;
    input_tokens: number;
    output_tokens: number;
    cache_hits: number;
  };
  refinement_mode?: import("../intake/refinement-mode").RefinementMode;
}): Promise<SearchObservability> {
  const midBySlot = new Map(params.funnelMid.map((m) => [m.slot_id, m]));
  const heroesBySlot = new Map<string, number>();
  for (const pick of params.presentation?.tiers.picks ?? []) {
    heroesBySlot.set(pick.slot_id, (heroesBySlot.get(pick.slot_id) ?? 0) + 1);
  }
  const imagedBySlot = new Map<string, number>();
  if (params.registry) {
    for (const entry of params.registry.values()) {
      if (!entry.image_shown) continue;
      imagedBySlot.set(
        entry.slot_id,
        (imagedBySlot.get(entry.slot_id) ?? 0) + 1,
      );
    }
  }

  const funnel: SearchFunnelSlotCounts[] = params.slots.map((slot) => {
    const retrieval = params.retrievalBySlot.get(slot.slot_id);
    const mid = midBySlot.get(slot.slot_id);
    return {
      slot_id: slot.slot_id,
      garment: slot.garment,
      mcp_hits: retrieval?.mcp_hits ?? 0,
      deduped: retrieval?.deduped ?? slot.counts.unique_products,
      normalized: mid?.normalized ?? retrieval?.deduped ?? 0,
      hard_drop_survivors: mid?.hard_drop_survivors ?? slot.products.length,
      scored: mid?.scored ?? slot.products.length,
      shortlisted: params.pools?.get(slot.slot_id)?.target ?? 0,
      hydrated_verified: slot.verified_pool?.length ?? 0,
      imaged: imagedBySlot.get(slot.slot_id) ?? 0,
      heroes: heroesBySlot.get(slot.slot_id) ?? 0,
    };
  });

  recordPipelineEvent({
    traceId: params.traceId,
    stage: "search_funnel",
    payload: { slots: funnel },
  });

  const signals = params.userId
    ? await loadRecipientTasteFitSignals({
        userId: params.userId,
        recipientPersonId: params.plan.brief.recipient_person_id,
        guestSnapshot: params.guestSnapshot,
      })
    : (params.tasteSignals ?? []).map((s) => ({
        signal_type: s.attribute_type,
        value: s.attribute_value,
        polarity: s.polarity,
      }));

  const heroRows: Array<{
    product_id: string;
    slot_id: string;
    product: FashionSlotCatalogProduct;
  }> = [];
  for (const pick of params.presentation?.tiers.picks ?? []) {
    const entry = params.registry?.get(pick.ref);
    const product = entry?.candidate ??
      params.slots
        .flatMap((s) => s.verified_pool ?? [])
        .find((p) => p.id === pick.id);
    if (!product) continue;
    heroRows.push({
      product_id: pick.id,
      slot_id: pick.slot_id,
      product,
    });
  }

  const taste_fit = tasteFitForHeroes({
    heroes: heroRows,
    signals,
    preference_anchor: params.plan.brief.preference_anchor ?? null,
  });

  const heroIdsBySlot = new Map<string, Set<string>>();
  for (const h of heroRows) {
    const set = heroIdsBySlot.get(h.slot_id) ?? new Set<string>();
    set.add(h.product_id);
    heroIdsBySlot.set(h.slot_id, set);
  }
  const imagedIdsBySlot = new Map<string, Set<string>>();
  if (params.registry) {
    for (const entry of params.registry.values()) {
      if (!entry.image_shown) continue;
      const set = imagedIdsBySlot.get(entry.slot_id) ?? new Set<string>();
      set.add(entry.product_id);
      imagedIdsBySlot.set(entry.slot_id, set);
    }
  }
  const lanes_by_slot: SearchSlotLaneLog[] = params.slots.map((slot) => {
    const verified = slot.verified_pool ?? [];
    const imagedIds = imagedIdsBySlot.get(slot.slot_id);
    const imaged = imagedIds
      ? verified.filter((p) => imagedIds.has(p.id))
      : [];
    const heroIds = heroIdsBySlot.get(slot.slot_id);
    const heroes = heroIds
      ? verified.filter((p) => heroIds.has(p.id))
      : [];
    return {
      slot_id: slot.slot_id,
      garment: slot.garment,
      verified: laneMixFromRatings(verified),
      imaged: laneMixFromRatings(imaged),
      heroes: laneMixFromRatings(heroes),
    };
  });

  recordPipelineEvent({
    traceId: params.traceId,
    stage: "taste_fit",
    payload: {
      preference_anchor: taste_fit.preference_anchor,
      mean: taste_fit.mean,
      heroes: taste_fit.heroes,
      lanes_by_slot,
    },
  });

  const observability: SearchObservability = {
    version: 1,
    funnel,
    latency: emptyStageLatency({
      fan_out_ms: params.latency.fan_out_ms ?? 0,
      normalize_ms: params.latency.normalize_ms ?? 0,
      hard_drops_ms: params.latency.hard_drops_ms ?? 0,
      score_ms: params.latency.score_ms ?? 0,
      taste_rerank_ms: params.latency.taste_rerank_ms ?? 0,
      hydrate_ms: params.latency.hydrate_ms ?? 0,
      image_prep_ms: params.latency.image_prep_ms ?? 0,
      stage_a_ms: params.latency.stage_a_ms ?? 0,
      stage_b_ms: params.latency.stage_b_ms ?? 0,
      total_to_provisional_ms: params.latency.total_to_provisional_ms ?? null,
      total_to_final_ms: params.latency.total_to_final_ms ?? null,
    }),
    cost: { usd: 0, by_stage: [] },
    taste_fit,
    taste_rerank: params.tasteRerank,
    lanes_by_slot,
    refinement_mode: params.refinement_mode ?? "full",
    mcp_query: mcpQueryDurationStats(params.slots.flatMap((s) => s.query_logs)),
  };

  recordPipelineEvent({
    traceId: params.traceId,
    stage: "search_latency",
    payload: observability.latency as unknown as Record<string, unknown>,
  });

  return observability;
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
    search_observability: result.search_observability,
    brief: result.plan?.brief,
    plan_current_date: result.plan?.currentDate,
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
