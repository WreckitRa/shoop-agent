/**
 * Find-similar search engine — LLM-planned queries, each anchored with catalog.like.
 */
import type { CatalogSearchContext } from "@/lib/shopify/catalog";
import type { CatalogProductDetail, CatalogProductSummary } from "@/lib/shopify/catalog";
import { loadFxRates } from "@/lib/shopify/fx-rates";
import { AI_CHAT_TIER_JUDGE_TIMEOUT_MS } from "../../constants";
import { buildShoppingMemoryPromptXml } from "../../shopping-memory/context";
import { logAiChat } from "../../observability";
import type { CuratedPick } from "../../types";
import { isGiftMerchandiseTitle } from "../gift-merchandise";
import { isNoveltyMerchTitle } from "../novelty-merch";
import { collapseNearDuplicateCandidates } from "../pool-health";
import { isGiftArchetype } from "../portfolio";
import { evaluateResultSanity } from "../result-sanity";
import { productPassesShippingTextGuard } from "../shipping-text-guard";
import type { PoolCandidate } from "../types";
import { buildPool, type QueryYieldStat } from "../pool";
import {
  candidateEmbeddingText,
  scorePool,
  type FeedbackAvoidSet,
} from "../scoring";
import { assignSlots } from "../slotting";
import type { PortfolioQuery, SearchBrief } from "../types";
import { verifyCandidates } from "../verify";
import { embedTexts, isVoyageConfigured } from "../voyage";
import type { EngineNarration, EngineSearchResult } from "../engine";
import { planSimilarSearches, type SimilarSearchPlan } from "./plan-similar-searches";
import { findSimilarSearchQuery } from "./action";
import { logFindSimilar } from "./debug-log";
import { seedEmbeddingText } from "./similar-scoring";
import type { SimilarSearchContext, TasteHypothesis } from "./types";

export type RunSimilarSearchParams = {
  brief: SearchBrief;
  similar: SimilarSearchContext;
  pick: CuratedPick;
  userId?: string;
  accessToken: string;
  displayLimit: number;
  shipsToCountry?: string;
  context?: CatalogSearchContext;
  excludedKeys?: Set<string>;
  feedback?: FeedbackAvoidSet;
  signal?: AbortSignal;
  onNarration?: EngineNarration;
  deadlineMs?: number;
  seedCatalogProduct?: CatalogProductSummary | CatalogProductDetail;
  seedCatalogDetail?: CatalogProductDetail;
  confirmedAttribute?: string;
};

const DEFAULT_DEADLINE_MS = 10000;
const VOYAGE_EMBED_CANDIDATES = 32;

function resolveSeedLikeId(params: RunSimilarSearchParams): string {
  return (
    params.seedCatalogDetail?.id ??
    params.seedCatalogProduct?.id ??
    params.similar.seedProductId
  );
}

function buildSimilarPortfolio(
  plan: SimilarSearchPlan,
  likeProductId: string,
  seedTitle: string,
): PortfolioQuery[] {
  const semantic = findSimilarSearchQuery(seedTitle);
  return [
    {
      id: "similar_like_only",
      text: "",
      wave: 1,
      like: [{ id: likeProductId }],
    },
    ...plan.searches.map((s) => ({
      id: `similar_${s.id}`,
      text: s.text,
      wave: 1 as const,
      like: [{ id: likeProductId }],
    })),
    {
      id: "similar_semantic_text",
      text: semantic,
      wave: 1,
    },
  ];
}

function filterCandidates(
  candidates: PoolCandidate[],
  brief: SearchBrief,
  buyerCountry?: string,
): PoolCandidate[] {
  let out = buyerCountry
    ? candidates.filter((c) =>
        productPassesShippingTextGuard(c.product, buyerCountry),
      )
    : candidates;
  if (isGiftArchetype(brief)) {
    out = out.filter(
      (c) =>
        !isGiftMerchandiseTitle(c.product.title ?? "") &&
        !isNoveltyMerchTitle(c.product.title ?? ""),
    );
  }
  return collapseNearDuplicateCandidates(out);
}

export async function runSimilarSearchEngine(
  params: RunSimilarSearchParams,
): Promise<
  EngineSearchResult & {
    hypothesis: TasteHypothesis | null;
    plan: SimilarSearchPlan;
  }
> {
  const deadline = Date.now() + (params.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const { similar, brief } = params;
  const narrate = (line: string) => {
    try {
      params.onNarration?.(line);
    } catch {
      /* best-effort */
    }
  };

  const excludedKeys = new Set(params.excludedKeys ?? []);
  if (similar.seedUpid) excludedKeys.add(similar.seedUpid);
  excludedKeys.add(similar.seedProductId);

  const likeProductId = resolveSeedLikeId(params);

  logFindSimilar("engine_seed", {
    seedProductId: similar.seedProductId,
    seedTitle: similar.seedTitle,
    seedUpid: similar.seedUpid ?? null,
    seedPriceCents: similar.seedPriceCents,
    likeProductId,
    shipsToCountry: params.shipsToCountry ?? null,
    excludedKeys: [...excludedKeys],
    brief: {
      query: brief.query,
      archetype: brief.archetype,
      directionLabel: brief.directionLabel ?? null,
      budget: brief.budget,
      condition: brief.condition ?? null,
    },
  });

  narrate(`Planning searches like “${similar.seedTitle.split(" ").slice(0, 5).join(" ")}”`);

  const plan = await planSimilarSearches({
    pick: params.pick,
    brief,
    detail: params.seedCatalogDetail ?? (params.seedCatalogProduct as CatalogProductDetail),
    summary: params.seedCatalogProduct,
    confirmedAttribute: params.confirmedAttribute,
    signal: params.signal,
    timeoutMs: Math.min(4000, deadline - Date.now() - 5000),
  });

  narrate(
    plan.productType
      ? `Searching for similar ${plan.productType}`
      : "Searching the catalog for similar items",
  );

  const portfolio = buildSimilarPortfolio(plan, likeProductId, similar.seedTitle);

  logFindSimilar("engine_plan", {
    seedProductId: similar.seedProductId,
    productType: plan.productType ?? null,
    priceTier: plan.priceTier ?? null,
    plannedSearches: plan.searches,
    portfolio: portfolio.map((q) => ({
      id: q.id,
      text: q.text || null,
      like: q.like?.map((l) => ("id" in l ? l.id : null)),
    })),
  });

  const seedPool = await buildPool({
    accessToken: params.accessToken,
    brief,
    queries: portfolio,
    shipsToCountry: params.shipsToCountry,
    context: params.context,
    excludedKeys,
    signal: params.signal,
    thinThreshold: 3,
    traceCatalogQueries: true,
  });

  let allCandidates = seedPool.candidates;
  let stats: QueryYieldStat[] = [...seedPool.stats];
  let loosened = seedPool.loosened;

  const buyerCountry =
    params.shipsToCountry ?? params.context?.address_country;
  let candidates = filterCandidates(allCandidates, brief, buyerCountry);

  logFindSimilar("engine_pool_filtered", {
    seedProductId: similar.seedProductId,
    pooled: allCandidates.length,
    afterFilters: candidates.length,
    buyerCountry,
    giftArchetype: isGiftArchetype(brief),
  });

  if (!candidates.length) {
    logFindSimilar("engine_empty_pool", {
      seedProductId: similar.seedProductId,
      stats,
    });
    return {
      brief,
      products: [],
      curatedPicks: [],
      allowedProductIds: [],
      rawCount: 0,
      surfacedUpids: [],
      stats,
      thin: true,
      loosened,
      portfolio,
      slottingMethod: "score_heuristic",
      curationFallback: true,
      hypothesis: null,
      plan,
    };
  }

  narrate("Ranking matches");

  const buyerCurrency =
    params.context?.currency ?? brief.budget?.currency ?? "USD";
  const fxTable = await loadFxRates().catch(() => null);

  let candidateVectors: Map<string, number[]> | undefined;
  let seedVector: number[] | null = null;

  if (isVoyageConfigured() && Date.now() < deadline - 1500) {
    const top = candidates.slice(0, VOYAGE_EMBED_CANDIDATES);
    const seedProduct = params.seedCatalogDetail ?? params.seedCatalogProduct;
    const seedText = seedProduct
      ? seedEmbeddingText(seedProduct as CatalogProductSummary)
      : similar.seedTitle;
    const batch = [seedText, ...top.map((c) => candidateEmbeddingText(c.product))];
    const vectors = await embedTexts(batch, "document", {
      signal: params.signal,
      timeoutMs: Math.max(400, deadline - Date.now() - 1200),
    });
    if (vectors) {
      seedVector = vectors[0] ?? null;
      candidateVectors = new Map();
      for (let i = 0; i < top.length; i++) {
        const v = vectors[i + 1];
        if (v) candidateVectors.set(top[i]!.upid, v);
      }
    }
  }

  let scoringBrief = brief;
  let scored = scorePool({
    brief: scoringBrief,
    pool: candidates,
    tasteVector: null,
    candidateVectors,
    feedback: params.feedback,
    buyerCurrency,
    fxTable,
    similar: {
      hypothesis: null,
      seedPriceCents: similar.seedPriceCents,
      seedVector,
      differentiatorVectors: undefined,
    },
  });

  if (!scored.length && candidates.length && scoringBrief.budget.type !== "none") {
    scoringBrief = {
      ...brief,
      budget: {
        ...brief.budget,
        type: "none",
        amountCents: null,
        maxCents: null,
        minCents: null,
      },
    };
    scored = scorePool({
      brief: scoringBrief,
      pool: candidates,
      tasteVector: null,
      candidateVectors,
      feedback: params.feedback,
      buyerCurrency,
      fxTable,
      similar: {
        hypothesis: null,
        seedPriceCents: similar.seedPriceCents,
        seedVector,
        differentiatorVectors: undefined,
      },
    });
  }

  logFindSimilar("engine_scored", {
    seedProductId: similar.seedProductId,
    scoredCount: scored.length,
    budgetRelaxed: scoringBrief.budget.type !== brief.budget.type,
    scoringBudget: scoringBrief.budget,
  });

  narrate("Checking stock and shipping");

  const target = Math.min(params.displayLimit + 4, 20);
  const { verified: rawVerified } = await verifyCandidates({
    accessToken: params.accessToken,
    candidates: scored,
    brief: scoringBrief,
    target,
    maxAttempts: 25,
    concurrency: 6,
    shipsToCountry: params.shipsToCountry,
    context: params.context,
    buyerCurrency,
    fxTable,
    signal: params.signal,
  });
  const verified = buyerCountry
    ? rawVerified.filter((v) =>
        productPassesShippingTextGuard(v.detail, buyerCountry),
      )
    : rawVerified;

  logFindSimilar("engine_verified", {
    seedProductId: similar.seedProductId,
    verifiedCount: verified.length,
    rawVerifiedCount: rawVerified.length,
    verifyAttempts: Math.min(25, scored.length),
  });

  if (!verified.length) {
    logFindSimilar("engine_empty_verified", {
      seedProductId: similar.seedProductId,
      candidateCount: candidates.length,
      scoredCount: scored.length,
    });
    return {
      brief,
      products: [],
      curatedPicks: [],
      allowedProductIds: [],
      rawCount: candidates.length,
      surfacedUpids: [],
      stats,
      thin: true,
      loosened,
      portfolio,
      slottingMethod: "score_heuristic",
      curationFallback: true,
      hypothesis: null,
      plan,
    };
  }

  const tierJudgeMemoryXmlPromise = params.userId
    ? buildShoppingMemoryPromptXml(params.userId, brief.query).catch(() => "")
    : Promise.resolve("");

  const slotted = await assignSlots({
    verified,
    brief: scoringBrief,
    displayLimit: params.displayLimit,
    candidateCount: candidates.length,
    userId: params.userId,
    accessToken: params.accessToken,
    shipsToCountry: params.shipsToCountry,
    context: params.context,
    signal: params.signal,
    preBuiltMemoryXml: await tierJudgeMemoryXmlPromise,
    tierJudgeTimeoutMs: AI_CHAT_TIER_JUDGE_TIMEOUT_MS,
    onNarration: params.onNarration,
  });

  evaluateResultSanity({ brief, picks: slotted.picks, verified });

  logFindSimilar("engine_complete", {
    seedProductId: similar.seedProductId,
    picks: slotted.picks.map((p) => ({ id: p.id, title: p.title, slot: p.slot })),
    productCount: slotted.products.length,
    slottingMethod: slotted.method,
    curationFallback: slotted.curationFallback,
  });

  logAiChat("info", "similar_search_complete", {
    seedProductId: similar.seedProductId,
    plannedQueries: plan.searches.length,
    pooled: candidates.length,
    verified: verified.length,
    picks: slotted.picks.length,
  });

  return {
    brief,
    products: slotted.picks.length ? slotted.picks : slotted.products,
    curatedPicks: slotted.picks,
    allowedProductIds: slotted.picks.map((pick) => pick.id),
    rawCount: candidates.length,
    surfacedUpids: verified.map((v) => v.upid),
    stats,
    thin: candidates.length < 8,
    loosened,
    portfolio,
    slottingMethod: slotted.method,
    curationFallback: slotted.curationFallback,
    hypothesis: null,
    plan,
  };
}
