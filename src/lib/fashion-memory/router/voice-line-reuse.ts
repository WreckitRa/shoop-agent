/**
 * Voice line-reuse gate: never code-substitute reply text.
 * If the spoken reply is banned or already seen ≥2× in this run
 * (eval) / conversation (prod), one LLM rewrite via gateNote.
 * If the rewrite still reuses, accept and log line_reuse_persisted.
 */

import { logAiChat } from "@/lib/ai-chat/observability";
import { recordPipelineEvent } from "@/lib/fashion-memory/observability/trace";
import {
  runFashionRouter,
  type RunFashionRouterDeps,
} from "@/lib/fashion-memory/router/llm-router";
import type {
  FashionRouterContext,
  FashionRouterResult,
} from "@/lib/fashion-memory/router/types";
import {
  isBannedStylistLine,
  normalizeLine,
} from "@/lib/fashion-memory/router/voice-hygiene";

export const LINE_REUSE_REWRITE_NOTE =
  "rewrite the reply in fresh words; name the occasion or garment in the client's own words; no stock closer";

export type LineReuseMetrics = {
  spoken_turns: number;
  flagged: number;
  retries: number;
  persisted: number;
};

function emptyMetrics(): LineReuseMetrics {
  return { spoken_turns: 0, flagged: 0, retries: 0, persisted: 0 };
}

/** Eval-only: shared across personas in one appointment-eval process. */
let evalRunCounts: Map<string, number> | null = null;
let metrics: LineReuseMetrics = emptyMetrics();

export function beginLineReuseRun(): void {
  evalRunCounts = new Map();
  metrics = emptyMetrics();
}

export function endLineReuseRun(): LineReuseMetrics {
  const snap = { ...metrics };
  evalRunCounts = null;
  metrics = emptyMetrics();
  return snap;
}

export function snapshotLineReuseMetrics(): LineReuseMetrics {
  return { ...metrics };
}

export function spokenReplyKey(reply: string | null | undefined): string {
  const raw = (reply ?? "")
    .replace(/\nSearching the stores[\s\S]*/i, "")
    .trim();
  if (!raw) return "";
  if (/^searching the stores\.?$/i.test(raw)) return "";
  return normalizeLine(raw);
}

function conversationPriorCount(
  key: string,
  messages: Array<{ role: string; content: string }>,
): number {
  let n = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    if (spokenReplyKey(m.content) === key) n++;
  }
  return n;
}

/** Prior sightings before accepting this reply. */
export function priorSpokenCount(
  key: string,
  conversationMessages: Array<{ role: string; content: string }>,
): number {
  if (!key) return 0;
  if (evalRunCounts) return evalRunCounts.get(key) ?? 0;
  return conversationPriorCount(key, conversationMessages);
}

export function shouldRejectSpokenReply(params: {
  reply: string | null | undefined;
  conversationMessages: Array<{ role: string; content: string }>;
}): "banned" | "reuse" | null {
  const key = spokenReplyKey(params.reply);
  if (!key) return null;
  if (isBannedStylistLine(params.reply)) return "banned";
  if (priorSpokenCount(key, params.conversationMessages) >= 2) return "reuse";
  return null;
}

export function recordSpokenReply(reply: string | null | undefined): void {
  const key = spokenReplyKey(reply);
  if (!key) return;
  metrics.spoken_turns++;
  if (!evalRunCounts) return;
  evalRunCounts.set(key, (evalRunCounts.get(key) ?? 0) + 1);
}

function extractSpoken(result: FashionRouterResult): string {
  if (result.move === "ready_to_search") {
    return (
      result.reply?.trim() ||
      result.pull_line?.trim() ||
      ""
    );
  }
  if (result.move === "ask_clarification") {
    return result.reply?.trim() || "";
  }
  return result.reply?.trim() || "";
}

function withSpoken(
  result: FashionRouterResult,
  spoken: string,
): FashionRouterResult {
  const trimmed = spoken.trim();
  if (!trimmed) return result;
  if (result.move === "ready_to_search") {
    return { ...result, reply: trimmed, pull_line: trimmed };
  }
  if (result.move === "ask_clarification") {
    return { ...result, reply: trimmed };
  }
  return { ...result, reply: trimmed };
}

/**
 * One-shot rewrite when reply is banned or already seen ≥2×.
 * Never invents replacement text in code.
 */
export async function applyVoiceLineReuseGate(params: {
  result: FashionRouterResult;
  context: FashionRouterContext;
  signal?: AbortSignal;
  traceId: string;
  deps?: RunFashionRouterDeps;
}): Promise<FashionRouterResult> {
  const spoken = extractSpoken(params.result);
  if (!spoken) return params.result;

  const reason = shouldRejectSpokenReply({
    reply: spoken,
    conversationMessages: params.context.conversationMessages,
  });
  if (!reason) {
    recordSpokenReply(spoken);
    return params.result;
  }

  metrics.flagged++;
  metrics.retries++;
  recordPipelineEvent({
    traceId: params.traceId,
    stage: "gate",
    payload: {
      kind: "line_reuse_retry",
      reason,
      reply_preview: spoken.slice(0, 120),
    },
  });
  logAiChat("info", "line_reuse_retry", {
    traceId: params.traceId,
    reason,
  });

  let next = params.result;
  try {
    const retried = await runFashionRouter(
      {
        context: params.context,
        signal: params.signal,
        gateNote: LINE_REUSE_REWRITE_NOTE,
        traceId: params.traceId,
        stage: "gate_retry",
      },
      params.deps,
    );
    if (retried.move === params.result.move) {
      const rewritten = extractSpoken(retried);
      if (rewritten) next = withSpoken(params.result, rewritten);
    }
  } catch (e) {
    logAiChat("warn", "line_reuse_retry_failed", {
      traceId: params.traceId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const after = extractSpoken(next);
  if (!after) {
    next = params.result;
  }
  const finalSpoken = extractSpoken(next);
  const stillBad = shouldRejectSpokenReply({
    reply: finalSpoken,
    conversationMessages: params.context.conversationMessages,
  });
  if (stillBad) {
    metrics.persisted++;
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "gate",
      payload: {
        kind: "line_reuse_persisted",
        reason: stillBad,
        reply_preview: finalSpoken.slice(0, 120),
      },
    });
    logAiChat("info", "line_reuse_persisted", {
      traceId: params.traceId,
      reason: stillBad,
    });
  }

  recordSpokenReply(finalSpoken || spoken);
  return next;
}

export function lineReuseRates(m: LineReuseMetrics): {
  line_reuse_rate: number;
  retry_rate: number;
  persisted_rate: number;
} {
  const denom = Math.max(1, m.spoken_turns);
  const pct = (n: number) => Math.round((n / denom) * 1000) / 10;
  return {
    line_reuse_rate: pct(m.flagged),
    retry_rate: pct(m.retries),
    persisted_rate: pct(m.persisted),
  };
}
