/**
 * Single bounded agentic refill — after wide triage, Claude rewrites catalog queries
 * from pool assessment + fires one more wave before comparative judging.
 */
import type { Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages/messages";
import { getAnthropicClient } from "../anthropic";
import {
  AGENTIC_POOL_RETRY_PLANNER_TIMEOUT_MS,
  AI_CHAT_LIGHTWEIGHT_MODEL,
} from "../constants";
import { logAiChat } from "../observability";
import { parseLlmJsonObject } from "../shopping-memory/llm-json";
import { isGiftMerchandiseTitle } from "./gift-merchandise";
import type { FxRateTable } from "@/lib/shopify/fx-rates";
import { isNoveltyMerchTitle } from "./novelty-merch";
import type { PostTriageAssessment } from "./post-triage-assessment";
import { buildPool } from "./pool";
import { collapseNearDuplicateCandidates } from "./pool-health";
import {
  craftPortfolioQuery,
  sanitizePortfolioQueries,
} from "./query-hygiene";
import { portfolioQueryFromText } from "./portfolio-planner-shared";
import { isGiftArchetype } from "./portfolio";
import { productPassesShippingTextGuard } from "./shipping-text-guard";
import { scorePool, type FeedbackAvoidSet } from "./scoring";
import { filterScoredByConstraints } from "./constraint-gate";
import type { PortfolioQuery, SearchBrief } from "./types";
import { verifyCandidates, type VerifiedCandidate } from "./verify";
import type { CatalogSearchContext } from "@/lib/shopify/catalog";
import type { EngineMcpAuditEvent } from "./engine-audit";

const RETRY_QUERY_TOOL = "emit_retry_queries";
const MAX_RETRY_QUERIES = 4;

const retryQueryTool: Tool = {
  name: RETRY_QUERY_TOOL,
  description:
    "Emit 2–4 distinct Shopify catalog product search queries reacting to a thin pool.",
  input_schema: {
    type: "object",
    properties: {
      pool_diagnosis: {
        type: "string",
        description: "One sentence on what the first wave missed.",
      },
      queries: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Product-type search string (noun + 2–4 attributes).",
            },
            intent: { type: "string" },
          },
          required: ["text"],
        },
      },
    },
    required: ["pool_diagnosis", "queries"],
  },
};

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

function mergeVerifiedByUpid(
  existing: VerifiedCandidate[],
  incoming: VerifiedCandidate[],
): VerifiedCandidate[] {
  const byUpid = new Map<string, VerifiedCandidate>();
  for (const v of existing) byUpid.set(v.upid, v);
  for (const v of incoming) {
    if (!byUpid.has(v.upid)) byUpid.set(v.upid, v);
  }
  return [...byUpid.values()].sort((a, b) => b.score - a.score);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** LLM query rewrite from post-triage assessment — one shot, bounded timeout. */
export async function planAgenticRetryQueries(params: {
  assessment: PostTriageAssessment;
  brief: SearchBrief;
  portfolio: PortfolioQuery[];
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<PortfolioQuery[]> {
  const { assessment, brief, portfolio } = params;
  const timeoutMs = params.timeoutMs ?? AGENTIC_POOL_RETRY_PLANNER_TIMEOUT_MS;
  const existingTexts = portfolio.map((q) => q.text).join("\n- ");
  const dropNotes = assessment.triageDropNotes.slice(0, 6).join("\n- ");

  const userPrompt = [
    `Request: ${brief.query.trim()}`,
    brief.useCase ? `Occasion: ${brief.useCase}` : null,
    brief.mustHaves.length ? `Must-haves: ${brief.mustHaves.join(", ")}` : null,
    "",
    `Pool assessment: ${assessment.summary}`,
    `Retry reasons: ${assessment.reasons.join(", ") || "thin pool"}`,
    assessment.triageDropNotes.length
      ? `Triage drops:\n- ${dropNotes}`
      : null,
    "",
    "Queries already tried (do NOT repeat or lightly rephrase):",
    existingTexts ? `- ${existingTexts}` : "(none recorded)",
    "",
    "Write 2–4 NEW product-type catalog queries that fill the gap — different product subtypes, materials, or anchor brands. React to what failed; do not echo the original seed query.",
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You are Shoop's reactive catalog search strategist. The first search wave returned a thin or mismatched pool. Output distinct Shopify product search queries only — real product types with attributes, never "gift ideas".`;

  const anthropic = getAnthropicClient();
  try {
    const msg = await withTimeout(
      anthropic.messages.create(
        {
          model: AI_CHAT_LIGHTWEIGHT_MODEL,
          max_tokens: 768,
          system,
          tools: [retryQueryTool],
          tool_choice: { type: "tool", name: RETRY_QUERY_TOOL },
          messages: [{ role: "user", content: userPrompt }],
        },
        params.signal ? { signal: params.signal } : undefined,
      ),
      timeoutMs,
      "agentic_retry_planner",
    );

    const toolBlock = msg.content.find(
      (b): b is ToolUseBlock =>
        b.type === "tool_use" && b.name === RETRY_QUERY_TOOL,
    );
    if (!toolBlock?.input || typeof toolBlock.input !== "object") return [];

    const root = toolBlock.input as Record<string, unknown>;
    const rows = root.queries;
    if (!Array.isArray(rows)) return [];

    const seen = new Set(portfolio.map((q) => q.text.toLowerCase()));
    const out: PortfolioQuery[] = [];

    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const rawText = String(r.text ?? "").trim();
      if (!rawText) continue;
      const { text, intent } = craftPortfolioQuery(
        rawText,
        brief,
        "agentic retry wave",
      );
      if (seen.has(text.toLowerCase())) continue;
      const pq = portfolioQueryFromText(brief, text, {
        wave: 2,
        intent: String(r.intent ?? intent ?? ""),
      });
      if (!pq) continue;
      out.push(pq);
      seen.add(text.toLowerCase());
      if (out.length >= MAX_RETRY_QUERIES) break;
    }

    return sanitizePortfolioQueries(out, brief);
  } catch (error) {
    logAiChat("warn", "agentic_retry_planner_failed", {
      query: brief.query.slice(0, 120),
      error: String(error).slice(0, 200),
    });
    return [];
  }
}

export type AgenticPoolRefillParams = {
  accessToken: string;
  brief: SearchBrief;
  queries: PortfolioQuery[];
  shipsToCountry?: string;
  context?: CatalogSearchContext;
  signal?: AbortSignal;
  avoidTerms?: string[];
  excludedKeys?: Set<string>;
  buyerCountry?: string;
  buyerCurrency?: string | null;
  fxTable?: FxRateTable | null;
  tasteVector?: number[] | null;
  feedback?: FeedbackAvoidSet;
  displayLimit: number;
  onMcpAudit?: (event: EngineMcpAuditEvent) => void;
  onNarration?: (line: string) => void;
};

/** One catalog wave → score → verify. Returns newly verified candidates only. */
export async function runAgenticPoolRefillWave(
  params: AgenticPoolRefillParams,
): Promise<VerifiedCandidate[]> {
  const { brief, buyerCountry } = params;
  if (!params.queries.length) return [];

  params.onNarration?.("Running a follow-up catalog search");

  const pool = await buildPool({
    accessToken: params.accessToken,
    brief,
    shipsToCountry: params.shipsToCountry,
    context: params.context,
    excludedKeys: params.excludedKeys,
    signal: params.signal,
    onMcpAudit: params.onMcpAudit
      ? (event) =>
          params.onMcpAudit!({
            ...event,
            callKind: "agentic_retry",
          })
      : undefined,
    queries: params.queries,
    limit: 24,
  });

  let candidates = filterAvoided(pool.candidates, params.avoidTerms);
  if (buyerCountry) {
    candidates = candidates.filter((c) =>
      productPassesShippingTextGuard(c.product, buyerCountry),
    );
  }

  if (isGiftArchetype(brief)) {
    candidates = candidates.filter(
      (c) =>
        !isGiftMerchandiseTitle(c.product.title ?? "") &&
        !isNoveltyMerchTitle(c.product.title ?? ""),
    );
  }

  candidates = collapseNearDuplicateCandidates(candidates);
  if (!candidates.length) return [];

  const skipBuyerTaste = isGiftArchetype(brief) || brief.recipient.kind === "other";
  const scored = scorePool({
    brief,
    pool: candidates,
    tasteVector: skipBuyerTaste ? null : params.tasteVector,
    feedback: params.feedback,
    buyerCurrency: params.buyerCurrency,
    fxTable: params.fxTable,
  });
  const gated = filterScoredByConstraints(scored, brief);
  if (!gated.passed.length) return [];

  const target = Math.min(Math.max(params.displayLimit + 4, 8), 12);
  const { verified: rawVerified } = await verifyCandidates({
    accessToken: params.accessToken,
    candidates: gated.passed,
    brief,
    target,
    maxAttempts: 14,
    concurrency: 4,
    shipsToCountry: params.shipsToCountry,
    context: params.context,
    buyerCurrency: params.buyerCurrency,
    fxTable: params.fxTable,
    signal: params.signal,
  });

  const verified = buyerCountry
    ? rawVerified.filter((v) =>
        productPassesShippingTextGuard(v.detail, buyerCountry),
      )
    : rawVerified;

  logAiChat("info", "agentic_pool_refill_complete", {
    query: brief.query.slice(0, 120),
    queries: params.queries.length,
    pooled: pool.candidates.length,
    verified: verified.length,
  });

  return verified;
}

export { mergeVerifiedByUpid };
