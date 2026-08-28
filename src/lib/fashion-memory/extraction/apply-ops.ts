import {
  findActiveFashionFact,
  upsertFashionFact,
} from "../facts";
import { createPerson, updatePersonName } from "../people";
import {
  bumpStyleSignalConfidence,
  findActiveStyleSignal,
  supersedeStyleSignal,
  upsertStyleSignal,
} from "../signals";
import type { FashionFactType, FashionFactValue } from "../types";
import {
  applyFashionOpsWithStore,
  type AppliedOpTrace,
  type FashionOpsStore,
} from "./apply-rules";
import type { AmbiguousSubject, FashionLlmOp } from "./tool-schema";

const authStore: FashionOpsStore = {
  createPerson: (params) => createPerson(params),
  upsertFashionFact: (params) =>
    upsertFashionFact({
      userId: params.userId,
      personId: params.personId,
      factType: params.factType,
      garmentType: params.garmentType,
      value: params.value as FashionFactValue<FashionFactType>,
      sourceQuote: params.sourceQuote,
    }),
  findActiveFashionFact: (params) =>
    findActiveFashionFact({
      userId: params.userId,
      personId: params.personId,
      factType: params.factType,
      garmentType: params.garmentType,
    }),
  upsertStyleSignal: (params) => upsertStyleSignal(params),
  findActiveStyleSignal: (params) => findActiveStyleSignal(params),
  supersedeStyleSignal: (params) => supersedeStyleSignal(params),
  bumpStyleSignalConfidence: (params) => bumpStyleSignalConfidence(params),
  updatePersonName: (params) => updatePersonName(params),
};

export async function applyFashionOps(params: {
  userId: string;
  ops: FashionLlmOp[];
  personShortIds: Record<string, string>;
  people: import("../types").PersonRow[];
  newMessageTexts: string[];
}): Promise<import("../types").ExtractionOpResult[]> {
  const { results } = await applyFashionOpsWithStore({
    store: authStore,
    ...params,
  });
  return results;
}

export async function applyFashionOpsTraced(params: {
  userId: string;
  ops: FashionLlmOp[];
  personShortIds: Record<string, string>;
  people: import("../types").PersonRow[];
  newMessageTexts: string[];
}): Promise<{
  results: import("../types").ExtractionOpResult[];
  traces: AppliedOpTrace[];
  parkedOps: FashionLlmOp[];
  unresolvedSubjects: AmbiguousSubject[];
}> {
  return applyFashionOpsWithStore({
    store: authStore,
    ...params,
  });
}

export type { AmbiguousSubject, AppliedOpTrace };
