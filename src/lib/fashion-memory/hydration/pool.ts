import type { FashionSearchPlanSlot } from "../search-planner/types";
import type { FashionSearchBrief } from "../router/types";
import type { FashionFactRow } from "../types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { CatalogSearchContext } from "@/lib/shopify/catalog";
import type { AbortScope } from "@/lib/ai-chat/abort-scope";
import { logAiChat } from "@/lib/ai-chat/observability";
import { recipientSizeForGarment } from "../hard-drops/size-match";
import {
  HYDRATION_CALL_TIMEOUT_MS,
  HYDRATION_DEFAULT_OVERFLOW,
  HYDRATION_MAX_CONCURRENCY,
  hydrationInitialWaveSize,
  hydrationTargetCount,
} from "./config";
import {
  HYDRATION_WAVE_HARD_MS,
  HYDRATION_WAVE_TRIPWIRE_MS,
} from "../pipeline-cutoffs";
import type { ConcurrencyGate } from "./concurrency-gate";
import { hydrateCandidate, type HydrateCandidateParams } from "./hydrate-candidate";
import type {
  HydratedCandidate,
  HydrationDeathCause,
  HydrationDeathRecord,
  OverflowItem,
  SlotPool,
} from "./types";

export type CreateSlotPoolParams = {
  slot: FashionSearchPlanSlot;
  scoredProducts: FashionSlotCatalogProduct[];
  brief: FashionSearchBrief;
  recipientFacts: FashionFactRow[];
  accessToken: string;
  context?: CatalogSearchContext;
  traceId?: string | null;
  abortScope?: AbortScope;
  /**
   * Shared across slots in one hydrateCatalogSlots call so parallel support
   * lanes don't multiply HYDRATION_MAX_CONCURRENCY.
   */
  concurrencyGate?: ConcurrencyGate;
  /** Test injection — defaults to live hydrateCandidate. */
  hydrateFn?: (
    params: HydrateCandidateParams,
  ) => Promise<import("./types").HydrateCandidateResult>;
  /** Restore from persisted state — skips shifting verified into reserve. */
  initialState?: {
    verified: HydratedCandidate[];
    reserve: FashionSlotCatalogProduct[];
    dead: HydrationDeathRecord[];
    thin: boolean;
    vetoed?: string[];
  };
  skipInitialFill?: boolean;
  /** Called after every mutation (fill, death). */
  onMutation?: () => void | Promise<void>;
};

type WaveStats = {
  attempted: number;
  killed: number;
  hydration_failed: number;
};

/**
 * Run `worker` over `items` with at most `limit` promises in flight at once.
 * Keeps wave sizing (target/deficit) intact while capping true concurrency so
 * get_product calls don't stampede the catalog API.
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const cap = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  const runners = Array.from({ length: cap }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      await worker(items[idx]!);
    }
  });
  await Promise.all(runners);
}

class SlotPoolImpl implements SlotPool {
  verified: HydratedCandidate[] = [];
  reserve: FashionSlotCatalogProduct[];
  dead: HydrationDeathRecord[] = [];
  readonly in_flight = new Set<string>();
  thin = false;
  readonly target: number;
  readonly options_wanted: number;

  private readonly hydratedIds = new Set<string>();
  private lock: Promise<void> = Promise.resolve();
  private waves = 0;
  private waveStats: WaveStats[] = [];

  constructor(private readonly params: CreateSlotPoolParams) {
    this.options_wanted = params.slot.options_wanted;
    this.target = hydrationTargetCount(params.slot.options_wanted);
    if (params.initialState) {
      this.verified = [...params.initialState.verified];
      this.reserve = [...params.initialState.reserve];
      this.dead = [...params.initialState.dead];
      this.thin = params.initialState.thin;
      for (const c of this.verified) this.hydratedIds.add(c.id);
      for (const d of this.dead) this.hydratedIds.add(d.product_id);
    } else {
      this.reserve = [...params.scoredProducts];
    }
  }

  private async notifyMutation(): Promise<void> {
    await this.params.onMutation?.();
  }

  private runLocked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn);
    this.lock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private popBatch(n: number): FashionSlotCatalogProduct[] {
    const batch: FashionSlotCatalogProduct[] = [];
    while (batch.length < n && this.reserve.length > 0) {
      const next = this.reserve.shift()!;
      if (this.hydratedIds.has(next.id) || this.in_flight.has(next.id)) continue;
      batch.push(next);
    }
    return batch;
  }

  private hydrateParams(product: FashionSlotCatalogProduct): HydrateCandidateParams {
    return {
      traceId: this.params.traceId,
      slot: this.params.slot,
      product,
      brief: this.params.brief,
      recipientFacts: this.params.recipientFacts,
      accessToken: this.params.accessToken,
      context: this.params.context,
      abortScope: this.params.abortScope,
      concurrencyGate: this.params.concurrencyGate,
    };
  }

  private async hydrateOne(product: FashionSlotCatalogProduct): Promise<void> {
    if (this.hydratedIds.has(product.id) || this.in_flight.has(product.id)) return;
    this.in_flight.add(product.id);
    try {
      const hydrate =
        this.params.hydrateFn ??
        ((p: HydrateCandidateParams) => hydrateCandidate(p));
      const result = await hydrate(this.hydrateParams(product));
      this.hydratedIds.add(product.id);
      if (result.outcome === "verified") {
        this.verified.push(result.candidate);
      } else {
        this.dead.push(result.death);
      }
    } finally {
      this.in_flight.delete(product.id);
    }
  }

  private hardCutoff = false;

  private async hydrateWave(batch: FashionSlotCatalogProduct[]): Promise<WaveStats> {
    if (!batch.length) return { attempted: 0, killed: 0, hydration_failed: 0 };
    this.waves += 1;
    const wave = this.waves;
    const beforeDead = this.dead.length;
    const beforeVerified = this.verified.length;
    const started = Date.now();

    let tripwireFired = false;
    const tripwireTimer =
      HYDRATION_WAVE_TRIPWIRE_MS > 0
        ? setTimeout(() => {
            tripwireFired = true;
            logAiChat("warn", "fashion_hydration_wave_tripwire", {
              traceId: this.params.traceId,
              slot_id: this.params.slot.slot_id,
              wave,
              tripwire_ms: HYDRATION_WAVE_TRIPWIRE_MS,
            });
          }, HYDRATION_WAVE_TRIPWIRE_MS)
        : null;

    const waveWork = mapWithConcurrency(batch, HYDRATION_MAX_CONCURRENCY, (p) =>
      this.hydrateOne(p),
    );
    void waveWork.catch(() => undefined);
    const cutoff = new Promise<"cutoff">((resolve) => {
      setTimeout(() => resolve("cutoff"), HYDRATION_WAVE_HARD_MS);
    });
    const raced = await Promise.race([
      waveWork.then(() => "done" as const),
      cutoff,
    ]);
    if (tripwireTimer) clearTimeout(tripwireTimer);
    if (raced === "cutoff") {
      this.thin = true;
      this.hardCutoff = true;
      logAiChat("warn", "fashion_hydration_wave_hard_cutoff", {
        traceId: this.params.traceId,
        slot_id: this.params.slot.slot_id,
        wave,
        hard_ms: HYDRATION_WAVE_HARD_MS,
        tripwire_fired: tripwireFired,
        verified_so_far: this.verified.length,
      });
    }

    const killed = this.dead.length - beforeDead;
    const added = this.verified.slice(beforeVerified);
    const hydration_failed = this.dead
      .slice(beforeDead)
      .filter((d) => d.cause === "hydration_failed").length;
    const verified_ok = added.length;
    const gateLimit = this.params.concurrencyGate?.limit ?? HYDRATION_MAX_CONCURRENCY;

    logAiChat("info", "fashion_hydration_wave", {
      traceId: this.params.traceId,
      slot_id: this.params.slot.slot_id,
      garment: this.params.slot.garment,
      wave,
      concurrent: Math.min(batch.length, HYDRATION_MAX_CONCURRENCY),
      global_concurrency: gateLimit,
      attempted: batch.length,
      verified_ok,
      killed,
      hydration_failed,
      timeout_ms: HYDRATION_CALL_TIMEOUT_MS,
      timeout_enabled:
        HYDRATION_CALL_TIMEOUT_MS != null && HYDRATION_CALL_TIMEOUT_MS > 0,
      elapsed_ms: Date.now() - started,
      reserve_left: this.reserve.length,
      verified_total: this.verified.length,
      target: this.target,
      tripwire_fired: tripwireFired,
      hard_cutoff: raced === "cutoff",
    });

    return { attempted: batch.length, killed, hydration_failed };
  }

  async fillToTarget(): Promise<void> {
    await this.runLocked(async () => {
      const wave1Size = hydrationInitialWaveSize(this.target);
      const wave1 = this.popBatch(wave1Size);
      const stats1 = await this.hydrateWave(wave1);
      this.waveStats.push(stats1);

      while (
        !this.hardCutoff &&
        this.verified.length < this.target &&
        this.reserve.length > 0
      ) {
        const deficit = this.target - this.verified.length;
        const wave = this.popBatch(deficit);
        if (!wave.length) break;
        const stats = await this.hydrateWave(wave);
        this.waveStats.push(stats);
      }

      if (this.verified.length < this.target && this.reserve.length === 0) {
        this.thin = true;
      }
      await this.notifyMutation();
    });
  }

  async ensureShortlist(): Promise<void> {
    await this.runLocked(async () => {
      const want = this.params.scoredProducts.slice(0, this.target);
      const missing = want.filter(
        (p) => !this.hydratedIds.has(p.id) && !this.in_flight.has(p.id),
      );
      if (missing.length) {
        const stats = await this.hydrateWave(missing);
        this.waveStats.push(stats);
      }
      await this.notifyMutation();
    });
  }

  async reportDeath(
    productId: string,
    cause: HydrationDeathCause,
    stage: string,
  ): Promise<void> {
    await this.runLocked(async () => {
      const idx = this.verified.findIndex((c) => c.id === productId);
      if (idx >= 0) {
        this.verified.splice(idx, 1);
        this.dead.push({
          product_id: productId,
          cause,
          evidence: `Removed at ${stage}`,
          stage,
        });
      }

      while (this.verified.length < this.target && this.reserve.length > 0) {
        const [next] = this.popBatch(1);
        if (!next) break;
        await this.hydrateOne(next);
        if (this.verified.length >= this.target) break;
      }

      if (this.verified.length < this.target && this.reserve.length === 0) {
        this.thin = true;
      }
      await this.notifyMutation();
    });
  }

  getOverflow(n = HYDRATION_DEFAULT_OVERFLOW): OverflowItem[] {
    const recipientSize = recipientSizeForGarment(
      this.params.recipientFacts,
      this.params.slot.garment,
    );
    const sizeNote = recipientSize
      ? "size availability not checked"
      : undefined;

    return this.reserve.slice(0, n).map((product, i) => ({
      product_id: product.id,
      title: product.title,
      price: product.price,
      image_url: product.image_urls[0],
      merchant: product.shop_domain,
      score_rank: this.verified.length + i + 1,
      score_final: product.score?.final ?? 0,
      verification: "not_verified" as const,
      size_note: sizeNote,
    }));
  }

  getWaveStats(): WaveStats[] {
    return this.waveStats;
  }

  getWaves(): number {
    return this.waves;
  }
}

export function createSlotPool(params: CreateSlotPoolParams): SlotPoolImpl {
  return new SlotPoolImpl(params);
}

export type { SlotPoolImpl };
