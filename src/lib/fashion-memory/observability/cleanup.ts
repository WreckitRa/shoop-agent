import { logAiChat } from "@/lib/ai-chat/observability";
import { fashionMemoryDb } from "../db";
import { TRACE_RETENTION_DAYS } from "./constants";

let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Lazy redaction: null out large llm_call bodies older than retention window. */
export function maybeRedactExpiredTraceBodies(): void {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;

  const cutoff = new Date(
    now - TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  void fashionMemoryDb()
    .from("llm_calls")
    .update({
      input_messages: [],
      raw_output: { redacted: true },
    })
    .lt("created_at", cutoff)
    .not("input_messages", "eq", "[]")
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) {
        logAiChat("warn", "fashion_trace_cleanup_failed", {
          error: error.message,
        });
      }
    });
}
