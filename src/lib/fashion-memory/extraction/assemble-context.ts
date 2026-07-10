export type { FashionExtractionContext } from "./context-format";
export {
  RELATION_SCAN_TERMS,
  buildExtractionContextFromData,
  buildPersonShortIdMap,
  formatMessageWindowBlock,
  formatPersonSnapshot,
  formatRosterBlock,
  formatRosterLine,
  isMessageAfterWatermark,
  personMentionedInText,
  personShortId,
  selectSnapshotPersonIds,
} from "./context-format";

import { fashionMemoryDb } from "../db";
import { listActiveFashionFacts } from "../facts";
import { listPeopleForUser } from "../people";
import { listActiveStyleSignals } from "../signals";
import type {
  ExtractionOpResult,
  FashionFactRow,
  StyleSignalRow,
} from "../types";
import {
  getDoneExtractionWatermark,
  getLatestDoneExtractionRun,
} from "../extraction-runs";
import { loadRecentFashionMessages } from "./message-window";
import {
  buildExtractionContextFromData,
  formatPersonSnapshot,
  selectSnapshotPersonIds,
  type FashionExtractionContext,
} from "./context-format";

const MESSAGE_WINDOW_LIMIT = 10;

export async function buildPersonSnapshotBlock(params: {
  userId: string;
  person: import("../types").PersonRow;
  shortIds: Record<string, string>;
}): Promise<string> {
  const [facts, signals] = await Promise.all([
    listActiveFashionFacts({ userId: params.userId, personId: params.person.id }),
    listActiveStyleSignals({ userId: params.userId, personId: params.person.id }),
  ]);
  return formatPersonSnapshot({
    person: params.person,
    facts,
    signals,
    shortIds: params.shortIds,
  });
}

async function resolveStickyPersonIds(params: {
  userId: string;
  opsApplied: ExtractionOpResult[] | null | undefined;
}): Promise<string[]> {
  const ops = params.opsApplied?.filter((o) => o.accepted && o.entity_id) ?? [];
  if (!ops.length) return [];

  const personIds = new Set<string>();
  const factIds: string[] = [];
  const signalIds: string[] = [];

  for (const op of ops) {
    if (!op.entity_id) continue;
    if (op.op === "create_person") {
      personIds.add(op.entity_id);
    } else if (op.op === "upsert_fact") {
      factIds.push(op.entity_id);
    } else if (op.op === "upsert_signal" || op.op === "corroborate_signal") {
      signalIds.push(op.entity_id);
    }
  }

  const db = fashionMemoryDb();

  if (factIds.length) {
    const facts = await db
      .from("fashion_facts")
      .select("person_id")
      .eq("user_id", params.userId)
      .in("id", factIds);
    if (facts.error) throw new Error(facts.error.message);
    for (const row of facts.data ?? []) {
      personIds.add((row as { person_id: string }).person_id);
    }
  }

  if (signalIds.length) {
    const signals = await db
      .from("style_signals")
      .select("person_id")
      .eq("user_id", params.userId)
      .in("id", signalIds);
    if (signals.error) throw new Error(signals.error.message);
    for (const row of signals.data ?? []) {
      personIds.add((row as { person_id: string }).person_id);
    }
  }

  return [...personIds];
}

export async function assembleExtractionContext(params: {
  conversationId: string;
  userId: string;
  /** Override for tests; defaults to UTC calendar date. */
  now?: Date;
}): Promise<FashionExtractionContext> {
  const [people, watermarkMessageId, latestDoneRun, recentMessages] =
    await Promise.all([
      listPeopleForUser(params.userId),
      getDoneExtractionWatermark({
        userId: params.userId,
        conversationId: params.conversationId,
      }),
      getLatestDoneExtractionRun({
        userId: params.userId,
        conversationId: params.conversationId,
      }),
      loadRecentFashionMessages({
        conversationId: params.conversationId,
        limit: MESSAGE_WINDOW_LIMIT,
      }),
    ]);

  const messageWindowText = recentMessages.map((m) => m.content).join("\n");
  const stickyPersonIds = await resolveStickyPersonIds({
    userId: params.userId,
    opsApplied: latestDoneRun?.ops_applied,
  });

  let watermarkCreatedAt: Date | null = null;
  if (watermarkMessageId) {
    const hit = recentMessages.find((m) => m.id === watermarkMessageId);
    if (hit) {
      watermarkCreatedAt = hit.createdAt;
    } else {
      const { prisma } = await import("@/lib/ai-chat/db");
      const row = await prisma.message.findUnique({
        where: { id: watermarkMessageId },
        select: { createdAt: true },
      });
      watermarkCreatedAt = row?.createdAt ?? null;
    }
  }

  const factsByPersonId = new Map<string, FashionFactRow[]>();
  const signalsByPersonId = new Map<string, StyleSignalRow[]>();
  const snapshotPersonIds = selectSnapshotPersonIds({
    people,
    messageWindowText,
    stickyPersonIds,
  });

  await Promise.all(
    snapshotPersonIds.map(async (personId) => {
      const [facts, signals] = await Promise.all([
        listActiveFashionFacts({ userId: params.userId, personId }),
        listActiveStyleSignals({ userId: params.userId, personId }),
      ]);
      factsByPersonId.set(personId, facts);
      signalsByPersonId.set(personId, signals);
    }),
  );

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
