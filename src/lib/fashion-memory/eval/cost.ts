import { readFile } from "node:fs/promises";
import path from "node:path";

/** USD per 1M tokens — conservative eval estimates. */
export const MODEL_USD_PER_MTOK: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  "claude-opus-4-8": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-sonnet-5": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-haiku-4-5-20251001": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 1,
  },
};

/** Fallback when no prior run cost data exists. */
export const DEFAULT_PERSONA_USD = 0.28;

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

export function estimateUsdFromTokens(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}): number {
  const rates =
    MODEL_USD_PER_MTOK[params.model] ??
    MODEL_USD_PER_MTOK["claude-sonnet-5"]!;
  const uncachedInput = Math.max(
    0,
    params.inputTokens - (params.cacheReadInputTokens ?? 0),
  );
  const usd =
    (uncachedInput * rates.input) / 1_000_000 +
    ((params.cacheReadInputTokens ?? 0) * rates.cacheRead) / 1_000_000 +
    ((params.cacheCreationInputTokens ?? 0) * rates.cacheWrite) / 1_000_000 +
    (params.outputTokens * rates.output) / 1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}

/** Router + shopper + Opus judge — used when token usage is unavailable. */
export function estimatePersonaPipelineUsd(stage: "router" | "full"): number {
  const router = estimateUsdFromTokens({
    model: "claude-sonnet-5",
    inputTokens: 12_000,
    outputTokens: 800,
    cacheReadInputTokens: 10_000,
  });
  const shopper = estimateUsdFromTokens({
    model: "claude-haiku-4-5-20251001",
    inputTokens: 2_500,
    outputTokens: 120,
  });
  const judgeOpus = estimateUsdFromTokens({
    model: "claude-opus-4-8",
    inputTokens: 4_000,
    outputTokens: 400,
  });
  const extra = stage === "full" ? 0.2 : 0;
  return Math.round((router + shopper + judgeOpus + extra) * 100) / 100;
}

export type RunCostSummary = {
  projected_usd: number;
  actual_usd: number;
  per_persona_avg_usd: number;
};

export async function loadPreviousRunAvgPersonaUsd(
  previousRunDir: string | null,
): Promise<number | null> {
  if (!previousRunDir) return null;
  try {
    const raw = JSON.parse(
      await readFile(path.join(previousRunDir, "summary.json"), "utf8"),
    ) as {
      cost?: { per_persona_avg_usd?: number; actual_usd?: number; eligible?: number };
      eligible?: number;
    };
    if (typeof raw.cost?.per_persona_avg_usd === "number") {
      return raw.cost.per_persona_avg_usd;
    }
    if (
      typeof raw.cost?.actual_usd === "number" &&
      typeof raw.eligible === "number" &&
      raw.eligible > 0
    ) {
      return raw.cost.actual_usd / raw.eligible;
    }
    return null;
  } catch {
    return null;
  }
}

export function projectedRunUsd(params: {
  personaCount: number;
  perPersonaAvgUsd: number | null;
}): number {
  const avg = params.perPersonaAvgUsd ?? DEFAULT_PERSONA_USD;
  return Math.round(params.personaCount * avg * 100) / 100;
}
