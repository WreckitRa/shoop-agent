import { logAiChat } from "@/lib/ai-chat/observability";
import { fashionMemoryDb } from "../db";
import type { TraceStatus } from "./constants";
import { maybeRedactExpiredTraceBodies } from "./cleanup";
import {
  compactPipelineEventPayload,
  PIPELINE_EVENT_CHAT_MAX,
  type CompactPipelineEvent,
} from "./pipeline-event-payloads";

export type FashionTraceSummary = {
  route?: string;
  mode?: string;
  slots?: number;
  total_hits?: number;
  total_ms?: number;
  trace_id?: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Open a trace row at turn start. Returns trace id after insert succeeds (or best-effort on failure). */
export async function openFashionTrace(params: {
  userId: string;
  conversationId: string;
  kind?: string;
}): Promise<string> {
  const traceId = crypto.randomUUID();
  if (testPipelineCapture) {
    return traceId;
  }
  void maybeRedactExpiredTraceBodies();
  const { error } = await fashionMemoryDb()
    .from("traces")
    .insert({
      id: traceId,
      user_id: params.userId,
      conversation_id: params.conversationId,
      kind: params.kind ?? "search_turn",
      status: "open",
    });
  if (error) {
    logAiChat("warn", "fashion_trace_open_failed", {
      traceId,
      error: error.message,
    });
  }
  return traceId;
}

/** Per-turn in-memory buffer so chat metadata can carry pipeline events. */
const turnPipelineBuffers = new Map<string, CompactPipelineEvent[]>();

export function beginTurnPipelineBuffer(traceId: string): void {
  if (!isUuid(traceId)) return;
  turnPipelineBuffers.set(traceId, []);
}

export function drainTurnPipelineBuffer(
  traceId: string | null | undefined,
): CompactPipelineEvent[] {
  if (!traceId || !isUuid(traceId)) return [];
  const events = turnPipelineBuffers.get(traceId) ?? [];
  turnPipelineBuffers.delete(traceId);
  return events;
}

function pushTurnPipelineEvent(
  traceId: string | null | undefined,
  stage: string,
  payload: Record<string, unknown>,
): void {
  if (!traceId || !isUuid(traceId)) return;
  const buf = turnPipelineBuffers.get(traceId);
  if (!buf) return;
  if (buf.length >= PIPELINE_EVENT_CHAT_MAX) {
    if (buf.length === PIPELINE_EVENT_CHAT_MAX) {
      buf.push({
        stage: "_buffer_capped",
        payload: {
          message: `Capped at ${PIPELINE_EVENT_CHAT_MAX} events — view in admin`,
          trace_id: traceId,
        },
        truncated: true,
      });
    }
    return;
  }
  const compact = compactPipelineEventPayload(payload);
  buf.push({
    stage,
    payload: compact.payload,
    ...(compact.truncated ? { truncated: true } : {}),
  });
}

export function recordPipelineEvent(params: {
  traceId?: string | null;
  stage: string;
  payload: Record<string, unknown>;
}): void {
  if (testPipelineCapture) {
    testPipelineCapture.push({
      traceId: params.traceId ?? null,
      stage: params.stage,
      payload: params.payload,
    });
    pushTurnPipelineEvent(params.traceId, params.stage, params.payload);
    return;
  }
  pushTurnPipelineEvent(params.traceId, params.stage, params.payload);
  if (!params.traceId || !isUuid(params.traceId)) return;
  void fashionMemoryDb()
    .from("pipeline_events")
    .insert({
      trace_id: params.traceId,
      stage: params.stage,
      payload: params.payload,
    })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) {
        logAiChat("warn", "fashion_pipeline_event_failed", {
          traceId: params.traceId,
          stage: params.stage,
          error: error.message,
        });
      }
    });
}

export function closeFashionTrace(params: {
  traceId?: string | null;
  status?: TraceStatus;
  summary?: FashionTraceSummary;
}): void {
  if (testPipelineCapture) return;
  if (!params.traceId || !isUuid(params.traceId)) return;
  void fashionMemoryDb()
    .from("traces")
    .update({
      status: params.status ?? "complete",
      summary: params.summary ?? null,
      closed_at: new Date().toISOString(),
    })
    .eq("id", params.traceId)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) {
        logAiChat("warn", "fashion_trace_close_failed", {
          traceId: params.traceId,
          error: error.message,
        });
      }
    });
}

export function markFashionTraceError(traceId?: string | null): void {
  closeFashionTrace({ traceId, status: "error" });
}

export type CapturedPipelineEvent = {
  traceId: string | null;
  stage: string;
  payload: Record<string, unknown>;
};

let testPipelineCapture: CapturedPipelineEvent[] | null = null;

export function setTestPipelineEventCapture(
  cap: CapturedPipelineEvent[] | null,
): void {
  testPipelineCapture = cap;
}

export function getTestPipelineEventCapture(): CapturedPipelineEvent[] | null {
  return testPipelineCapture;
}
