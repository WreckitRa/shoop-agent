import { buildCatalogCallContext } from "@/lib/shopify/catalog";
import { logAiChat } from "@/lib/ai-chat/observability";
import { createAbortScope, type AbortScope } from "@/lib/ai-chat/abort-scope";
import { recordPipelineEvent } from "../observability/trace";
import type { FashionSearchPlan } from "../search-planner/types";
import type { FashionFactRow } from "../types";
import type {
  FashionCatalogSearchResult,
  FashionSearchProfile,
  FashionSlotCatalogResult,
} from "../catalog-search/types";
import { HYDRATION_CALL_TIMEOUT_MS, HYDRATION_MAX_CONCURRENCY } from "./config";
import { createConcurrencyGate } from "./concurrency-gate";
import { createSlotPool, type SlotPoolImpl } from "./pool";
import type { HydrationMetrics, SlotPool } from "./types";

export type HydrateCatalogSlotsParams = {
  traceId?: string | null;
  plan: FashionSearchPlan;
  slots: FashionSlotCatalogResult[];
  recipientFacts: FashionFactRow[];
  accessToken: string;
  profile: FashionSearchProfile;
  signal?: AbortSignal;
  abortScope?: AbortScope;
  /** Already-verified candidates from a prior search (refinement reuse). */
  reuseVerifiedBySlot?: Map<string, import("./types").HydratedCandidate[]>;
};

export type HydrateCatalogSlotsResult = {
  slots: FashionSlotCatalogResult[];
  pools: Map<string, SlotPool>;
  metrics: HydrationMetrics[];
};

function buildMetrics(pool: SlotPoolImpl, ms: number): HydrationMetrics {
  const waveStats = pool.getWaveStats();
  const killed = {
    size_out_of_stock: 0,
    size_not_offered: 0,
    gone: 0,
    department_mismatch: 0,
  };
  for (const d of pool.dead) {
    if (d.cause in killed) killed[d.cause as keyof typeof killed] += 1;
  }

  const size_status_counts = { confirmed: 0, converted: 0, unknown: 0 };
  let hydration_failed = 0;
  for (const v of pool.verified) {
    size_status_counts[v.size_status] += 1;
  }
  for (const d of pool.dead) {
    if (d.cause === "hydration_failed") hydration_failed += 1;
  }

  return {
    shortlisted: pool.target,
    waves: pool.getWaves(),
    killed,
    hydration_failed,
    size_status_counts,
    verified_final: pool.verified.length,
    overflow_count: pool.getOverflow().length,
    thin: pool.thin,
    ms,
  };
}

function emitHydrationEvent(
  traceId: string | null | undefined,
  slot: FashionSlotCatalogResult,
  metrics: HydrationMetrics,
  waveStats: ReturnType<SlotPoolImpl["getWaveStats"]>,
  pool: SlotPoolImpl,
) {
  recordPipelineEvent({
    traceId,
    stage: "hydration",
    payload: {
      slot_id: slot.slot_id,
      garment: slot.garment,
      ...metrics,
    },
  });

  const attempted = waveStats.reduce((n, w) => n + w.attempted, 0);
  const killed = waveStats.reduce((n, w) => n + w.killed, 0);
  const hydrationFailed = waveStats.reduce((n, w) => n + w.hydration_failed, 0);
  const recovered =
    !pool.thin && pool.verified.length >= Math.min(pool.target, pool.options_wanted);

  // Kill-count self-justification: trends ~0 → shrink BENCH_MULTIPLIER; 3–4/slot → buffer earns keep.
  // Only warn when the slot did not recover — wave-1 stampede + wave-2 fill is expected under load.
  if (attempted > 0 && killed / attempted > 0.5) {
    recordPipelineEvent({
      traceId,
      stage: "invariant_warning",
      payload: {
        kind: "hydration_massacre",
        slot_id: slot.slot_id,
        attempted,
        killed,
        recovered,
        thin: pool.thin,
      },
    });
    logAiChat(recovered ? "info" : "warn", "fashion_hydration_massacre", {
      slot_id: slot.slot_id,
      attempted,
      killed,
      recovered,
      thin: pool.thin,
      verified_final: pool.verified.length,
      target: pool.target,
    });
  }
  if (attempted > 0 && hydrationFailed / attempted > 0.3) {
    recordPipelineEvent({
      traceId,
      stage: "invariant_warning",
      payload: {
        kind: "hydration_api_health",
        slot_id: slot.slot_id,
        hydration_failed: hydrationFailed,
        attempted,
        recovered,
      },
    });
    logAiChat(recovered ? "info" : "warn", "fashion_hydration_api_health", {
      traceId,
      slot_id: slot.slot_id,
      garment: slot.garment,
      hydration_failed: hydrationFailed,
      attempted,
      fail_rate: Number((hydrationFailed / attempted).toFixed(2)),
      recovered,
      thin: pool.thin,
      verified_final: pool.verified.length,
      target: pool.target,
      global_concurrency: HYDRATION_MAX_CONCURRENCY,
      timeout_ms: HYDRATION_CALL_TIMEOUT_MS,
      timeout_enabled:
        HYDRATION_CALL_TIMEOUT_MS != null && HYDRATION_CALL_TIMEOUT_MS > 0,
      hint: recovered
        ? "Wave-1 failures recovered via reserve — request concurrency gate should keep this rare"
        : HYDRATION_CALL_TIMEOUT_MS == null
          ? "Slot stayed thin after hydration failures — check fashion_hydration_failed + get_product elapsed_ms"
          : "Many get_product calls hit HYDRATION_CALL_TIMEOUT_MS — usually concurrency stampede, not bad product ids",
    });
  }
}

function attachPoolToSlot(
  slot: FashionSlotCatalogResult,
  pool: SlotPoolImpl,
): FashionSlotCatalogResult {
  return {
    ...slot,
    verified_pool: pool.verified,
    overflow_items: pool.getOverflow(),
    thin_slot: pool.thin || undefined,
  };
}

export async function hydrateCatalogSlots(
  params: HydrateCatalogSlotsParams,
): Promise<HydrateCatalogSlotsResult> {
  const context = buildCatalogCallContext(
    { ships_to: { country: params.profile.countryCode } },
    {
      currency: params.profile.currency,
      language: params.profile.language,
    },
  );

  const abortScope = params.abortScope ?? createAbortScope(params.signal);
  const concurrencyGate = createConcurrencyGate(HYDRATION_MAX_CONCURRENCY);

  const pools = new Map<string, SlotPoolImpl>();
  const metrics: HydrationMetrics[] = [];
  const slotById = new Map(params.slots.map((s) => [s.slot_id, s]));

  const planSlotById = new Map(params.plan.slots.map((s) => [s.slot_id, s]));

  function makePool(slot: FashionSlotCatalogResult): SlotPoolImpl {
    const planSlot = planSlotById.get(slot.slot_id);
    if (!planSlot) {
      throw new Error(`Missing plan slot for ${slot.slot_id}`);
    }
    const reused = params.reuseVerifiedBySlot?.get(slot.slot_id);
    const reusedIds = new Set(reused?.map((c) => c.id) ?? []);
    return createSlotPool({
      slot: planSlot,
      scoredProducts: slot.products,
      brief: params.plan.brief,
      recipientFacts: params.recipientFacts,
      accessToken: params.accessToken,
      context,
      traceId: params.traceId,
      abortScope,
      concurrencyGate,
      ...(reused?.length
        ? {
            initialState: {
              verified: reused,
              reserve: slot.products.filter((p) => !reusedIds.has(p.id)),
              dead: [],
              thin: false,
            },
          }
        : {}),
    });
  }

  async function fillPool(slot: FashionSlotCatalogResult, pool: SlotPoolImpl) {
    if (params.reuseVerifiedBySlot?.has(slot.slot_id)) {
      await pool.ensureShortlist();
    } else {
      await pool.fillToTarget();
    }
  }

  const mode = params.plan.mode;
  const anchorFirst = mode === "outfit" || mode === "capsule";

  if (anchorFirst) {
    const anchorPlanSlots = params.plan.slots.filter((s) => s.role === "anchor");
    const supportPlanSlots = params.plan.slots.filter((s) => s.role === "support");

    for (const planSlot of anchorPlanSlots) {
      const slot = slotById.get(planSlot.slot_id);
      if (!slot) continue;
      const started = Date.now();
      const pool = makePool(slot);
      await fillPool(slot, pool);
      pools.set(slot.slot_id, pool);
      const m = buildMetrics(pool, Date.now() - started);
      metrics.push(m);
      emitHydrationEvent(params.traceId, slot, m, pool.getWaveStats(), pool);
    }

    recordPipelineEvent({
      traceId: params.traceId,
      stage: "hydration_anchor_complete",
      payload: {
        anchor_slots: anchorPlanSlots.map((s) => s.slot_id),
        mode,
      },
    });

    await Promise.all(
      supportPlanSlots.map(async (planSlot) => {
        const slot = slotById.get(planSlot.slot_id);
        if (!slot) return;
        const started = Date.now();
        const pool = makePool(slot);
        await fillPool(slot, pool);
        pools.set(slot.slot_id, pool);
        const m = buildMetrics(pool, Date.now() - started);
        metrics.push(m);
        emitHydrationEvent(params.traceId, slot, m, pool.getWaveStats(), pool);
      }),
    );
  } else {
    await Promise.all(
      params.slots.map(async (slot) => {
        const started = Date.now();
        const pool = makePool(slot);
        await fillPool(slot, pool);
        pools.set(slot.slot_id, pool);
        const m = buildMetrics(pool, Date.now() - started);
        metrics.push(m);
        emitHydrationEvent(params.traceId, slot, m, pool.getWaveStats(), pool);
      }),
    );
  }

  const hydratedSlots = params.slots.map((slot) => {
    const pool = pools.get(slot.slot_id);
    if (!pool) return slot;
    return attachPoolToSlot(slot, pool);
  });

  return { slots: hydratedSlots, pools, metrics };
}

export async function hydrateFashionCatalogResult(
  result: FashionCatalogSearchResult,
  params: Omit<HydrateCatalogSlotsParams, "plan" | "slots">,
): Promise<FashionCatalogSearchResult & HydrateCatalogSlotsResult> {
  const hydrated = await hydrateCatalogSlots({
    ...params,
    plan: result.plan,
    slots: result.slots,
  });
  return { ...result, ...hydrated };
}
