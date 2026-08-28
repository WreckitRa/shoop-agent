import { listActiveFashionFacts } from "../facts";
import { applyFashionOpsTraced } from "../extraction/apply-ops";
import {
  attachParkedOps,
  mergeAmbiguousSubjects,
} from "../unresolved";
import {
  buildExtractionContextFromData,
  type FashionExtractionContext,
} from "../extraction/context-format";
import { runRequestEventCorroboration } from "../extraction/corroboration";
import { newMessageTextsFromContextBlock } from "../extraction/evidence";
import {
  evaluateFashionExtractionGate,
  type FashionGateMessage,
} from "../extraction/gate";
import { extractFashionMemoryFromTurn } from "../extraction/llm-extract";
import {
  beginExtractionRun,
  finishExtractionRun,
  getDoneExtractionWatermark,
} from "../extraction-runs";
import { applyLocalFashionOpsTraced } from "../local/apply-local-fashion-ops";
import { runLocalRequestEventCorroboration } from "../local/store";
import { ensureSelfPerson, listPeopleForUser } from "../people";
import { listActiveStyleSignals } from "../signals";
import type { FashionLlmOp } from "../extraction/tool-schema";
import type { AppliedOpTrace } from "../extraction/apply-rules";
import type { ExtractionOpResult, FashionFactRow, StyleSignalRow } from "../types";
import type { FashionTurnMessage } from "../extraction/message-window";
import type { Session } from "./dump";

export type ClerkResult = {
  skipped: boolean;
  skipReason?: string;
  ops: ExtractionOpResult[];
  traces: AppliedOpTrace[];
  emitted: FashionLlmOp[];
  ambiguous: number;
  watermarkBefore: string | null;
  watermarkAfter: string | null;
};

async function people(session: Session) {
  if (session.kind === "local") {
    return session.local!.snapshot.people.filter(
      (p) => p.user_id === session.userId,
    );
  }
  return listPeopleForUser(session.userId);
}

async function watermark(
  session: Session,
  conversationId: string,
): Promise<string | null> {
  if (session.kind === "local") {
    const run = session.local!.getLatestExtractionRun({
      userId: session.userId,
      conversationId,
    });
    return run?.status === "done" ? run.last_message_id : null;
  }
  return getDoneExtractionWatermark({
    userId: session.userId,
    conversationId,
  });
}

function messagesSince(
  messages: FashionTurnMessage[],
  afterId: string | null,
): FashionTurnMessage[] {
  if (!afterId) return messages;
  const idx = messages.findIndex((m) => m.id === afterId);
  if (idx < 0) return messages;
  return messages.slice(idx + 1);
}

function toGate(messages: FashionTurnMessage[]): FashionGateMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    metadata: m.metadata ?? null,
  }));
}

async function assembleLocal(
  session: Session,
  conversationId: string,
  messages: FashionTurnMessage[],
): Promise<FashionExtractionContext> {
  const store = session.local!;
  const userId = session.userId;
  const roster = store.snapshot.people.filter((p) => p.user_id === userId);
  const wm = await watermark(session, conversationId);
  const wmHit = wm ? messages.find((m) => m.id === wm) : null;
  const recent = messages.slice(-10);
  const factsByPersonId = new Map<string, FashionFactRow[]>();
  const signalsByPersonId = new Map<string, StyleSignalRow[]>();
  for (const p of roster) {
    factsByPersonId.set(
      p.id,
      store.snapshot.fashion_facts.filter(
        (f) =>
          f.user_id === userId &&
          f.person_id === p.id &&
          f.status === "active",
      ),
    );
    signalsByPersonId.set(
      p.id,
      store.snapshot.style_signals.filter(
        (s) =>
          s.user_id === userId &&
          s.person_id === p.id &&
          (s.status === "active" || s.status === "candidate"),
      ),
    );
  }
  return buildExtractionContextFromData({
    people: roster,
    factsByPersonId,
    signalsByPersonId,
    recentMessages: recent,
    watermarkMessageId: wm,
    watermarkCreatedAt: wmHit?.createdAt ?? null,
    stickyPersonIds: [],
  });
}

async function assembleAuth(
  session: Session,
  conversationId: string,
  messages: FashionTurnMessage[],
): Promise<FashionExtractionContext> {
  const roster = await listPeopleForUser(session.userId);
  const wm = await watermark(session, conversationId);
  const wmHit = wm ? messages.find((m) => m.id === wm) : null;
  const recent = messages.slice(-10);
  const factsByPersonId = new Map<string, FashionFactRow[]>();
  const signalsByPersonId = new Map<string, StyleSignalRow[]>();
  await Promise.all(
    roster.map(async (p) => {
      const [facts, signals] = await Promise.all([
        listActiveFashionFacts({ userId: session.userId, personId: p.id }),
        listActiveStyleSignals({ userId: session.userId, personId: p.id }),
      ]);
      factsByPersonId.set(p.id, facts);
      signalsByPersonId.set(p.id, signals);
    }),
  );
  return buildExtractionContextFromData({
    people: roster,
    factsByPersonId,
    signalsByPersonId,
    recentMessages: recent,
    watermarkMessageId: wm,
    watermarkCreatedAt: wmHit?.createdAt ?? null,
    stickyPersonIds: [],
  });
}

export async function runClerk(params: {
  session: Session;
  conversationId: string;
  messages: FashionTurnMessage[];
  sweep?: boolean;
  traceId?: string | null;
}): Promise<ClerkResult> {
  const { session, conversationId, messages } = params;
  const wmBefore = await watermark(session, conversationId);
  const window = messagesSince(messages, wmBefore);
  const gateMessages = toGate(window);
  const newUserMessages = gateMessages.filter((m) => m.role === "user");

  if (!params.sweep) {
    const gate = evaluateFashionExtractionGate({
      newUserMessages,
      orderedMessages: toGate(messages),
    });
    if (!gate.proceed) {
      return {
        skipped: true,
        skipReason: gate.reason,
        ops: [],
        traces: [],
        emitted: [],
        ambiguous: 0,
        watermarkBefore: wmBefore,
        watermarkAfter: wmBefore,
      };
    }
  } else if (!newUserMessages.length) {
    return {
      skipped: true,
      skipReason: "no_new_user_messages",
      ops: [],
      traces: [],
      emitted: [],
      ambiguous: 0,
      watermarkBefore: wmBefore,
      watermarkAfter: wmBefore,
    };
  }

  const newestUser = newUserMessages[newUserMessages.length - 1]!;
  const run =
    session.kind === "local"
      ? session.local!.beginExtractionRun({
          userId: session.userId,
          conversationId,
          lastMessageId: newestUser.id,
        })
      : await beginExtractionRun({
          userId: session.userId,
          conversationId,
          lastMessageId: newestUser.id,
        });

  const allOps: ExtractionOpResult[] = [];
  try {
    const context =
      session.kind === "local"
        ? await assembleLocal(session, conversationId, messages)
        : await assembleAuth(session, conversationId, messages);

    const extracted = await extractFashionMemoryFromTurn({
      context,
      traceId: params.traceId,
    });
    const roster = await people(session);
    const newMessageTexts = newMessageTextsFromContextBlock(context.messages);
    let traces: AppliedOpTrace[] = [];
    let subjects = extracted.ambiguous_subjects;

    if (session.kind === "local") {
      const applied = await applyLocalFashionOpsTraced({
        store: session.local!,
        userId: session.userId,
        ops: extracted.ops,
        personShortIds: context.personShortIds,
        people: roster,
        newMessageTexts,
      });
      traces = applied.traces;
      allOps.push(...applied.results);
      const self = session.local!.ensureSelfPerson(session.userId);
      allOps.push(
        ...runLocalRequestEventCorroboration(session.local!, {
          userId: session.userId,
          personId: self.id,
        }),
      );
      subjects = attachParkedOps(
        mergeAmbiguousSubjects(
          extracted.ambiguous_subjects,
          applied.unresolvedSubjects,
        ),
        applied.parkedOps,
      );
      session.local!.finishExtractionRun({
        runId: run.id,
        status: "done",
        opsApplied: allOps,
        ambiguousSubjects: subjects,
      });
    } else {
      const applied = await applyFashionOpsTraced({
        userId: session.userId,
        ops: extracted.ops,
        personShortIds: context.personShortIds,
        people: roster,
        newMessageTexts,
      });
      traces = applied.traces;
      allOps.push(...applied.results);
      const self = await ensureSelfPerson(session.userId);
      allOps.push(
        ...(await runRequestEventCorroboration({
          userId: session.userId,
          personId: self.id,
        })),
      );
      subjects = attachParkedOps(
        mergeAmbiguousSubjects(
          extracted.ambiguous_subjects,
          applied.unresolvedSubjects,
        ),
        applied.parkedOps,
      );
      await finishExtractionRun({
        userId: session.userId,
        runId: run.id,
        status: "done",
        opsApplied: allOps,
        ambiguousSubjects: subjects,
      });
    }

    return {
      skipped: false,
      ops: allOps,
      traces,
      emitted: extracted.ops,
      ambiguous: subjects.length,
      watermarkBefore: wmBefore,
      watermarkAfter: newestUser.id,
    };
  } catch (error) {
    if (session.kind === "local") {
      session.local!.finishExtractionRun({
        runId: run.id,
        status: "failed",
        opsApplied: allOps,
      });
    } else {
      await finishExtractionRun({
        userId: session.userId,
        runId: run.id,
        status: "failed",
        opsApplied: allOps,
      }).catch(() => undefined);
    }
    throw error;
  }
}
