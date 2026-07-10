"use client";

import type { ChatMessage } from "@/lib/ai-chat/types";
import { guestUserIdFromSessionId } from "@/lib/auth/guest-session";
import {
  buildExtractionContextFromData,
  selectSnapshotPersonIds,
  type FashionExtractionContext,
} from "@/lib/fashion-memory/extraction/context-format";
import type { FashionTurnMessage } from "@/lib/fashion-memory/extraction/message-window";
import type {
  ExtractionOpResult,
  ExtractionRunRow,
  FashionFactRow,
  StyleSignalRow,
} from "@/lib/fashion-memory/types";
import { FashionLocalStore } from "@/lib/fashion-memory/local/store";
import { loadGuestFashionStore } from "./guest-bridge";

function latestDoneRun(
  store: FashionLocalStore,
  userId: string,
  conversationId: string,
): ExtractionRunRow | null {
  return (
    store.snapshot.extraction_runs
      .filter(
        (r) =>
          r.user_id === userId &&
          r.conversation_id === conversationId &&
          r.status === "done",
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

function doneWatermark(
  store: FashionLocalStore,
  userId: string,
  conversationId: string,
): string | null {
  return latestDoneRun(store, userId, conversationId)?.last_message_id ?? null;
}

function resolveGuestStickyPersonIds(
  store: FashionLocalStore,
  opsApplied: ExtractionOpResult[] | null | undefined,
): string[] {
  const personIds = new Set<string>();
  for (const op of opsApplied ?? []) {
    if (!op.accepted || !op.entity_id) continue;
    if (op.op === "create_person") {
      personIds.add(op.entity_id);
      continue;
    }
    if (op.op === "upsert_fact") {
      const fact = store.snapshot.fashion_facts.find((f) => f.id === op.entity_id);
      if (fact) personIds.add(fact.person_id);
      continue;
    }
    if (op.op === "upsert_signal" || op.op === "corroborate_signal") {
      const signal = store.snapshot.style_signals.find((s) => s.id === op.entity_id);
      if (signal) personIds.add(signal.person_id);
    }
  }
  return [...personIds];
}

function activeFactsForPerson(
  snapshot: FashionLocalStore["snapshot"],
  userId: string,
  personId: string,
): FashionFactRow[] {
  return snapshot.fashion_facts.filter(
    (f) =>
      f.user_id === userId &&
      f.person_id === personId &&
      f.status === "active",
  );
}

function activeSignalsForPerson(
  snapshot: FashionLocalStore["snapshot"],
  userId: string,
  personId: string,
): StyleSignalRow[] {
  return snapshot.style_signals.filter(
    (s) =>
      s.user_id === userId &&
      s.person_id === personId &&
      (s.status === "active" || s.status === "candidate"),
  );
}

function toTurnMessages(messages: ChatMessage[]): FashionTurnMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    metadata: m.metadata ?? null,
    createdAt: new Date(m.createdAt),
  }));
}

export function assembleGuestExtractionContext(params: {
  guestId: string;
  conversationId: string;
  messages: ChatMessage[];
  now?: Date;
}): FashionExtractionContext {
  const userId = guestUserIdFromSessionId(params.guestId);
  const store = loadGuestFashionStore(params.guestId);
  const people = store.snapshot.people.filter((p) => p.user_id === userId);

  const convMessages = params.messages.filter(
    (m) => m.conversationId === params.conversationId,
  );
  const recentMessages = toTurnMessages(convMessages.slice(-10));

  const watermarkMessageId = doneWatermark(
    store,
    userId,
    params.conversationId,
  );
  const watermarkHit = watermarkMessageId
    ? recentMessages.find((m) => m.id === watermarkMessageId)
    : null;
  const watermarkCreatedAt =
    watermarkHit?.createdAt ??
    (watermarkMessageId
      ? convMessages.find((m) => m.id === watermarkMessageId)?.createdAt
        ? new Date(
            convMessages.find((m) => m.id === watermarkMessageId)!.createdAt,
          )
        : null
      : null);

  const latestRun = latestDoneRun(store, userId, params.conversationId);
  const stickyPersonIds = resolveGuestStickyPersonIds(
    store,
    latestRun?.ops_applied,
  );

  const messageWindowText = recentMessages.map((m) => m.content).join("\n");
  const snapshotPersonIds = selectSnapshotPersonIds({
    people,
    messageWindowText,
    stickyPersonIds,
  });

  const factsByPersonId = new Map<string, FashionFactRow[]>();
  const signalsByPersonId = new Map<string, StyleSignalRow[]>();
  for (const personId of snapshotPersonIds) {
    factsByPersonId.set(
      personId,
      activeFactsForPerson(store.snapshot, userId, personId),
    );
    signalsByPersonId.set(
      personId,
      activeSignalsForPerson(store.snapshot, userId, personId),
    );
  }

  return buildExtractionContextFromData({
    people,
    factsByPersonId,
    signalsByPersonId,
    recentMessages,
    watermarkMessageId,
    watermarkCreatedAt,
    stickyPersonIds,
    now: params.now,
  });
}
