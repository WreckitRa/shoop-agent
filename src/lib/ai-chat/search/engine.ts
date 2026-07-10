/**
 * Search Engine orchestrator (docs/search-improvements.md §3, §12).
 *
 * Runs Stages 1-5 inside the ~6s SLA: portfolio -> pool -> score -> verify ->
 * slot. Emits a `narration_line` per phase so the UI can show progress. Every
 * external dependency (Haiku planner, Voyage) runs under a soft deadline and
 * degrades gracefully, so the engine always returns SOMETHING in budget.
 */
import type {
  CatalogSearchContext,
  CatalogProductSummary,
} from "@/lib/shopify/catalog";
import { alignProductCardCurrency } from "@/lib/shopify/catalog-localization";
import { loadFxRates } from "@/lib/shopify/fx-rates";
import {
  AI_CHAT_TIER_JUDGE_TIMEOUT_MS,
  AGENTIC_POOL_RETRY_BUDGET_MS,
} from "../constants";
import { buildShoppingMemoryPromptXml } from "../shopping-memory/context";
import { logAiChat } from "../observability";
import type { QueryPlannerDebugHooks } from "./query-planner-debug";
import type { CuratedPick, ProductCard } from "../types";
import type { CatalogSearchAuditContext } from "@/lib/shopify/catalog-mcp-audit";
import { createEngineSearchAuditCollector } from "./engine-audit";
import {
  enrichSearchBriefFromMemory,
  enrichSearchBriefFromProfile,
} from "./brief-enrichment";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import { isGiftMerchandiseTitle } from "./gift-merchandise";
import { isNoveltyMerchTitle } from "./novelty-merch";
import {
  assessPoolHealth,
  buildCorrectiveQueries,
  collapseNearDuplicateCandidates,
} from "./pool-health";
import { sanitizePortfolioQueries } from "./query-hygiene";
import {
  craftPortfolioQueries,
  learnedAngleQueries,
  mergePortfolio,
  isGiftArchetype,
} from "./portfolio";
import { evaluateResultSanity } from "./result-sanity";
import { sanitizeSearchBrief } from "./query-hygiene";
import { productPassesShippingTextGuard } from "./shipping-text-guard";
import { getLearnedQueryAngles } from "./learning";
import {
  buildPool,
  mergeWarmCandidatesIntoPool,
  type QueryYieldStat,
} from "./pool";
import {
  candidateEmbeddingText,
  scorePool,
  type FeedbackAvoidSet,
} from "./scoring";
import { assignSlots } from "./slotting";
import {
  mergeVerifiedByUpid,
  planAgenticRetryQueries,
  runAgenticPoolRefillWave,
} from "./agentic-pool-retry";
import { assessPostTriagePool } from "./post-triage-assessment";
import type { PortfolioQuery, SearchBrief } from "./types";
import { verifyCandidates } from "./verify";
import { embedTexts, isVoyageConfigured } from "./voyage";
import {
  filterScoredByConstraints,
  type ConstraintGateMetrics,
} from "./constraint-gate";
import type { TierPlacement } from "../judgment/tier-judge";
import {
  buildSearchPipelineDebug,
  computePoolFilterDrops,
  unionPoolCandidates,
  type SearchPipelineDebugV1,
} from "./pipeline-debug";
import type { ConstraintGateDrop } from "./constraint-gate";
import {
  buildKillStats,
  buildNarratorInstructions,
  gateReasonsForNarration,
  heroPlacement,
  runnerUpPlacement,
} from "./narrator-contract";
import { getExpertisePrinciplesForNarrator } from "../judgment/expertise-corpus";
import { anchorPortfolioQueryText } from "./brand-anchors";
import { portfolioQueryFromText } from "./portfolio-planner-shared";
import {
  mergeGateMetrics,
  type PipelineGateMetrics,
  type PipelineStageMs,
} from "./pipeline-metrics";

export type EngineNarration = (line: string) => void;

/** Early rack skeleton after wide triage — before deep judge finishes. */
export type EngineSearchPartial = {
  products: ProductCard[];
  curatedPicks: CuratedPick[];
};

export type EngineSearchParams = {
  brief: SearchBrief;
  userId?: string;
  accessToken: string;
  displayLimit: number;
  shipsToCountry?: string;
  context?: CatalogSearchContext;
  avoidTerms?: string[];
  /** UPIDs/ids of previously shown picks to exclude (refine rounds). */
  excludedKeys?: Set<string>;
  /** Buyer/recipient taste embedding for Fit (Voyage). */
  tasteVector?: number[] | null;
  feedback?: FeedbackAvoidSet;
  signal?: AbortSignal;
  onNarration?: EngineNarration;
  /** Progressive UI: triage skeleton before deep judge returns. */
  onSearchPartial?: (payload: EngineSearchPartial) => void;
  /** Persist Shopify MCP + pipeline summary for admin observability. */
  audit?: CatalogSearchAuditContext & { toolInput: Record<string, unknown> };
  queryPlannerDebug?: QueryPlannerDebugHooks;
  /** Soft wall-clock budget for the whole engine run. */
  deadlineMs?: number;
  /** Warm-stashed catalog hits from clarification option previews. */
  warmProducts?: CatalogProductSummary[];
  /** Detected context expertise tag (e.g. burning_man). */
  contextTag?: string | null;
  /** Dev-only: full pipeline snapshot for the search debug panel. */
  onPipelineDebug?: (payload: SearchPipelineDebugV1) => void;
};

export type EngineSearchResult = {
  brief: SearchBrief;
  products: ProductCard[];
  curatedPicks: CuratedPick[];
  rawCount: number;
  /** UPIDs of everything surfaced this round (refine-round exclusion). */
  surfacedUpids: string[];
  stats: QueryYieldStat[];
  thin: boolean;
  loosened: boolean;
  portfolio: PortfolioQuery[];
  slottingMethod: "tier_judge" | "score_heuristic";
  curationFallback: boolean;
  tierPlacements?: TierPlacement[];
  ruledOut?: ConstraintGateDrop[];
  constraintGate?: ConstraintGateMetrics;
  /** Product ids the narrator may mention — curated picks only. */
  allowedProductIds: string[];
  stageMs?: PipelineStageMs;
  gateMetrics?: PipelineGateMetrics;
  pipelineDebug?: SearchPipelineDebugV1;
};

const DEFAULT_DEADLINE_MS = 6000;
const VOYAGE_EMBED_CANDIDATES = 32;

function filterAvoided<T extends { product: { title: string } }>(
  candidates: T[],
  avoidTerms: string[] | undefined,
): T[] {
  if (!avoidTerms?.length) return candidates;
  const needles = avoidTerms
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2);
  if (!needles.length) return candidates;
  return candidates.filter((c) => {
    const hay = c.product.title.toLowerCase();
    return !needles.some((n) => hay.includes(n));
  });
}

export async function runSearchEngine(
  params: EngineSearchParams,
): Promise<EngineSearchResult> {
  const engineStart = Date.now();
  const stageMs: PipelineStageMs = {};
  let brief = sanitizeSearchBrief(params.brief);
  if (params.userId) {
    if (isGiftArchetype(brief)) {
      brief = await enrichSearchBriefFromMemory(params.userId, brief).catch(
        () => brief,
      );
    } else {
      brief = await enrichSearchBriefFromProfile(params.userId, brief).catch(
        () => brief,
      );
    }
  }
  brief = sanitizeSearchBrief(brief);
  const { onNarration } = params;
  const deadline = Date.now() + (params.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const tierJudgeMemoryXmlPromise = params.userId
    ? buildShoppingMemoryPromptXml(params.userId, brief.query).catch(() => "")
    : Promise.resolve("");
  const auditCollector = params.audit
    ? createEngineSearchAuditCollector(
        {
          userId: params.audit.userId,
          conversationId: params.audit.conversationId,
          userMessageId: params.audit.userMessageId,
          assistantMessageId: params.audit.assistantMessageId,
          searchKey: params.audit.searchKey,
          toolInput: params.audit.toolInput,
        },
        params.audit.toolInput,
      )
    : null;
  const onMcpAudit = auditCollector?.recordMcp.bind(auditCollector);
  const narrate = (line: string) => {
    try {
      onNarration?.(line);
    } catch {
      /* narration is best-effort */
    }
  };

  // ── Stage 1: portfolio (LLM-planned + learned angles) ───────────────────
  const portfolioStart = Date.now();
  const [learnedAngles, planned] = await Promise.all([
    getLearnedQueryAngles({
      category: brief.category,
      archetype: brief.archetype,
      directionLabel: brief.directionLabel,
    }).catch(() => []),
    craftPortfolioQueries(brief, {
      signal: params.signal,
      debug: params.queryPlannerDebug,
    }).catch(() => [] as PortfolioQuery[]),
  ]);

  const portfolio = sanitizePortfolioQueries(
    mergePortfolio(
      learnedAngleQueries(
        brief,
        learnedAngles.map((a) => a.queryText),
      ),
      planned,
      brief.archetype,
      brief.directionLabel,
    ),
    brief,
  );
  const anchorText = anchorPortfolioQueryText(brief);
  const anchorQuery = anchorText
    ? portfolioQueryFromText(brief, anchorText, {
        wave: 2,
        intent: "anchor brand retrieval",
      })
    : null;
  const portfolioWithAnchor = anchorQuery
    ? sanitizePortfolioQueries([...portfolio, anchorQuery], brief)
    : portfolio;
  narrate(
    isGiftArchetype(brief)
      ? `Finding gift ideas across ${portfolioWithAnchor.length} product categories`
      : `Exploring ${portfolioWithAnchor.length} angle${portfolioWithAnchor.length === 1 ? "" : "s"} for “${brief.query}”`,
  );
  stageMs.portfolio = Date.now() - portfolioStart;

  // ── Stage 2: pool ───────────────────────────────────────────────────────
  const poolStart = Date.now();
  const pool = await buildPool({
    accessToken: params.accessToken,
    brief,
    shipsToCountry: params.shipsToCountry,
    context: params.context,
    excludedKeys: params.excludedKeys,
    signal: params.signal,
    onMcpAudit,
    queries: portfolioWithAnchor,
  });
  const excludedKeys = params.excludedKeys ?? new Set<string>();
  const pooledCandidates = params.warmProducts?.length
    ? mergeWarmCandidatesIntoPool(
        pool.candidates,
        params.warmProducts,
        excludedKeys,
      )
    : pool.candidates;
  const buyerCountry =
    params.shipsToCountry ?? params.context?.address_country;
  const afterAvoid = filterAvoided(pooledCandidates, params.avoidTerms);
  const afterShipping = buyerCountry
    ? afterAvoid.filter((c) =>
        productPassesShippingTextGuard(c.product, buyerCountry),
      )
    : afterAvoid;
  let candidates = afterShipping;
  let afterGift = afterShipping;
  let giftMerchDropped = 0;
  if (isGiftArchetype(brief)) {
    const before = candidates.length;
    afterGift = candidates.filter(
      (c) =>
        !isGiftMerchandiseTitle(c.product.title ?? "") &&
        !isNoveltyMerchTitle(c.product.title ?? ""),
    );
    candidates = afterGift;
    giftMerchDropped = before - afterGift.length;
  } else {
    afterGift = candidates;
  }
  candidates = collapseNearDuplicateCandidates(candidates);
  stageMs.pool = Date.now() - poolStart;
  let gateMetrics: PipelineGateMetrics = mergeGateMetrics(
    {},
    {
      giftMerchDropped,
      shippingGuardDropped: afterAvoid.length - afterShipping.length,
    },
  );

  const health = assessPoolHealth(candidates, brief);
  if (!health.healthy && Date.now() < deadline - 2000) {
    const corrective = buildCorrectiveQueries(brief, portfolioWithAnchor);
    if (corrective.length) {
      narrate(
        "Pool looked thin or repetitive — trying different product angles",
      );
      const correctivePool = await buildPool({
        accessToken: params.accessToken,
        brief,
        shipsToCountry: params.shipsToCountry,
        context: params.context,
        excludedKeys: params.excludedKeys,
        signal: params.signal,
        onMcpAudit: onMcpAudit
          ? (event) =>
              onMcpAudit({
                ...event,
                callKind: "corrective",
              })
          : undefined,
        queries: corrective,
        limit: 30,
      });
      const correctiveCandidates = filterAvoided(
        correctivePool.candidates,
        params.avoidTerms,
      );
      const correctiveAfterShipping = buyerCountry
        ? correctiveCandidates.filter((c) =>
            productPassesShippingTextGuard(c.product, buyerCountry),
          )
        : correctiveCandidates;
      const merged = collapseNearDuplicateCandidates([
        ...candidates,
        ...correctiveAfterShipping,
      ]);
      if (merged.length > candidates.length) {
        candidates = merged;
        logAiChat("info", "search_engine_corrective_wave", {
          reasons: health.reasons,
          before: pool.candidates.length,
          after: candidates.length,
          correctiveQueries: corrective.length,
        });
      }
    }
  }

  narrate(
    `Pooled ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} across stores`,
  );

  if (!candidates.length) {
    auditCollector?.finalize({
      brief,
      portfolio: portfolioWithAnchor,
      queryYields: pool.stats,
      thin: pool.thin,
      loosened: pool.loosened,
      pooledCount: 0,
      verifiedCount: 0,
      topScored: [],
      slotting: { method: "score_heuristic", tierJudgeFallback: true },
      curatedPicks: [],
      curationFallback: true,
    });
    return {
      brief,
      products: [],
      curatedPicks: [],
      rawCount: 0,
      surfacedUpids: [],
      stats: pool.stats,
      thin: pool.thin,
      loosened: pool.loosened,
      portfolio: portfolioWithAnchor,
      slottingMethod: "score_heuristic",
      curationFallback: true,
      allowedProductIds: [],
    };
  }
  const scoreStart = Date.now();
  const buyerCurrency =
    params.context?.currency ?? brief.budget?.currency ?? "USD";
  const fxTable = await loadFxRates().catch(() => null);
  let candidateVectors: Map<string, number[]> | undefined;
  const skipBuyerTaste =
    isGiftArchetype(brief) || brief.recipient.kind === "other";
  if (
    !skipBuyerTaste &&
    params.tasteVector &&
    params.tasteVector.length &&
    isVoyageConfigured() &&
    Date.now() < deadline - 1500
  ) {
    const top = candidates.slice(0, VOYAGE_EMBED_CANDIDATES);
    const vectors = await embedTexts(
      top.map((c) => candidateEmbeddingText(c.product)),
      "document",
      {
        signal: params.signal,
        timeoutMs: Math.max(400, deadline - Date.now() - 1200),
      },
    );
    if (vectors) {
      candidateVectors = new Map();
      for (let i = 0; i < top.length; i++) {
        const v = vectors[i];
        if (v) candidateVectors.set(top[i]!.upid, v);
      }
    }
  }

  const scored = scorePool({
    brief,
    pool: candidates,
    tasteVector: skipBuyerTaste ? null : params.tasteVector,
    candidateVectors,
    feedback: params.feedback,
    buyerCurrency,
    fxTable,
  });
  const gatedScored = filterScoredByConstraints(scored, brief);
  const scoredForVerify = gatedScored.passed;
  gateMetrics = mergeGateMetrics(gateMetrics, {
    constraintGate: gatedScored.metrics,
  });
  if (gatedScored.metrics.drops.length) {
    logAiChat("info", "search_engine_constraint_gate", {
      query: brief.query.slice(0, 120),
      input: gatedScored.metrics.inputCount,
      output: gatedScored.metrics.outputCount,
      dropsByGate: gatedScored.metrics.dropsByGate,
    });
  }
  stageMs.score = Date.now() - scoreStart;
  const topScored = scoredForVerify.slice(0, 12).map((c) => ({
    productId: c.product.id,
    title: c.product.title,
    totalScore: c.breakdown.total,
    breakdown: c.breakdown,
  }));
  narrate("Ranking by quality, value, and fit");

  // ── Stage 4: availability verification ──────────────────────────────────
  const verifyStart = Date.now();
  const target = Math.min(Math.max(params.displayLimit + 6, 15), 20);
  const verifyResult = await verifyCandidates({
      accessToken: params.accessToken,
      candidates: scoredForVerify,
      brief,
      target,
      maxAttempts: 25,
      concurrency: 6,
      shipsToCountry: params.shipsToCountry,
      context: params.context,
      buyerCurrency,
      fxTable,
      signal: params.signal,
    });
  const verified = verifyResult.verified.filter((v) =>
    productPassesShippingTextGuard(v.detail, buyerCountry),
  );
  gateMetrics = mergeGateMetrics(gateMetrics, {
    verifyAttempted: verifyResult.attempted,
    verifySurvived: verified.length,
    sizeExactRequired: Boolean(brief.variantConstraints?.size?.trim()),
  });
  stageMs.verify = Date.now() - verifyStart;
  narrate(`Verified ${verified.length} in stock & ready to buy`);

  const candidatesWithAttributes = verified.filter(
    (v) => extractCatalogAttributes(v.detail).length > 0,
  ).length;
  logAiChat("info", "search_engine_attribute_coverage", {
    query: brief.query.slice(0, 120),
    verified: verified.length,
    withAttributes: candidatesWithAttributes,
  });

  if (!verified.length) {
    auditCollector?.finalize({
      brief,
      portfolio: portfolioWithAnchor,
      queryYields: pool.stats,
      thin: true,
      loosened: pool.loosened,
      pooledCount: candidates.length,
      verifiedCount: 0,
      topScored,
      slotting: { method: "score_heuristic", tierJudgeFallback: true },
      curatedPicks: [],
      curationFallback: true,
    });
    return {
      brief,
      products: [],
      curatedPicks: [],
      rawCount: candidates.length,
      surfacedUpids: [],
      stats: pool.stats,
      thin: true,
      loosened: pool.loosened,
      portfolio: portfolioWithAnchor,
      slottingMethod: "score_heuristic",
      curationFallback: true,
      allowedProductIds: [],
      constraintGate: gatedScored.metrics,
    };
  }

  // ── Stage 5: tier judgment + slotting ───────────────────────────────────
  const slotStart = Date.now();
  const retryDeadlineAt = slotStart + AGENTIC_POOL_RETRY_BUDGET_MS;
  let agenticRetryUsed = false;
  narrate("Curating picks from finalists");
  const slotted = await assignSlots({
    verified,
    brief,
    displayLimit: params.displayLimit,
    candidateCount: candidates.length,
    userId: params.userId,
    accessToken: params.accessToken,
    shipsToCountry: params.shipsToCountry,
    context: params.context,
    contextTag: params.contextTag,
    signal: params.signal,
    preBuiltMemoryXml: await tierJudgeMemoryXmlPromise,
    tierJudgeTimeoutMs: AI_CHAT_TIER_JUDGE_TIMEOUT_MS,
    onNarration: narrate,
    onTriageSkeleton: params.onSearchPartial,
    afterTriage: async (ctx) => {
      if (agenticRetryUsed || Date.now() >= retryDeadlineAt) return null;

      const assessment = assessPostTriagePool({
        verified: ctx.verified,
        triage: ctx.triage,
        preJudgeDrops: ctx.preJudgeDrops,
        brief: ctx.brief,
      });
      if (!assessment.needsRetry) return null;

      ctx.onNarration?.(`${assessment.summary} — trying one more search angle`);

      const queries = await planAgenticRetryQueries({
        assessment,
        brief: ctx.brief,
        portfolio: portfolioWithAnchor,
        signal: params.signal,
      });
      if (!queries.length) return null;

      const added = await runAgenticPoolRefillWave({
        accessToken: params.accessToken,
        brief: ctx.brief,
        queries,
        shipsToCountry: params.shipsToCountry,
        context: params.context,
        signal: params.signal,
        avoidTerms: params.avoidTerms,
        excludedKeys: params.excludedKeys,
        buyerCountry,
        buyerCurrency,
        fxTable,
        tasteVector: params.tasteVector,
        feedback: params.feedback,
        displayLimit: params.displayLimit,
        onMcpAudit: onMcpAudit
          ? (event) =>
              onMcpAudit({
                ...event,
                callKind: "agentic_retry",
              })
          : undefined,
        onNarration: ctx.onNarration,
      });
      if (!added.length) return null;

      agenticRetryUsed = true;
      logAiChat("info", "search_engine_agentic_retry", {
        query: brief.query.slice(0, 120),
        summary: assessment.summary,
        reasons: assessment.reasons,
        added: added.length,
        queries: queries.map((q) => q.text),
      });

      return {
        verified: mergeVerifiedByUpid(ctx.verified, added),
        summary: assessment.summary,
      };
    },
  });
  stageMs.slot = Date.now() - slotStart;
  stageMs.total = Date.now() - engineStart;

  const scoringGateDrops = gatedScored.metrics.drops;
  const ruledOutMap = new Map<string, ConstraintGateDrop>();
  for (const d of [...scoringGateDrops, ...(slotted.ruledOut ?? [])]) {
    if (!ruledOutMap.has(d.productId)) ruledOutMap.set(d.productId, d);
  }
  const ruledOut = [...ruledOutMap.values()];
  gateMetrics = mergeGateMetrics(gateMetrics, {
    judgeOmissions: slotted.ruledOut?.filter((d) => d.gate === "judge_omission")
      .length,
    judgePreGateDrops: slotted.ruledOut?.filter(
      (d) => d.gate !== "judge_omission",
    ).length,
    listingHygieneDropped: slotted.ruledOut?.filter(
      (d) => d.gate === "listing_hygiene",
    ).length,
  });
  narrate(
    `Curated ${slotted.picks.length} pick${slotted.picks.length === 1 ? "" : "s"}`,
  );

  if (buyerCurrency) {
    for (const card of slotted.products) {
      alignProductCardCurrency(card, buyerCurrency);
    }
    for (const pick of slotted.picks) {
      alignProductCardCurrency(pick, buyerCurrency);
    }
  }

  const sanity = evaluateResultSanity({
    brief,
    picks: slotted.picks,
    verified,
  });
  if (!sanity.ok) {
    logAiChat("warn", "search_engine_sanity_failed", {
      archetype: brief.archetype,
      reasons: sanity.reasons,
      pickCount: slotted.picks.length,
    });
  }

  logAiChat("info", "search_engine_complete", {
    archetype: brief.archetype,
    portfolio: portfolioWithAnchor.length,
    pooled: candidates.length,
    verified: verified.length,
    picks: slotted.picks.length,
    slottingMethod: slotted.method,
    curationFallback: slotted.curationFallback,
    tierJudgeFallback: slotted.tierJudgeFallback ?? false,
    tierJudgeFailureReason: slotted.tierJudgeFailureReason,
    stageMs,
    gateMetrics,
    durationMs: stageMs.total,
  });

  auditCollector?.finalize({
    brief,
    portfolio: portfolioWithAnchor,
    queryYields: pool.stats,
    thin: pool.thin,
    loosened: pool.loosened,
    pooledCount: candidates.length,
    verifiedCount: verified.length,
    topScored,
    slotting: {
      method: slotted.method,
      tierPlacements: slotted.tierPlacements,
      tierJudgeFallback: slotted.tierJudgeFallback,
      tierJudgeFailureReason: slotted.tierJudgeFailureReason,
      tierJudgePrompt: slotted.tierJudgePrompt,
      tierJudgeResult: slotted.tierJudgeResult,
      tierJudgeModel: slotted.tierJudgeModel,
    },
    curatedPicks: slotted.picks,
    curationFallback: slotted.curationFallback,
    stageMs,
    gateMetrics,
    constraintGate: gatedScored.metrics,
  });

  const poolFilterDrops = computePoolFilterDrops({
    catalogFetched: pooledCandidates,
    afterAvoid,
    afterShipping,
    afterGift,
    afterPoolFilters: candidates,
    avoidTerms: params.avoidTerms,
    buyerCountry,
  });

  const pipelineDebug = buildSearchPipelineDebug({
    searchKey: params.audit?.searchKey ?? brief.query,
    query: brief.query,
    brief,
    catalogFetched: unionPoolCandidates(pooledCandidates, candidates),
    fetched: candidates,
    poolFilterDrops,
    scoringConstraintDrops: gatedScored.metrics.drops,
    preVerify: scoredForVerify,
    verifyResult,
    slotting: slotted,
    slottingRuledOut: slotted.ruledOut,
  });
  try {
    params.onPipelineDebug?.(pipelineDebug);
  } catch {
    /* debug hook is best-effort */
  }

  return {
    brief,
    products: slotted.picks.length ? slotted.picks : slotted.products,
    curatedPicks: slotted.picks,
    rawCount: candidates.length,
    surfacedUpids: verified.map((v) => v.upid),
    stats: pool.stats,
    thin: pool.thin,
    loosened: pool.loosened,
    portfolio: portfolioWithAnchor,
    slottingMethod: slotted.method,
    curationFallback: slotted.curationFallback,
    tierPlacements: slotted.tierPlacements,
    ruledOut: ruledOut.length ? ruledOut : undefined,
    constraintGate: gatedScored.metrics,
    allowedProductIds: slotted.picks.map((p) => p.id),
    stageMs,
    gateMetrics,
    pipelineDebug,
  };
}

/** Reject narrator mentions of product ids outside the curated rack. */
export function validateNarratorProductMentions(
  text: string,
  allowedProductIds: string[],
): { ok: boolean; violations: string[] } {
  if (!allowedProductIds.length) return { ok: true, violations: [] };
  const allowed = new Set(allowedProductIds);
  const violations: string[] = [];
  const gidPattern = /gid:\/\/shopify\/Product\/[\w-]+/g;
  for (const match of text.match(gidPattern) ?? []) {
    if (!allowed.has(match)) violations.push(match);
  }
  return { ok: violations.length === 0, violations };
}

/** Compact tool-result payload summarizing engine output for the chat model. */
export function buildEngineToolResultPayload(
  result: EngineSearchResult,
): string {
  const fmtPrice = (p?: { amount: number; currency: string }) =>
    p ? `${(p.amount / 100).toFixed(2)} ${p.currency}` : undefined;
  const hero = heroPlacement(result.curatedPicks);
  const runnerUp = runnerUpPlacement(result.curatedPicks, hero);
  const killStats = buildKillStats({
    pooled: result.rawCount,
    ruledOut: result.ruledOut,
    survived: result.curatedPicks.length,
  });
  const rejectionSummary = gateReasonsForNarration(result.ruledOut, 5);
  const expertisePrinciples = getExpertisePrinciplesForNarrator(
    result.brief.query,
    result.brief.category,
  );
  const placements = result.curatedPicks.map((p) => ({
    product_id: p.id,
    tier: (p as CuratedPick & { tier?: number }).tier ?? undefined,
    slot: p.slot,
    title: p.title,
    price: fmtPrice(p.displayPrice ?? p.priceRange?.min),
    verdict: p.verdict,
    reason: p.reason,
    caveat: p.caveat,
    in_stock: p.availability?.status ?? "unknown",
    native_checkout: Boolean(p.nativeCheckoutUrl),
    is_hero: hero?.id === p.id,
  }));
  const ruledOut = (result.ruledOut ?? []).map((d) => ({
    product_id: d.productId,
    title: d.title,
    reason: d.reason,
    gate: d.gate,
  }));
  const narration = buildNarratorInstructions({
    brief: result.brief,
    killStats,
    hero,
    runnerUp,
    rejectionLines: rejectionSummary,
    expertisePrinciples,
  });
  return JSON.stringify({
    query: result.brief.query,
    archetype: result.brief.archetype,
    direction_label: result.brief.directionLabel ?? undefined,
    occasion_resolution: result.brief.provenance?.occasionResolution,
    curation_stats: killStats,
    rejection_summary: rejectionSummary.length ? rejectionSummary : undefined,
    expertise_principles: expertisePrinciples.length
      ? expertisePrinciples
      : undefined,
    hero_product_id: hero?.id,
    runner_up_product_id: runnerUp?.id,
    allowed_product_ids: result.allowedProductIds,
    placements,
    ruled_out: ruledOut.length ? ruledOut : undefined,
    thin: result.thin,
    loosened: result.loosened,
    narration_contract: narration,
  });
}
