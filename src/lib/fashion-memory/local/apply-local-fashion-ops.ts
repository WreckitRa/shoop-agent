import { fashionFactValuesEqual } from "../facts";
import type { FashionLocalStore } from "../local/store";
import { normalizeSignalValue } from "../signals";
import type { ExtractionOpResult, PersonRow } from "../types";
import { evidenceQuoteInMessages } from "../extraction/evidence";
import {
  collectDeclaredNewPersonRefs,
  personRefAllowed,
  resolvePersonRef,
} from "../extraction/person-ref";
import { findRosterDuplicateForNewPerson } from "../extraction/relation-aliases";
import type { FashionLlmOp } from "../extraction/tool-schema";

const SIGNAL_CONFIDENCE_CAP = 0.95;

function reject(op: string, reason: string): ExtractionOpResult {
  return { op, accepted: false, reason };
}

function accept(op: string, entityId?: string): ExtractionOpResult {
  return { op, accepted: true, entity_id: entityId };
}

export function applyLocalFashionOps(params: {
  store: FashionLocalStore;
  userId: string;
  ops: FashionLlmOp[];
  personShortIds: Record<string, string>;
  people: PersonRow[];
  newMessageTexts: string[];
}): ExtractionOpResult[] {
  const results: ExtractionOpResult[] = [];
  const newPersonMap = new Map<string, string>();
  const declaredNewRefs = collectDeclaredNewPersonRefs(params.ops);
  const { store, userId } = params;

  for (const op of params.ops) {
    if (op.op !== "new_person") continue;
    if (!op.person_ref.startsWith("new:")) {
      results.push(reject(op.op, "new_person_requires_new_ref"));
      continue;
    }
    if (!evidenceQuoteInMessages(op.evidence_quote, params.newMessageTexts)) {
      results.push(reject(op.op, "evidence_not_in_new_messages"));
      continue;
    }

    const duplicate = findRosterDuplicateForNewPerson({
      people: params.people,
      relation: op.relation,
      name: op.name,
    });
    if (duplicate) {
      newPersonMap.set(op.person_ref, duplicate.id);
      results.push(reject(op.op, "duplicate_relation_alias"));
      continue;
    }

    try {
      const person = store.createPerson({
        userId,
        relation: op.relation,
        name: op.name ?? null,
      });
      newPersonMap.set(op.person_ref, person.id);
      results.push(accept(op.op, person.id));
    } catch (error) {
      results.push(
        reject(op.op, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  for (const op of params.ops) {
    if (op.op === "new_person") continue;

    if (
      !personRefAllowed(
        op.person_ref,
        params.personShortIds,
        newPersonMap,
        declaredNewRefs,
        params.people,
      )
    ) {
      results.push(reject(op.op, "invalid_person_ref"));
      continue;
    }
    if (!evidenceQuoteInMessages(op.evidence_quote, params.newMessageTexts)) {
      results.push(reject(op.op, "evidence_not_in_new_messages"));
      continue;
    }

    const personId = resolvePersonRef({
      personRef: op.person_ref,
      personShortIds: params.personShortIds,
      newPersonMap,
      people: params.people,
    });
    if (!personId) {
      results.push(reject(op.op, "person_ref_unresolved"));
      continue;
    }

    try {
      switch (op.op) {
        case "fact_add": {
          const fact = store.upsertFashionFact({
            userId,
            personId,
            factType: op.fact_type,
            garmentType: op.garment_type,
            value: op.value as never,
            sourceQuote: op.evidence_quote,
          });
          results.push(accept(op.op, fact.id));
          break;
        }
        case "fact_reverse": {
          const active = store.findActiveFashionFact({
            userId,
            personId,
            factType: op.fact_type,
            garmentType: op.garment_type,
          });
          if (!active || !fashionFactValuesEqual(active.value, op.old_value)) {
            results.push(reject(op.op, "old_value_mismatch"));
            break;
          }
          const fact = store.upsertFashionFact({
            userId,
            personId,
            factType: op.fact_type,
            garmentType: op.garment_type,
            value: op.value as never,
            sourceQuote: op.evidence_quote,
          });
          results.push(accept(op.op, fact.id));
          break;
        }
        case "signal_add": {
          const signal = store.upsertStyleSignal({
            userId,
            personId,
            context: op.context,
            signalType: op.signal_type,
            value: normalizeSignalValue(op.signal_value),
            polarity: op.polarity ?? 1,
            source: op.source,
            status: op.source === "stated" ? "active" : "candidate",
            confidence: Math.min(op.confidence, SIGNAL_CONFIDENCE_CAP),
            sourceQuote: op.evidence_quote,
          });
          results.push(accept(op.op, signal.id));
          break;
        }
        case "signal_reverse": {
          const ctx = op.old_value.context ?? op.context ?? "general";
          const polarity = op.old_value.polarity ?? op.polarity ?? 1;
          const target = store.findActiveStyleSignal({
            userId,
            personId,
            context: ctx,
            signalType: op.signal_type,
            value: op.old_value.signal_value,
            polarity,
          });
          if (!target) {
            results.push(reject(op.op, "old_signal_not_found"));
            break;
          }
          if (target.source === "stated" && op.source === "inferred") {
            results.push(reject(op.op, "cannot_reverse_stated_with_inferred"));
            break;
          }
          store.supersedeStyleSignal({ userId, signalId: target.id });
          const signal = store.upsertStyleSignal({
            userId,
            personId,
            context: op.value?.context ?? op.context ?? ctx,
            signalType: op.signal_type,
            value: normalizeSignalValue(op.value?.signal_value ?? op.signal_value),
            polarity:
              op.value?.polarity ??
              op.polarity ??
              (polarity === 1 ? -1 : 1),
            source: op.source,
            status: "active",
            confidence: op.confidence,
            sourceQuote: op.evidence_quote,
          });
          results.push(accept(op.op, signal.id));
          break;
        }
        case "context_split": {
          const signal = store.upsertStyleSignal({
            userId,
            personId,
            context: op.new_context_label,
            signalType: op.signal_type,
            value: normalizeSignalValue(op.signal_value),
            polarity: op.polarity ?? 1,
            source: op.source,
            status: op.source === "stated" ? "active" : "candidate",
            confidence: op.confidence,
            sourceQuote: op.evidence_quote,
          });
          results.push(accept(op.op, signal.id));
          break;
        }
        case "noop_confirm": {
          if (op.signal_type && op.signal_value) {
            const signal = store.findActiveStyleSignal({
              userId,
              personId,
              context: op.context,
              signalType: op.signal_type,
              value: op.signal_value,
              polarity: op.polarity,
            });
            if (!signal) {
              results.push(reject(op.op, "noop_signal_not_found"));
              break;
            }
            const bumped = store.bumpStyleSignalConfidence({
              userId,
              signalId: signal.id,
              incomingConfidence: op.confidence,
              cap: SIGNAL_CONFIDENCE_CAP,
            });
            results.push(accept(op.op, bumped.id));
            break;
          }
          if (op.fact_type) {
            const fact = store.findActiveFashionFact({
              userId,
              personId,
              factType: op.fact_type,
              garmentType: op.garment_type,
            });
            if (!fact) {
              results.push(reject(op.op, "noop_fact_not_found"));
              break;
            }
            results.push(accept(op.op, fact.id));
            break;
          }
          results.push(reject(op.op, "noop_missing_target"));
          break;
        }
        default:
          results.push(reject(String((op as { op: string }).op), "unknown_op"));
      }
    } catch (error) {
      results.push(
        reject(op.op, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  return results;
}
