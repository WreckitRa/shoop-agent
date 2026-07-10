"use client";

import { guestUserIdFromSessionId } from "@/lib/auth/guest-session";
import { guestFetch } from "@/lib/client/guest-fetch";
import { assembleGuestExtractionContext } from "@/lib/fashion-memory/client/assemble-guest-context";
import {
  evaluateFashionExtractionGate,
  type FashionGateMessage,
} from "@/lib/fashion-memory/extraction/gate";
import { newMessageTextsFromContextBlock } from "@/lib/fashion-memory/extraction/evidence";
import type { RecordFashionOpsResult } from "@/lib/fashion-memory/extraction/tool-schema";
import { applyLocalFashionOps } from "@/lib/fashion-memory/local/apply-local-fashion-ops";
import {
  FashionLocalStore,
  runLocalRequestEventCorroboration,
} from "@/lib/fashion-memory/local/store";
import type { ChatMessage } from "@/lib/ai-chat/types";
import {
  loadGuestFashionStore,
  saveGuestFashionSnapshot,
} from "./guest-bridge";
import { scheduleIdleWork } from "@/lib/fashion-memory/schedule-detached";

function messagesForGate(messages: ChatMessage[]): FashionGateMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    metadata: m.metadata ?? null,
  }));
}

function watermarkMessageId(
  store: FashionLocalStore,
  userId: string,
  conversationId: string,
): string | null {
  const done = store.snapshot.extraction_runs
    .filter(
      (r) =>
        r.user_id === userId &&
        r.conversation_id === conversationId &&
        r.status === "done",
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return done?.last_message_id ?? null;
}

function hasRecentGuestRunningExtraction(
  store: FashionLocalStore,
  userId: string,
  conversationId: string,
  maxAgeMs = 60_000,
): boolean {
  const cutoff = Date.now() - maxAgeMs;
  return store.snapshot.extraction_runs.some((r) => {
    if (r.user_id !== userId) return false;
    if (r.conversation_id !== conversationId) return false;
    if (r.status !== "running") return false;
    return Date.parse(r.created_at) >= cutoff;
  });
}

function messagesSinceWatermark(
  messages: ChatMessage[],
  watermarkId: string | null,
): ChatMessage[] {
  if (!watermarkId) return messages;
  const idx = messages.findIndex((m) => m.id === watermarkId);
  if (idx === -1) return messages;
  return messages.slice(idx + 1);
}

/** Client-side detached extraction for guest sessions (mirrors server runner). */
export async function spawnGuestFashionExtraction(params: {
  guestId: string;
  conversationId: string;
  messages: ChatMessage[];
  sweep?: boolean;
}): Promise<void> {
  const userId = guestUserIdFromSessionId(params.guestId);
  const store = loadGuestFashionStore(params.guestId);
  store.ensureSelfPerson(userId);

  if (hasRecentGuestRunningExtraction(store, userId, params.conversationId)) {
    return;
  }

  const convMessages = params.messages.filter(
    (m) => m.conversationId === params.conversationId,
  );
  const watermark = watermarkMessageId(store, userId, params.conversationId);
  const window = messagesSinceWatermark(convMessages, watermark);
  const gateMessages = messagesForGate(window);
  const newUserMessages = gateMessages.filter((m) => m.role === "user");

  if (!params.sweep) {
    const gate = evaluateFashionExtractionGate({
      newUserMessages,
      orderedMessages: gateMessages,
    });
    if (!gate.proceed) return;
  } else if (!newUserMessages.length) {
    return;
  }

  const newestUser = newUserMessages[newUserMessages.length - 1]!;
  const run = store.beginExtractionRun({
    userId,
    conversationId: params.conversationId,
    lastMessageId: newestUser.id,
  });

  const opResults: import("@/lib/fashion-memory/types").ExtractionOpResult[] =
    [];

  try {
    const context = assembleGuestExtractionContext({
      guestId: params.guestId,
      conversationId: params.conversationId,
      messages: params.messages,
    });

    const res = await guestFetch("/api/fashion-memory/extract-ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    });
    if (!res.ok) throw new Error("extract_ops_failed");
    const extracted = (await res.json()) as RecordFashionOpsResult;

    const people = store.snapshot.people.filter((p) => p.user_id === userId);
    opResults.push(
      ...applyLocalFashionOps({
        store,
        userId,
        ops: extracted.ops,
        personShortIds: context.personShortIds,
        people,
        newMessageTexts: newMessageTextsFromContextBlock(context.messages),
      }),
    );

    const self = store.ensureSelfPerson(userId);
    opResults.push(
      ...runLocalRequestEventCorroboration(store, {
        userId,
        personId: self.id,
      }),
    );

    store.finishExtractionRun({
      runId: run.id,
      status: "done",
      opsApplied: opResults,
      ambiguousSubjects: extracted.ambiguous_subjects,
    });
  } catch {
    store.finishExtractionRun({
      runId: run.id,
      status: "failed",
      opsApplied: opResults,
    });
  }

  saveGuestFashionSnapshot(store.snapshot);
}

export function spawnGuestFashionExtractionSweep(params: {
  guestId: string;
  conversationId: string;
  messages: ChatMessage[];
}): void {
  scheduleGuestFashionExtraction({ ...params, sweep: true });
}

/** Detach guest extraction from SSE teardown / send hot path. */
export function scheduleGuestFashionExtraction(params: {
  guestId: string;
  conversationId: string;
  messages: ChatMessage[];
  sweep?: boolean;
}): void {
  scheduleIdleWork(() => {
    void spawnGuestFashionExtraction(params).catch(() => undefined);
  });
}
