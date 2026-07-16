import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import type { FashionFactRow } from "../types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { CatalogSearchContext } from "@/lib/shopify/catalog";
import type { AbortScope } from "@/lib/ai-chat/abort-scope";
import { fashionMemoryDb } from "../db";
import { createSlotPool, type CreateSlotPoolParams } from "./pool";
import type {
  HydratedCandidate,
  HydrationDeathRecord,
  SlotPool,
} from "./types";

/** Persisted pool state — survives process restarts. */
export type SearchPoolState = {
  verified: HydratedCandidate[];
  reserve: FashionSlotCatalogProduct[];
  dead: HydrationDeathRecord[];
  vetoed: string[];
  thin: boolean;
  target: number;
  options_wanted: number;
  /** Refs ever shown to the user (picks + verified + surfaced overflow). */
  shown_refs: string[];
  recurate_count: number;
  /** Context needed to rehydrate and run on-demand hydration. */
  context: {
    slot: FashionSearchPlanSlot;
    brief: FashionSearchBrief;
    recipientFacts: FashionFactRow[];
    accessToken: string;
    catalogContext?: CatalogSearchContext;
    traceId?: string | null;
  };
};

export type SearchPoolRow = {
  search_id: string;
  slot_id: string;
  user_id: string;
  state: SearchPoolState;
  version: number;
  updated_at: string;
};

/** Strip heavy catalog payloads before persistence (image URLs only). */
export function slimCandidateForPool(
  candidate: HydratedCandidate,
): HydratedCandidate {
  const { detail, raw, ...slim } = candidate;
  void detail;
  return {
    ...slim,
    raw: {
      id: raw?.id ?? candidate.id,
      title: raw?.title ?? candidate.title,
    },
  };
}

export function slimProductForPool(
  product: FashionSlotCatalogProduct,
): FashionSlotCatalogProduct {
  const { raw, ...slim } = product;
  return {
    ...slim,
    raw: {
      id: raw?.id ?? product.id,
      title: raw?.title ?? product.title,
    },
  };
}

export function serializePoolState(pool: {
  verified: HydratedCandidate[];
  reserve: FashionSlotCatalogProduct[];
  dead: HydrationDeathRecord[];
  vetoed: string[];
  thin: boolean;
  target: number;
  options_wanted: number;
  shown_refs: string[];
  recurate_count: number;
  context: SearchPoolState["context"];
}): SearchPoolState {
  return {
    verified: pool.verified.map(slimCandidateForPool),
    reserve: pool.reserve.map(slimProductForPool),
    dead: pool.dead,
    vetoed: pool.vetoed,
    thin: pool.thin,
    target: pool.target,
    options_wanted: pool.options_wanted,
    shown_refs: pool.shown_refs,
    recurate_count: pool.recurate_count,
    context: pool.context,
  };
}

/** In-memory store for tests — production uses Supabase. */
const memoryStore = new Map<string, SearchPoolRow>();

function rowKey(searchId: string, slotId: string): string {
  return `${searchId}:${slotId}`;
}

export function clearSearchPoolMemoryStore(): void {
  memoryStore.clear();
}

export type PoolStoreMode = "memory" | "supabase";

let poolStoreMode: PoolStoreMode =
  process.env.NODE_ENV === "test" ? "memory" : "supabase";

export function setPoolStoreMode(mode: PoolStoreMode): void {
  poolStoreMode = mode;
}

async function readRow(
  searchId: string,
  slotId: string,
): Promise<SearchPoolRow | null> {
  if (poolStoreMode === "memory") {
    return memoryStore.get(rowKey(searchId, slotId)) ?? null;
  }
  const { data, error } = await fashionMemoryDb()
    .from("search_pools")
    .select("*")
    .eq("search_id", searchId)
    .eq("slot_id", slotId)
    .maybeSingle();
  if (error || !data) return null;
  return data as SearchPoolRow;
}

export async function saveSlotPool(params: {
  searchId: string;
  slotId: string;
  userId: string;
  state: SearchPoolState;
  ifVersion?: number;
}): Promise<{ version: number }> {
  const serialized = serializePoolState(params.state);
  if (poolStoreMode === "memory") {
    const key = rowKey(params.searchId, params.slotId);
    const existing = memoryStore.get(key);
    if (
      params.ifVersion != null &&
      existing &&
      existing.version !== params.ifVersion
    ) {
      throw new PoolVersionConflictError(params.searchId, params.slotId);
    }
    const version = (existing?.version ?? 0) + 1;
    memoryStore.set(key, {
      search_id: params.searchId,
      slot_id: params.slotId,
      user_id: params.userId,
      state: serialized,
      version,
      updated_at: new Date().toISOString(),
    });
    return { version };
  }

  if (params.ifVersion != null) {
    const { data, error } = await fashionMemoryDb()
      .from("search_pools")
      .update({
        state: serialized,
        version: params.ifVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("search_id", params.searchId)
      .eq("slot_id", params.slotId)
      .eq("version", params.ifVersion)
      .select("version")
      .maybeSingle();
    if (error || !data) {
      throw new PoolVersionConflictError(params.searchId, params.slotId);
    }
    return { version: data.version as number };
  }

  const { data, error } = await fashionMemoryDb()
    .from("search_pools")
    .upsert(
      {
        search_id: params.searchId,
        slot_id: params.slotId,
        user_id: params.userId,
        state: serialized,
        version: 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "search_id,slot_id" },
    )
    .select("version")
    .single();
  if (error || !data) {
    throw new Error(`saveSlotPool failed: ${String(error)}`);
  }
  return { version: data.version as number };
}

export class PoolVersionConflictError extends Error {
  readonly name = "PoolVersionConflictError";
  constructor(
    readonly searchId: string,
    readonly slotId: string,
  ) {
    super(`Pool version conflict for ${searchId}/${slotId}`);
  }
}

export type RehydratedSlotPool = SlotPool & {
  vetoed: string[];
  shown_refs: string[];
  recurate_count: number;
  context: SearchPoolState["context"];
  persist(): Promise<void>;
  getVersion(): number;
  recordVeto(productId: string): void;
  recordShownRef(ref: string): void;
  incrementRecurate(): void;
};

export async function loadSlotPool(params: {
  searchId: string;
  slotId: string;
  userId: string;
  abortScope?: AbortScope;
  hydrateFn?: CreateSlotPoolParams["hydrateFn"];
}): Promise<RehydratedSlotPool | null> {
  const row = await readRow(params.searchId, params.slotId);
  if (!row || row.user_id !== params.userId) return null;

  const state = row.state;
  let version = row.version;
  const vetoed = [...state.vetoed];
  const shown_refs = [...state.shown_refs];
  let recurate_count = state.recurate_count;

  const pool = createSlotPool({
    slot: state.context.slot,
    scoredProducts: [],
    brief: state.context.brief,
    recipientFacts: state.context.recipientFacts,
    accessToken: state.context.accessToken,
    context: state.context.catalogContext,
    traceId: state.context.traceId,
    abortScope: params.abortScope,
    hydrateFn: params.hydrateFn,
    initialState: {
      verified: state.verified,
      reserve: state.reserve,
      dead: state.dead,
      thin: state.thin,
      vetoed,
    },
    skipInitialFill: true,
  });

  const persist = async () => {
    const result = await saveSlotPool({
      searchId: params.searchId,
      slotId: params.slotId,
      userId: params.userId,
      state: {
        verified: pool.verified,
        reserve: pool.reserve,
        dead: pool.dead,
        vetoed,
        thin: pool.thin,
        target: pool.target,
        options_wanted: pool.options_wanted,
        shown_refs,
        recurate_count,
        context: state.context,
      },
      ifVersion: version,
    });
    version = result.version;
  };

  return Object.assign(pool, {
    vetoed,
    shown_refs,
    recurate_count,
    context: state.context,
    persist,
    getVersion: () => version,
    recordVeto: (productId: string) => {
      if (!vetoed.includes(productId)) vetoed.push(productId);
    },
    recordShownRef: (ref: string) => {
      if (!shown_refs.includes(ref)) shown_refs.push(ref);
    },
    incrementRecurate: () => {
      recurate_count += 1;
    },
  });
}

/** Persist all slot pools after initial catalog search. */
export async function persistAllSlotPools(params: {
  searchId: string;
  userId: string;
  pools: Map<
    string,
    SlotPool & {
      vetoed?: string[];
      shown_refs?: string[];
      recurate_count?: number;
    }
  >;
  contexts: Map<string, SearchPoolState["context"]>;
}): Promise<void> {
  for (const [slotId, pool] of params.pools) {
    const context = params.contexts.get(slotId);
    if (!context) continue;
    await saveSlotPool({
      searchId: params.searchId,
      slotId,
      userId: params.userId,
      state: {
        verified: pool.verified,
        reserve: pool.reserve,
        dead: pool.dead,
        vetoed: pool.vetoed ?? [],
        thin: pool.thin,
        target: pool.target,
        options_wanted: pool.options_wanted,
        shown_refs: pool.shown_refs ?? [],
        recurate_count: pool.recurate_count ?? 0,
        context,
      },
    });
  }
}

/** Strip catalog payloads after working lifecycle — keep refs + decisions. */
export function stripExpiredPoolPayloads(state: SearchPoolState): SearchPoolState {
  return {
    ...state,
    verified: state.verified.map((c) => ({
      id: c.id,
      upid: c.upid,
      title: c.title,
      image_urls: c.image_urls,
      media_urls: c.media_urls,
      hydrated_at: c.hydrated_at,
      size_status: c.size_status,
      size_selection: c.size_selection,
      color_selection: c.color_selection,
      resolved_options: c.resolved_options,
      selected_variant_id: c.selected_variant_id,
      matched_by: c.matched_by,
      matched_by_color_variant: c.matched_by_color_variant,
      variant_options: [],
      score: c.score,
      raw: { id: c.id, title: c.title },
    })),
    reserve: state.reserve.map((p) => ({
      id: p.id,
      upid: p.upid,
      title: p.title,
      image_urls: p.image_urls,
      matched_by: p.matched_by,
      matched_by_color_variant: p.matched_by_color_variant,
      variant_options: [],
      score: p.score,
      raw: { id: p.id, title: p.title },
    })),
  };
}
