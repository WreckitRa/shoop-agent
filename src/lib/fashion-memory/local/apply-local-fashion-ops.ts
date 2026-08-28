import type { FashionLocalStore } from "./store";
import type { ExtractionOpResult, FashionFactType, FashionFactValue, PersonRow } from "../types";
import {
  applyFashionOpsWithStore,
  type AppliedOpTrace,
  type FashionOpsStore,
} from "../extraction/apply-rules";
import type { FashionLlmOp } from "../extraction/tool-schema";
import type { StyleSignalType } from "../types";

async function valueCanonicalFor(
  signalType: StyleSignalType,
  value: string,
): Promise<string | undefined> {
  if (typeof window !== "undefined") return undefined;
  const { canonicalizeSignalValue } = await import(
    "../normalize/signal-canonical"
  );
  return canonicalizeSignalValue(signalType, value);
}

function localStoreAdapter(store: FashionLocalStore): FashionOpsStore {
  return {
    createPerson: async (params) => store.createPerson(params),
    upsertFashionFact: async (params) =>
      store.upsertFashionFact({
        userId: params.userId,
        personId: params.personId,
        factType: params.factType,
        garmentType: params.garmentType,
        value: params.value as FashionFactValue<FashionFactType>,
        sourceQuote: params.sourceQuote,
      }),
    findActiveFashionFact: async (params) =>
      store.findActiveFashionFact(params),
    upsertStyleSignal: async (params) => {
      const valueCanonical = await valueCanonicalFor(
        params.signalType,
        params.value,
      );
      return store.upsertStyleSignal({ ...params, valueCanonical });
    },
    findActiveStyleSignal: async (params) => {
      const valueCanonical = await valueCanonicalFor(
        params.signalType,
        params.value,
      );
      return store.findActiveStyleSignal({ ...params, valueCanonical });
    },
    supersedeStyleSignal: async (params) => {
      store.supersedeStyleSignal(params);
    },
    bumpStyleSignalConfidence: async (params) =>
      store.bumpStyleSignalConfidence(params),
    updatePersonName: async (params) => store.updatePersonName(params),
  };
}

export async function applyLocalFashionOps(params: {
  store: FashionLocalStore;
  userId: string;
  ops: FashionLlmOp[];
  personShortIds: Record<string, string>;
  people: PersonRow[];
  newMessageTexts: string[];
}): Promise<ExtractionOpResult[]> {
  const { results } = await applyFashionOpsWithStore({
    store: localStoreAdapter(params.store),
    userId: params.userId,
    ops: params.ops,
    personShortIds: params.personShortIds,
    people: params.people,
    newMessageTexts: params.newMessageTexts,
  });
  return results;
}

export async function applyLocalFashionOpsTraced(params: {
  store: FashionLocalStore;
  userId: string;
  ops: FashionLlmOp[];
  personShortIds: Record<string, string>;
  people: PersonRow[];
  newMessageTexts: string[];
}): Promise<{
  results: ExtractionOpResult[];
  traces: AppliedOpTrace[];
  parkedOps: import("../extraction/tool-schema").FashionLlmOp[];
  unresolvedSubjects: import("../extraction/tool-schema").AmbiguousSubject[];
}> {
  return applyFashionOpsWithStore({
    store: localStoreAdapter(params.store),
    userId: params.userId,
    ops: params.ops,
    personShortIds: params.personShortIds,
    people: params.people,
    newMessageTexts: params.newMessageTexts,
  });
}
