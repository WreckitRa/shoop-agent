/**
 * Batched Haiku fallback for size labels the deterministic resolver could not
 * classify. One call per search wave — not per product.
 */
import { createLightweightMessage } from "../anthropic";
import { AI_CHAT_LIGHTWEIGHT_MODEL } from "../constants";
import { parseLlmJsonObject } from "../shopping-memory/llm-json";
import { logAiChat } from "../observability";
import type { ScoredCandidate } from "./types";
import type { SearchBrief } from "./types";
import {
  applyLlmSizeResolution,
  expandRequestedSizeTokens,
  resolveSizeDeterministic,
  sizeResolutionContextFromBrief,
  sizeResolutionLlmPayload,
  sizeResolutionNeedsLlm,
  type SizeResolution,
  type SizeResolutionMap,
} from "./size-resolution";

export const SIZE_RESOLUTION_LLM_TIMEOUT_MS = parseIntEnv(
  process.env.SIZE_RESOLUTION_LLM_TIMEOUT_MS,
  3500,
);

export const SIZE_RESOLUTION_LLM_MIN_CONFIDENCE = 0.85;

function parseIntEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 500) return fallback;
  return Math.min(Math.round(n), 10_000);
}

export function sizeResolutionLlmEnabled(): boolean {
  const raw = process.env.SIZE_RESOLUTION_LLM?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

type LlmSizeRow = {
  id: string;
  verdict: "match" | "mismatch" | "unknown";
  resolved_label?: string;
  parsed_listing_size?: string;
  confidence?: number;
  reason?: string;
};

const SIZE_MATCH_TOOL = {
  name: "size_match_results",
  description: "Per-product size match verdicts for catalog listings.",
  input_schema: {
    type: "object" as const,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            verdict: {
              type: "string",
              enum: ["match", "mismatch", "unknown"],
            },
            resolved_label: { type: "string" },
            parsed_listing_size: { type: "string" },
            confidence: { type: "number" },
            reason: { type: "string" },
          },
          required: ["id", "verdict", "confidence"],
        },
      },
    },
    required: ["results"],
  },
};

async function batchLlmSizeResolution(params: {
  requestedSize: string;
  brief: SearchBrief;
  escalations: ScoredCandidate[];
  prior: SizeResolutionMap;
  signal?: AbortSignal;
}): Promise<SizeResolutionMap> {
  const out = new Map<string, SizeResolution>();
  if (!params.escalations.length || !sizeResolutionLlmEnabled()) return out;

  const ctx = sizeResolutionContextFromBrief(params.brief);
  const parsed = expandRequestedSizeTokens(params.requestedSize);
  const products = params.escalations.map((c) =>
    sizeResolutionLlmPayload(c, ctx, parsed),
  );

  const prompt = JSON.stringify({
    task: "For each product, decide whether the buyer's requested size matches any size on the listing. Merchant labels are arbitrary (e.g. m-(38), m 50-60 kg, l or large, 2xl-(46), CN/EU codes). US/UK suiting chest sizes (40R, 42R, 42) map to letter sizes: ~38→S, ~40→M, ~42→L, ~44→XL. Weight-band labels (kg) use inferred_letter when present. The brief may combine letter + chest (e.g. M / 40R) — treat as related signals. For single-SKU listings, parse size from title.",
    requested_size: params.requestedSize,
    brief_size_tokens: parsed.tokens,
    category: params.brief.category ?? null,
    query: params.brief.query,
    products,
    rules: [
      "match: buyer can buy this listing in their size — pick the exact merchant size_labels entry as resolved_label",
      "mismatch: listing is clearly too small/large for the buyer (not merely a different label scheme)",
      "unknown: not enough signal — prefer unknown over guessing",
      "resolved_label: exact merchant Size option label when multi-variant",
      "confidence 0-1; use >=0.85 only when certain",
    ],
  });

  const call = createLightweightMessage(
    {
      model: AI_CHAT_LIGHTWEIGHT_MODEL,
      max_tokens: 1200,
      tools: [SIZE_MATCH_TOOL],
      tool_choice: { type: "tool", name: SIZE_MATCH_TOOL.name },
      messages: [{ role: "user", content: prompt }],
    },
    { signal: params.signal },
  );

  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), SIZE_RESOLUTION_LLM_TIMEOUT_MS),
  );

  try {
    const msg = await Promise.race([call, timeout]);
    if (!msg) {
      logAiChat("warn", "size_resolution_llm_timeout", {
        count: params.escalations.length,
      });
      return out;
    }

    const block = msg.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> =>
        b.type === "tool_use" && b.name === SIZE_MATCH_TOOL.name,
    );
    const parsedMsg = block
      ? parseLlmJsonObject(JSON.stringify(block.input))
      : parseLlmJsonObject(
          msg.content
            .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
            .map((b) => b.text)
            .join("\n"),
        );
    const results = (parsedMsg as { results?: LlmSizeRow[] } | null)?.results;
    if (!Array.isArray(results)) return out;

    for (const row of results) {
      if (!row?.id) continue;
      const candidate = params.escalations.find((c) => c.product.id === row.id);
      if (!candidate) continue;
      const prior =
        params.prior.get(candidate.upid) ??
        resolveSizeDeterministic(params.requestedSize, candidate.product, ctx);
      out.set(candidate.upid, applyLlmSizeResolution(prior, row));
    }
  } catch (err) {
    logAiChat("warn", "size_resolution_llm_failed", {
      error: String(err).slice(0, 160),
    });
  }

  return out;
}

/**
 * Resolve requested size for every candidate: deterministic first, then one
 * batched LLM pass for unknown/ambiguous cases (fail-closed when size required).
 */
export async function resolveSizeForCandidates(params: {
  requestedSize: string | undefined;
  candidates: ScoredCandidate[];
  brief: SearchBrief;
  signal?: AbortSignal;
}): Promise<SizeResolutionMap> {
  const map: SizeResolutionMap = new Map();
  const requested = params.requestedSize?.trim();
  if (!requested) return map;

  const ctx = sizeResolutionContextFromBrief(params.brief);
  const parsed = expandRequestedSizeTokens(requested);
  const escalations: ScoredCandidate[] = [];

  for (const c of params.candidates) {
    const resolution = resolveSizeDeterministic(requested, c.product, ctx);
    map.set(c.upid, resolution);
    if (sizeResolutionNeedsLlm(resolution, parsed, c.product)) {
      escalations.push(c);
    }
  }

  if (!escalations.length) return map;

  const llmMap = await batchLlmSizeResolution({
    requestedSize: requested,
    brief: params.brief,
    escalations,
    prior: map,
    signal: params.signal,
  });

  for (const [upid, resolution] of llmMap) {
    map.set(upid, resolution);
  }

  return map;
}
