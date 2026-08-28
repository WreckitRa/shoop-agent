import { logAiChat } from "@/lib/ai-chat/observability";
import { normalizeSignalValue } from "../signals";
import type {
  ExtractionOpResult,
  FashionFactRow,
  FashionFactType,
  PersonRelation,
  PersonRow,
  StyleSignalRow,
  StyleSignalType,
} from "../types";
import { evidenceQuoteInMessages } from "./evidence";
import { factValuesEqualNormalized, normalizeFactWrite } from "./normalize-fact-write";
import { normalizeSignalContext } from "./signal-context";
import {
  collectDeclaredNewPersonRefs,
  personRefAllowed,
  resolvePersonRef,
} from "./person-ref";
import type { AmbiguousSubject, FashionLlmOp } from "./tool-schema";
import { resolveProposedPerson } from "../resolve-person";
import { ambiguousNameMatches } from "./person-identity";
import { buildPersonShortIdMap } from "./context-format";

const SIGNAL_CONFIDENCE_CAP = 0.95;

export type AppliedOpTrace = {
  emitted: FashionLlmOp;
  result: ExtractionOpResult;
};

export type FashionOpsStore = {
  createPerson: (params: {
    userId: string;
    relation: PersonRelation;
    name: string | null;
  }) => Promise<PersonRow>;
  upsertFashionFact: (params: {
    userId: string;
    personId: string;
    factType: FashionFactType;
    garmentType?: string | null;
    value: unknown;
    sourceQuote: string;
  }) => Promise<Pick<FashionFactRow, "id">>;
  findActiveFashionFact: (params: {
    userId: string;
    personId: string;
    factType: FashionFactType;
    garmentType?: string | null;
  }) => Promise<FashionFactRow | null>;
  upsertStyleSignal: (params: {
    userId: string;
    personId: string;
    context?: string;
    signalType: StyleSignalType;
    value: string;
    polarity: 1 | -1;
    source: "stated" | "inferred";
    status: "active" | "candidate";
    confidence: number;
    sourceQuote: string;
  }) => Promise<Pick<StyleSignalRow, "id">>;
  findActiveStyleSignal: (params: {
    userId: string;
    personId: string;
    context?: string;
    signalType: StyleSignalType;
    value: string;
    polarity?: -1 | 1;
  }) => Promise<StyleSignalRow | null>;
  supersedeStyleSignal: (params: {
    userId: string;
    signalId: string;
  }) => Promise<void>;
  bumpStyleSignalConfidence: (params: {
    userId: string;
    signalId: string;
    incomingConfidence: number;
    cap?: number;
  }) => Promise<Pick<StyleSignalRow, "id">>;
  updatePersonName: (params: {
    userId: string;
    personId: string;
    name: string;
  }) => Promise<PersonRow | null>;
};

function evidenceFromTap(quote: string, texts: string[]): boolean {
  return texts.some(
    (t) => /^\[tap\]\s/i.test(t) && evidenceQuoteInMessages(quote, [t]),
  );
}

function reject(op: string, reason: string): ExtractionOpResult {
  return { op, accepted: false, reason };
}

function accept(op: string, entityId?: string): ExtractionOpResult {
  return { op, accepted: true, entity_id: entityId };
}

function preparedFact(op: Extract<FashionLlmOp, { op: "fact_add" | "fact_reverse" }>):
  | { ok: true; garmentType: string | null; value: unknown }
  | { ok: false; reason: string } {
  const normalized = normalizeFactWrite({
    factType: op.fact_type,
    garmentType: op.garment_type,
    value: op.value,
  });
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    garmentType: normalized.write.garmentType,
    value: normalized.write.value,
  };
}

export async function applyFashionOpsWithStore(params: {
  store: FashionOpsStore;
  userId: string;
  ops: FashionLlmOp[];
  personShortIds: Record<string, string>;
  people: PersonRow[];
  newMessageTexts: string[];
}): Promise<{
  results: ExtractionOpResult[];
  traces: AppliedOpTrace[];
  parkedOps: FashionLlmOp[];
  unresolvedSubjects: AmbiguousSubject[];
}> {
  const resultsByIndex: ExtractionOpResult[] = new Array(params.ops.length);
  const newPersonMap = new Map<string, string>();
  const declaredNewRefs = collectDeclaredNewPersonRefs(params.ops);
  const { store, userId } = params;
  const parkedOps: FashionLlmOp[] = [];
  const parkedNewRefs = new Set<string>();
  const collisionPeople =
    ambiguousNameMatches({
      userText: params.newMessageTexts.join("\n"),
      people: params.people,
    }) ?? [];
  const parkedPersonIds = new Set(collisionPeople.map((p) => p.id));
  const shorts =
    Object.keys(params.personShortIds).length > 0
      ? params.personShortIds
      : buildPersonShortIdMap(params.people);
  const unresolvedSubjects: AmbiguousSubject[] = [];
  if (collisionPeople.length >= 2) {
    unresolvedSubjects.push({
      description: collisionPeople[0]!.name?.trim() || "name",
      candidate_person_refs: collisionPeople.map(
        (p) =>
          Object.entries(shorts).find(([, id]) => id === p.id)?.[0] ?? p.id,
      ),
      evidence_quote: params.newMessageTexts.join(" ").slice(0, 2000) || "ambiguous",
    });
  }

  const park = (index: number, op: FashionLlmOp) => {
    parkedOps.push(op);
    setResult(index, reject(op.op, "parked"));
  };

  const setResult = (index: number, result: ExtractionOpResult) => {
    resultsByIndex[index] = result;
  };

  for (const [index, op] of params.ops.entries()) {
    if (op.op !== "new_person") continue;
    if (!op.person_ref.startsWith("new:")) {
      setResult(index, reject(op.op, "new_person_requires_new_ref"));
      continue;
    }
    if (newPersonMap.has(op.person_ref)) {
      setResult(index, reject(op.op, "duplicate_new_ref"));
      continue;
    }
    if (!evidenceQuoteInMessages(op.evidence_quote, params.newMessageTexts)) {
      setResult(index, reject(op.op, "evidence_not_in_new_messages"));
      continue;
    }

    const match = op.match_existing;
    const matchRef = (match?.person_ref ?? match?.person_id ?? "").trim();
    const decision = resolveProposedPerson({
      people: params.people,
      personShortIds: params.personShortIds,
      mentionText: op.evidence_quote,
      relation: op.relation,
      name: op.name,
      matchExisting: match
        ? { personRef: matchRef, confidence: match.confidence, why: match.why }
        : null,
    });

    if (decision.action === "skip") {
      setResult(index, reject(op.op, "not_recipient"));
      continue;
    }

    if (decision.action === "ambiguous") {
      parkedNewRefs.add(op.person_ref);
      unresolvedSubjects.push({
        description: decision.mention,
        candidate_person_refs: decision.candidates.map(
          (p) =>
            Object.entries(params.personShortIds).find(
              ([, id]) => id === p.id,
            )?.[0] ?? p.id,
        ),
        evidence_quote: op.evidence_quote,
      });
      park(index, op);
      continue;
    }

    if (decision.action === "merge") {
      logAiChat("info", "fashion_extraction_new_person_merged", {
        relation: op.relation,
        name: op.name ?? null,
        existing_person_id: decision.person.id,
        existing_relation: decision.person.relation,
        existing_name: decision.person.name,
      });
      if (decision.attachName) {
        const updated = await store.updatePersonName({
          userId,
          personId: decision.person.id,
          name: decision.attachName,
        });
        if (updated) {
          const idx = params.people.findIndex((p) => p.id === updated.id);
          if (idx >= 0) params.people[idx] = updated;
        }
      }
      newPersonMap.set(op.person_ref, decision.person.id);
      setResult(index, accept(op.op, decision.person.id));
      continue;
    }

    try {
      const person = await store.createPerson({
        userId,
        relation: decision.relation as PersonRelation,
        name: decision.name,
      });
      params.people.push(person);
      newPersonMap.set(op.person_ref, person.id);
      setResult(index, accept(op.op, person.id));
    } catch (error) {
      setResult(
        index,
        reject(op.op, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  for (const [index, op] of params.ops.entries()) {
    if (op.op === "new_person") continue;

    if (parkedNewRefs.has(op.person_ref)) {
      park(index, op);
      continue;
    }

    if (
      !personRefAllowed(
        op.person_ref,
        params.personShortIds,
        newPersonMap,
        declaredNewRefs,
        params.people,
      )
    ) {
      setResult(index, reject(op.op, "invalid_person_ref"));
      continue;
    }

    if (!evidenceQuoteInMessages(op.evidence_quote, params.newMessageTexts)) {
      setResult(index, reject(op.op, "evidence_not_in_new_messages"));
      continue;
    }

    const personId = resolvePersonRef({
      personRef: op.person_ref,
      personShortIds: params.personShortIds,
      newPersonMap,
      people: params.people,
    });
    if (!personId) {
      setResult(index, reject(op.op, "person_ref_unresolved"));
      continue;
    }
    if (parkedPersonIds.has(personId)) {
      park(index, op);
      continue;
    }

    try {
      switch (op.op) {
        case "fact_add": {
          const fact = preparedFact(op);
          if (!fact.ok) {
            setResult(index, reject(op.op, fact.reason));
            break;
          }
          const active = await store.findActiveFashionFact({
            userId,
            personId,
            factType: op.fact_type,
            garmentType: fact.garmentType,
          });
          if (
            active &&
            factValuesEqualNormalized({
              factType: op.fact_type,
              garmentType: fact.garmentType,
              a: active.value,
              b: fact.value,
            })
          ) {
            setResult(index, accept(op.op, active.id));
            break;
          }
          const row = await store.upsertFashionFact({
            userId,
            personId,
            factType: op.fact_type,
            garmentType: fact.garmentType,
            value: fact.value,
            sourceQuote: op.evidence_quote,
          });
          setResult(index, accept(op.op, row.id));
          break;
        }
        case "fact_reverse": {
          const next = preparedFact(op);
          if (!next.ok) {
            setResult(index, reject(op.op, next.reason));
            break;
          }
          const active = await store.findActiveFashionFact({
            userId,
            personId,
            factType: op.fact_type,
            garmentType: next.garmentType,
          });
          const oldMatches =
            active != null &&
            factValuesEqualNormalized({
              factType: op.fact_type,
              garmentType: next.garmentType,
              a: active.value,
              b: op.old_value,
            });
          if (!active || !oldMatches) {
            setResult(index, reject(op.op, "old_value_mismatch"));
            break;
          }
          const row = await store.upsertFashionFact({
            userId,
            personId,
            factType: op.fact_type,
            garmentType: next.garmentType,
            value: next.value,
            sourceQuote: op.evidence_quote,
          });
          setResult(index, accept(op.op, row.id));
          break;
        }
        case "signal_add": {
          const fromTap = evidenceFromTap(
            op.evidence_quote,
            params.newMessageTexts,
          );
          const source = fromTap ? "inferred" : op.source;
          const context = normalizeSignalContext(op.context);
          const polarity = op.polarity ?? 1;
          const opposite = await store.findActiveStyleSignal({
            userId,
            personId,
            context,
            signalType: op.signal_type,
            value: normalizeSignalValue(op.signal_value),
            polarity: polarity === 1 ? -1 : 1,
          });
          if (opposite) {
            await store.supersedeStyleSignal({
              userId,
              signalId: opposite.id,
            });
          }
          const signal = await store.upsertStyleSignal({
            userId,
            personId,
            context,
            signalType: op.signal_type,
            value: normalizeSignalValue(op.signal_value),
            polarity,
            source,
            status: fromTap
              ? "candidate"
              : source === "stated"
                ? "active"
                : "candidate",
            confidence: Math.min(op.confidence, SIGNAL_CONFIDENCE_CAP),
            sourceQuote: op.evidence_quote,
          });
          setResult(index, accept(op.op, signal.id));
          break;
        }
        case "signal_reverse": {
          const ctx = normalizeSignalContext(
            op.old_value.context ?? op.context,
          );
          const polarity = op.old_value.polarity ?? op.polarity ?? 1;
          const target = await store.findActiveStyleSignal({
            userId,
            personId,
            context: ctx,
            signalType: op.signal_type,
            value: normalizeSignalValue(op.old_value.signal_value),
            polarity,
          });
          if (!target) {
            setResult(index, reject(op.op, "old_signal_not_found"));
            break;
          }
          if (target.source === "stated" && op.source === "inferred") {
            setResult(index, reject(op.op, "cannot_reverse_stated_with_inferred"));
            break;
          }
          await store.supersedeStyleSignal({ userId, signalId: target.id });
          const signal = await store.upsertStyleSignal({
            userId,
            personId,
            context: normalizeSignalContext(
              op.value?.context ?? op.context ?? ctx,
            ),
            signalType: op.signal_type,
            value: normalizeSignalValue(
              op.value?.signal_value ?? op.signal_value,
            ),
            polarity:
              op.value?.polarity ??
              op.polarity ??
              (polarity === 1 ? -1 : 1),
            source: op.source,
            status: "active",
            confidence: op.confidence,
            sourceQuote: op.evidence_quote,
          });
          setResult(index, accept(op.op, signal.id));
          break;
        }
        case "context_split": {
          const signal = await store.upsertStyleSignal({
            userId,
            personId,
            context: normalizeSignalContext(op.new_context_label),
            signalType: op.signal_type,
            value: normalizeSignalValue(op.signal_value),
            polarity: op.polarity ?? 1,
            source: op.source,
            status: op.source === "stated" ? "active" : "candidate",
            confidence: op.confidence,
            sourceQuote: op.evidence_quote,
          });
          setResult(index, accept(op.op, signal.id));
          break;
        }
        case "noop_confirm": {
          if (op.signal_type && op.signal_value) {
            const signal = await store.findActiveStyleSignal({
              userId,
              personId,
              context: normalizeSignalContext(op.context),
              signalType: op.signal_type,
              value: normalizeSignalValue(op.signal_value),
              polarity: op.polarity,
            });
            if (!signal) {
              setResult(index, reject(op.op, "noop_signal_not_found"));
              break;
            }
            const bumped = await store.bumpStyleSignalConfidence({
              userId,
              signalId: signal.id,
              incomingConfidence: op.confidence,
              cap: SIGNAL_CONFIDENCE_CAP,
            });
            setResult(index, accept(op.op, bumped.id));
            break;
          }
          if (op.fact_type) {
            const fact = await store.findActiveFashionFact({
              userId,
              personId,
              factType: op.fact_type,
              garmentType: op.garment_type,
            });
            if (!fact) {
              setResult(index, reject(op.op, "noop_fact_not_found"));
              break;
            }
            setResult(index, accept(op.op, fact.id));
            break;
          }
          setResult(index, reject(op.op, "noop_missing_target"));
          break;
        }
        default: {
          setResult(
            index,
            reject(String((op as { op: string }).op), "unknown_op"),
          );
        }
      }
    } catch (error) {
      setResult(
        index,
        reject(op.op, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  const traces: AppliedOpTrace[] = params.ops.map((emitted, i) => ({
    emitted,
    result: resultsByIndex[i] ?? reject(emitted.op, "unprocessed"),
  }));
  return {
    results: traces.map((t) => t.result),
    traces,
    parkedOps,
    unresolvedSubjects,
  };
}
