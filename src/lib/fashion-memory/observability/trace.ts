import { logAiChat } from "@/lib/ai-chat/observability";
import { fashionMemoryDb } from "../db";
import type { TraceStatus } from "./constants";
import { maybeRedactExpiredTraceBodies } from "./cleanup";

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

export function recordPipelineEvent(params: {
  traceId?: string | null;
  stage: string;
  payload: Record<string, unknown>;
}): void {
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
