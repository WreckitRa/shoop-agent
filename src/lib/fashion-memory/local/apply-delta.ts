import type { FashionLlmOp } from "../extraction/tool-schema";
import { applyLocalFashionOps } from "./apply-local-fashion-ops";
import {
  FashionLocalStore,
  runLocalRequestEventCorroboration,
} from "./store";
import type { ExtractionOpResult, RequestEventAttributes } from "../types";

export type FashionMemoryDelta = {
  version: 1;
  conversationId: string;
  triggerMessageId: string;
  requestEvent?: {
    personId?: string;
    attributes: RequestEventAttributes;
  };
  extractionOps?: FashionLlmOp[];
};

export async function applyFashionMemoryDelta(params: {
  store: FashionLocalStore;
  userId: string;
  delta: FashionMemoryDelta;
}): Promise<ExtractionOpResult[]> {
  const { store, userId, delta } = params;
  const results: ExtractionOpResult[] = [];

  params.store.ensureSelfPerson(userId);

  if (delta.requestEvent) {
    const personId =
      delta.requestEvent.personId ??
      store.ensureSelfPerson(userId).id;
    const event = store.logRequestEvent({
      userId,
      personId,
      conversationId: delta.conversationId,
      attributes: delta.requestEvent.attributes,
    });
    results.push({
      op: "log_request_event",
      accepted: true,
      entity_id: event.id,
    });
  }

  if (delta.extractionOps?.length) {
    results.push(
      ...(await applyLocalFashionOps({
        store,
        userId,
        ops: delta.extractionOps,
        personShortIds: {},
        people: store.snapshot.people.filter((p) => p.user_id === userId),
        newMessageTexts: [],
      })),
    );
  }

  const self = store.ensureSelfPerson(userId);
  results.push(
    ...runLocalRequestEventCorroboration(store, {
      userId,
      personId: self.id,
    }),
  );

  const run = store.beginExtractionRun({
    userId,
    conversationId: delta.conversationId,
    lastMessageId: delta.triggerMessageId,
  });
  store.finishExtractionRun({
    runId: run.id,
    status: "done",
    opsApplied: results,
  });

  return results;
}
