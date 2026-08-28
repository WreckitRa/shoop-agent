import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import {
  loadFashionSearchProfile,
  searchFashionCatalogPlan,
} from "@/lib/fashion-memory/catalog-search";
import { buildRenderContract } from "@/lib/fashion-memory/curation/build-render-contract";
import type { SearchObservability } from "@/lib/fashion-memory/observability/search-observability";
import { drainTurnLlmCostBuffer } from "@/lib/fashion-memory/observability/search-observability";
import { planSearchFromBrief } from "@/lib/fashion-memory/search-planner/plan-from-brief";
import type { FashionSearchPlan } from "@/lib/fashion-memory/search-planner/types";
import { scoringWeightsVersion } from "@/lib/fashion-memory/scoring/weights";
import type { FashionSearchBrief } from "@/lib/fashion-memory/router/types";
import type { FashionFactRow } from "@/lib/fashion-memory/types";
import type { GuestFashionMemorySnapshot } from "@/lib/fashion-memory/local/store";
import { classifyRefinementMode } from "@/lib/fashion-memory/intake/refinement-mode";
import { setPoolStoreMode } from "@/lib/fashion-memory/hydration/pool-persistence";

export type LaneCounts = {
  usual: number;
  adjacent: number;
  new: number;
};

export type LiveSearchCapture = {
  search_observability?: SearchObservability;
  lane_distribution: LaneCounts;
  scoring_weights_version: string;
  searchId?: string;
  plan?: FashionSearchPlan;
  error?: string;
};

const EMPTY_LANES: LaneCounts = { usual: 0, adjacent: 0, new: 0 };

function lanesFromCatalog(params: {
  picks: Array<{ id: string; slot_id: string }>;
  products: Array<{
    id: string;
    taste_rating?: { lane: "usual" | "adjacent" | "new" };
  }>;
}): LaneCounts {
  const byId = new Map(params.products.map((p) => [p.id, p]));
  const out: LaneCounts = { usual: 0, adjacent: 0, new: 0 };
  for (const pick of params.picks) {
    const lane = byId.get(pick.id)?.taste_rating?.lane;
    if (lane) out[lane] += 1;
  }
  return out;
}

/** Production retrieval path: planner → MCP → drops → score → hydrate → Stage A/B → render. */
export async function runLiveCatalogSearch(params: {
  brief: FashionSearchBrief;
  userId: string;
  snapshot: GuestFashionMemorySnapshot;
  recipientPersonId: string;
  recipientFacts: FashionFactRow[];
  traceId: string;
  currentDate: string;
  searchId: string;
  previous?: {
    searchId: string;
    brief: FashionSearchBrief;
    plan: FashionSearchPlan;
  };
}): Promise<LiveSearchCapture> {
  setPoolStoreMode("memory");
  const version = scoringWeightsVersion();
  const mode = classifyRefinementMode(params.previous?.brief, params.brief);
  try {
    const skipPlanner = mode === "rescore-only" && params.previous?.plan != null;
    const planned = skipPlanner
      ? {
          plan: { ...params.previous!.plan, brief: params.brief },
          planner_ms: 0,
          recipientProfile: "",
        }
      : await planSearchFromBrief({
          brief: params.brief,
          userId: params.userId,
          recipientPersonId: params.recipientPersonId,
          currentDate: params.currentDate,
          guestSnapshot: params.snapshot,
          traceId: params.traceId,
        });
    const [profile, accessToken] = await Promise.all([
      loadFashionSearchProfile({
        userId: params.userId,
        recipientPersonId: params.recipientPersonId,
        guestSnapshot: params.snapshot,
      }),
      accessTokenForCatalogMcp(),
    ]);
    const catalog = await searchFashionCatalogPlan({
      plan: planned.plan,
      profile,
      accessToken,
      recipientFacts: params.recipientFacts,
      recipientProfile: planned.recipientProfile,
      guestSnapshot: params.snapshot,
      userId: params.userId,
      traceId: params.traceId,
      searchId: params.searchId,
      ...(mode !== "full" && params.previous
        ? {
            refinement: {
              mode,
              previousSearchId: params.previous.searchId,
            },
          }
        : {}),
    });
    const obs = catalog.search_observability;
    if (obs) {
      obs.latency.planner_ms = planned.planner_ms;
      if (catalog.curation) {
        const renderStarted = Date.now();
        buildRenderContract({
          presentation: catalog.curation,
          plan: planned.plan,
        });
        obs.latency.render_ms = Date.now() - renderStarted;
      }
      obs.cost = drainTurnLlmCostBuffer(params.traceId);
    }
    const picks = catalog.curation?.tiers.picks ?? [];
    const products = catalog.slots.flatMap((s) => [
      ...(s.verified_pool ?? []),
      ...s.products,
    ]);
    return {
      search_observability: obs,
      lane_distribution: lanesFromCatalog({ picks, products }),
      scoring_weights_version: version,
      searchId: params.searchId,
      plan: planned.plan,
    };
  } catch (e) {
    return {
      lane_distribution: EMPTY_LANES,
      scoring_weights_version: version,
      searchId: params.searchId,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
