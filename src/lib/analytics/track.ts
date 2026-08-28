import { prisma } from "@/lib/ai-chat/db";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import { logAiChat } from "@/lib/ai-chat/observability";
import type { ProductEventName } from "./names";
import { resolveAnalyticsSessionId } from "./session";

export type TrackProductEventInput = {
  name: ProductEventName;
  userId: string;
  /** When omitted, resolved from request headers (analytics or guest session). */
  sessionId?: string | null;
  props?: Record<string, unknown>;
};

/** Test capture — when set, skips Postgres and records in memory. */
let testCapture: TrackProductEventInput[] | null = null;

export function beginProductEventCapture(): TrackProductEventInput[] {
  testCapture = [];
  return testCapture;
}

export function endProductEventCapture(): void {
  testCapture = null;
}

/**
 * Persist a first-party product event. Fire-and-forget — never throws to callers.
 * Requires userId + sessionId (resolved from headers when not passed).
 */
export function trackProductEvent(input: TrackProductEventInput): void {
  void persistProductEvent(input);
}

async function persistProductEvent(input: TrackProductEventInput): Promise<void> {
  const sessionId =
    input.sessionId?.trim() || (await resolveAnalyticsSessionId()) || null;
  if (!input.userId.trim() || !sessionId) {
    logAiChat("warn", "product_event_skipped", {
      name: input.name,
      reason: !input.userId.trim() ? "missing_user" : "missing_session",
    });
    return;
  }

  const row: TrackProductEventInput = {
    name: input.name,
    userId: input.userId,
    sessionId,
    props: input.props,
  };

  if (testCapture) {
    testCapture.push(row);
    return;
  }

  try {
    await prisma.productEvent.create({
      data: {
        userId: row.userId,
        sessionId,
        name: row.name,
        props: (row.props ?? {}) as InputJsonValue,
      },
    });
  } catch (error) {
    logAiChat("warn", "product_event_write_failed", {
      name: row.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
