import { buildPersonShortIdMap } from "./extraction/context-format";
import { applyFashionOps } from "./extraction/apply-ops";
import { applyLocalFashionOps } from "./local/apply-local-fashion-ops";
import { FashionLocalStore } from "./local/store";
import type { GuestFashionMemorySnapshot } from "./local/store";
import {
  finishExtractionRun,
  getLatestDoneExtractionRun,
} from "./extraction-runs";
import { listPeopleForUser } from "./people";
import { isSupabaseAuthUserId } from "./auth";
import {
  parkedOpsFromSubjects,
  remapParkedOpsToPersonRef,
} from "./unresolved";
import type { AmbiguousSubject } from "./extraction/tool-schema";

function stripParkedOps(
  subjects: AmbiguousSubject[] | null,
): AmbiguousSubject[] | null {
  if (!subjects?.length) return subjects;
  return subjects.map(({ parked_ops: _ignored, ...rest }) => rest);
}

export async function applyParkedOpsForRecipient(params: {
  userId: string;
  conversationId: string;
  personId: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): Promise<void> {
  if (params.guestSnapshot) {
    const store = new FashionLocalStore(params.guestSnapshot);
    const run = store.getLatestExtractionRun({
      userId: params.userId,
      conversationId: params.conversationId,
    });
    if (!run || run.status !== "done") return;
    const parked = parkedOpsFromSubjects(run.ambiguous_subjects);
    if (!parked.length) return;
    const people = store.snapshot.people.filter(
      (p) => p.user_id === params.userId,
    );
    const shorts = buildPersonShortIdMap(people);
    const personRef =
      Object.entries(shorts).find(([, id]) => id === params.personId)?.[0] ??
      params.personId;
    const ops = remapParkedOpsToPersonRef(parked, personRef);
    await applyLocalFashionOps({
      store,
      userId: params.userId,
      ops,
      personShortIds: shorts,
      people,
      newMessageTexts: ops.map((o) => o.evidence_quote),
    });
    store.finishExtractionRun({
      runId: run.id,
      status: "done",
      opsApplied: run.ops_applied ?? [],
      ambiguousSubjects: stripParkedOps(run.ambiguous_subjects),
    });
    return;
  }

  if (!isSupabaseAuthUserId(params.userId)) return;
  const run = await getLatestDoneExtractionRun({
    userId: params.userId,
    conversationId: params.conversationId,
  });
  if (!run) return;
  const parked = parkedOpsFromSubjects(run.ambiguous_subjects ?? []);
  if (!parked.length) return;
  const people = await listPeopleForUser(params.userId);
  const shorts = buildPersonShortIdMap(people);
  const personRef =
    Object.entries(shorts).find(([, id]) => id === params.personId)?.[0] ??
    params.personId;
  const ops = remapParkedOpsToPersonRef(parked, personRef);
  await applyFashionOps({
    userId: params.userId,
    ops,
    personShortIds: shorts,
    people,
    newMessageTexts: ops.map((o) => o.evidence_quote),
  });
  await finishExtractionRun({
    userId: params.userId,
    runId: run.id,
    status: "done",
    opsApplied: run.ops_applied ?? [],
    ambiguousSubjects: stripParkedOps(run.ambiguous_subjects),
  });
}
