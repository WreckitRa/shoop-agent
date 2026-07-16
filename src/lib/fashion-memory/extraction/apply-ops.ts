import {
  fashionFactValuesEqual,
  findActiveFashionFact,
  upsertFashionFact,
} from "../facts";
import { createPerson } from "../people";
import { logAiChat } from "@/lib/ai-chat/observability";
import {
  bumpStyleSignalConfidence,
  findActiveStyleSignal,
  normalizeSignalValue,
  supersedeStyleSignal,
  upsertStyleSignal,
} from "../signals";
import type { ExtractionOpResult, PersonRow } from "../types";
import { evidenceQuoteInMessages } from "./evidence";
import { measurementGarmentType } from "./measurement-garment";
import {
  collectDeclaredNewPersonRefs,
  personRefAllowed,
  resolvePersonRef,
} from "./person-ref";
import { findRosterDuplicateForNewPerson } from "./relation-aliases";
import type { AmbiguousSubject, FashionLlmOp } from "./tool-schema";

const SIGNAL_CONFIDENCE_CAP = 0.95;

function reject(op: string, reason: string): ExtractionOpResult {
  return { op, accepted: false, reason };
}

function accept(op: string, entityId?: string): ExtractionOpResult {
  return { op, accepted: true, entity_id: entityId };
}

async function applyNewPersonOps(params: {
  userId: string;
  ops: FashionLlmOp[];
  people: PersonRow[];
  newMessageTexts: string[];
  newPersonMap: Map<string, string>;
  results: ExtractionOpResult[];
}): Promise<void> {
  for (const op of params.ops) {
    if (op.op !== "new_person") continue;
    if (!op.person_ref.startsWith("new:")) {
      params.results.push(reject(op.op, "new_person_requires_new_ref"));
      continue;
    }
    if (params.newPersonMap.has(op.person_ref)) {
      params.results.push(reject(op.op, "duplicate_new_ref"));
      continue;
    }
    if (!evidenceQuoteInMessages(op.evidence_quote, params.newMessageTexts)) {
      params.results.push(reject(op.op, "evidence_not_in_new_messages"));
      continue;
    }

    const duplicate = findRosterDuplicateForNewPerson({
      people: params.people,
      relation: op.relation,
      name: op.name,
    });
    if (duplicate) {
      logAiChat("info", "fashion_extraction_new_person_alias_rejected", {
        relation: op.relation,
        name: op.name ?? null,
        existing_person_id: duplicate.id,
        existing_relation: duplicate.relation,
        existing_name: duplicate.name,
      });
      // Remap new:N → existing person so same-batch facts still attach.
      params.newPersonMap.set(op.person_ref, duplicate.id);
      params.results.push(reject(op.op, "duplicate_relation_alias"));
      continue;
    }

    try {
      const person = await createPerson({
        userId: params.userId,
        relation: op.relation,
        name: op.name ?? null,
      });
      params.newPersonMap.set(op.person_ref, person.id);
      params.results.push(accept(op.op, person.id));
    } catch (error) {
      params.results.push(
        reject(
          op.op,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
}

export async function applyFashionOps(params: {
  userId: string;
  ops: FashionLlmOp[];
  personShortIds: Record<string, string>;
  people: PersonRow[];
  newMessageTexts: string[];
}): Promise<ExtractionOpResult[]> {
  const results: ExtractionOpResult[] = [];
  const newPersonMap = new Map<string, string>();
  const declaredNewRefs = collectDeclaredNewPersonRefs(params.ops);

  await applyNewPersonOps({
    userId: params.userId,
    ops: params.ops,
    people: params.people,
    newMessageTexts: params.newMessageTexts,
    newPersonMap,
    results,
  });

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
          const garmentType = measurementGarmentType(
            op.fact_type,
            op.garment_type,
            op.value,
          );
          const fact = await upsertFashionFact({
            userId: params.userId,
            personId,
            factType: op.fact_type,
            garmentType,
            value: op.value as never,
            sourceQuote: op.evidence_quote,
          });
          results.push(accept(op.op, fact.id));
          break;
        }
        case "fact_reverse": {
          const garmentType = measurementGarmentType(
            op.fact_type,
            op.garment_type,
            op.value,
          );
          const active = await findActiveFashionFact({
            userId: params.userId,
            personId,
            factType: op.fact_type,
            garmentType,
          });
          if (!active || !fashionFactValuesEqual(active.value, op.old_value)) {
            results.push(reject(op.op, "old_value_mismatch"));
            break;
          }
          const fact = await upsertFashionFact({
            userId: params.userId,
            personId,
            factType: op.fact_type,
            garmentType,
            value: op.value as never,
            sourceQuote: op.evidence_quote,
          });
          results.push(accept(op.op, fact.id));
          break;
        }
        case "signal_add": {
          const signal = await upsertStyleSignal({
            userId: params.userId,
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
          const target = await findActiveStyleSignal({
            userId: params.userId,
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
          await supersedeStyleSignal({
            userId: params.userId,
            signalId: target.id,
          });
          const nextValue =
            op.value?.signal_value ?? op.signal_value;
          const nextPolarity =
            op.value?.polarity ??
            op.polarity ??
            (polarity === 1 ? -1 : 1);
          const nextContext = op.value?.context ?? op.context ?? ctx;
          const signal = await upsertStyleSignal({
            userId: params.userId,
            personId,
            context: nextContext,
            signalType: op.signal_type,
            value: normalizeSignalValue(nextValue),
            polarity: nextPolarity,
            source: op.source,
            status: "active",
            confidence: op.confidence,
            sourceQuote: op.evidence_quote,
          });
          results.push(accept(op.op, signal.id));
          break;
        }
        case "context_split": {
          const signal = await upsertStyleSignal({
            userId: params.userId,
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
            const signal = await findActiveStyleSignal({
              userId: params.userId,
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
            const bumped = await bumpStyleSignalConfidence({
              userId: params.userId,
              signalId: signal.id,
              incomingConfidence: op.confidence,
              cap: SIGNAL_CONFIDENCE_CAP,
            });
            results.push(accept(op.op, bumped.id));
            break;
          }
          if (op.fact_type) {
            const fact = await findActiveFashionFact({
              userId: params.userId,
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
        default: {
          results.push(reject(String((op as { op: string }).op), "unknown_op"));
        }
      }
    } catch (error) {
      results.push(
        reject(
          op.op,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  return results;
}

export type { AmbiguousSubject };
