import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { CuratedPick } from "../types";
import {
  recordCatalogSearchRun,
  type CatalogMcpExchange,
  type CatalogSearchAuditContext,
} from "@/lib/shopify/catalog-mcp-audit";
import type { QueryYieldStat } from "./pool";
import type { PortfolioQuery, ScoreBreakdown, SearchBrief } from "./types";
import type { TierPlacement } from "../judgment/tier-judge";
import type { ConstraintGateMetrics } from "./constraint-gate";
import type { PipelineGateMetrics, PipelineStageMs } from "./pipeline-metrics";

export type EngineMcpCallKind =
  | "portfolio"
  | "portfolio_broaden"
  | "portfolio_loosen"
  | "corrective"
  | "agentic_retry"
  | "get_product";

export type EngineMcpAuditEvent = {
  exchange: CatalogMcpExchange;
  callKind: EngineMcpCallKind;
  queryText: string;
  portfolioQueryId?: string;
  effectiveInput: Record<string, unknown>;
  products: CatalogProductSummary[];
  error?: string | null;
};

export type EngineSummaryV1 = {
  version: 1;
  brief: SearchBrief;
  portfolio: Array<{
    id: string;
    text: string;
    intent?: string;
    isDiscovery?: boolean;
    directionLabel?: string;
    wave?: number;
  }>;
  queryYields: QueryYieldStat[];
  thin: boolean;
  loosened: boolean;
  pooledCount: number;
  verifiedCount: number;
  topScored: Array<{
    productId: string;
    title: string;
    totalScore: number;
    breakdown: ScoreBreakdown;
  }>;
  slotting: {
    method: "tier_judge" | "score_heuristic";
    tierPlacements?: TierPlacement[];
    tierJudgeFallback?: boolean;
    tierJudgeFailureReason?:
      | "timeout_or_error"
      | "empty_placements"
      | "slotting_empty";
    tierJudgePrompt?: string;
    tierJudgeResult?: string;
    tierJudgeModel?: string;
  };
  stageMs?: PipelineStageMs;
  gateMetrics?: PipelineGateMetrics;
  constraintGate?: ConstraintGateMetrics;
};

export type EngineSearchAuditCollector = {
  recordMcp: (event: EngineMcpAuditEvent) => void;
  finalize: (input: {
    brief: SearchBrief;
    portfolio: PortfolioQuery[];
    queryYields: QueryYieldStat[];
    thin: boolean;
    loosened: boolean;
    pooledCount: number;
    verifiedCount: number;
    topScored: EngineSummaryV1["topScored"];
    slotting: EngineSummaryV1["slotting"];
    curatedPicks: CuratedPick[];
    curationFallback: boolean;
    stageMs?: PipelineStageMs;
    gateMetrics?: PipelineGateMetrics;
    constraintGate?: ConstraintGateMetrics;
  }) => void;
};

const SUMMARY_ATTEMPT = 0;

export function createEngineSearchAuditCollector(
  context: CatalogSearchAuditContext,
  toolInput: Record<string, unknown>,
): EngineSearchAuditCollector {
  let mcpAttempt = 1;

  return {
    recordMcp(event) {
      recordCatalogSearchRun({
        ...context,
        attempt: mcpAttempt++,
        callKind: event.callKind,
        portfolioQueryId: event.portfolioQueryId ?? null,
        query: event.queryText,
        toolInput,
        effectiveInput: event.effectiveInput,
        exchange: event.exchange,
        products: event.products,
        error: event.error ?? null,
      });
    },

    finalize(input) {
      const engineSummary: EngineSummaryV1 = {
        version: 1,
        brief: input.brief,
        portfolio: input.portfolio.map((q) => ({
          id: q.id,
          text: q.text,
          intent: q.intent,
          isDiscovery: q.isDiscovery,
          directionLabel: q.directionLabel,
          wave: q.wave,
        })),
        queryYields: input.queryYields,
        thin: input.thin,
        loosened: input.loosened,
        pooledCount: input.pooledCount,
        verifiedCount: input.verifiedCount,
        topScored: input.topScored,
        slotting: input.slotting,
        stageMs: input.stageMs,
        gateMetrics: input.gateMetrics,
        constraintGate: input.constraintGate,
      };

      recordCatalogSearchRun({
        ...context,
        attempt: SUMMARY_ATTEMPT,
        callKind: "engine_summary",
        query: input.brief.query,
        toolInput,
        effectiveInput: null,
        exchange: null,
        products: [],
        curatedPicks: input.curatedPicks,
        curationFallback: input.curationFallback,
        engineSummary: engineSummary as unknown as Record<string, unknown>,
      });
    },
  };
}

export function engineSummaryFromJson(raw: unknown): EngineSummaryV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as EngineSummaryV1;
  if (row.version !== 1) return null;
  return row;
}

export function curatedPicksFromToolResult(
  resultText: string,
): CuratedPickSummary[] {
  try {
    const parsed = JSON.parse(resultText) as {
      picks?: Array<{
        slot?: string;
        title?: string;
        verdict?: string;
        reason?: string;
      }>;
    };
    if (!Array.isArray(parsed.picks)) return [];
    return parsed.picks.map((p) => ({
      slot: p.slot,
      title: p.title,
      verdict: p.verdict,
      reason: p.reason,
    }));
  } catch {
    return [];
  }
}

export type CuratedPickSummary = {
  slot?: string;
  title?: string;
  verdict?: string;
  reason?: string;
  id?: string;
};
