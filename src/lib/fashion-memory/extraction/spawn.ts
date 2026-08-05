import { logAiChat } from "@/lib/ai-chat/observability";
import { isGuestUserId } from "@/lib/auth/guest-session";
import { scheduleDetachedWork } from "../schedule-detached";
import { isSupabaseAuthUserId } from "../auth";
import { runFashionExtraction } from "./runner";

export type SpawnFashionExtractionParams = {
  userId: string;
  conversationId: string;
  triggerMessageId: string;
  traceId?: string | null;
};

/**
 * Fire-and-forget extraction after the response stream has closed.
 * Detached extraction job (fire-and-forget after the fashion turn).
 */
export function spawnDetachedFashionExtraction(
  params: SpawnFashionExtractionParams,
): void {
  if (isGuestUserId(params.userId)) {
    return;
  }
  if (!isSupabaseAuthUserId(params.userId)) {
    return;
  }

  // Yield so the SSE handler / stream teardown finishes before DB + LLM work.
  scheduleDetachedWork(() => {
    void runFashionExtraction({
      userId: params.userId,
      conversationId: params.conversationId,
      triggerMessageId: params.triggerMessageId,
      traceId: params.traceId,
    }).catch((error) => {
      logAiChat("error", "fashion_extraction_detached_failed", {
        userId: params.userId,
        conversationId: params.conversationId,
        triggerMessageId: params.triggerMessageId,
        error,
      });
    });
  });
}

export function spawnDetachedFashionExtractionSweep(params: {
  userId: string;
  conversationId: string;
}): void {
  if (!isSupabaseAuthUserId(params.userId)) return;

  scheduleDetachedWork(() => {
    void runFashionExtraction({
      userId: params.userId,
      conversationId: params.conversationId,
      sweep: true,
    }).catch((error) => {
      logAiChat("error", "fashion_extraction_sweep_failed", {
        userId: params.userId,
        conversationId: params.conversationId,
        error,
      });
    });
  });
}
