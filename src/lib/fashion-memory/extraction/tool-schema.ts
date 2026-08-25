import { z } from "zod";
import {
  fashionFactBudgetBandValueSchema,
  fashionFactFitValueSchema,
  fashionFactGenderPresentationValueSchema,
  fashionFactMeasurementValueSchema,
  fashionFactNoGoValueSchema,
  fashionFactSizeValueSchema,
} from "./fact-value-schemas";

export const RECORD_FASHION_OPS_TOOL_NAME = "record_fashion_ops";

const factValueSchema = z.union([
  fashionFactSizeValueSchema,
  fashionFactFitValueSchema,
  fashionFactNoGoValueSchema,
  fashionFactBudgetBandValueSchema,
  fashionFactGenderPresentationValueSchema,
  fashionFactMeasurementValueSchema,
  z.record(z.string(), z.unknown()),
]);

const signalTypeSchema = z.enum([
  "color",
  "style",
  "brand",
  "silhouette",
  "aesthetic",
  "material",
  "pattern",
  "shopping_style",
]);

const factTypeSchema = z.enum([
  "size",
  "fit",
  "no_go",
  "budget_band",
  "body_note",
  "gender_presentation",
  "measurement",
  "depth_default",
]);

const opBaseSchema = z.object({
  person_ref: z.string().min(1).max(80),
  source: z.enum(["stated", "inferred"]),
  confidence: z.number().min(0).max(1),
  evidence_quote: z.string().min(1).max(2000),
});

export const fashionLlmOpSchema = z.discriminatedUnion("op", [
  opBaseSchema.extend({
    op: z.literal("new_person"),
    relation: z.string().min(1).max(80),
    name: z.string().max(120).nullable().optional(),
  }),
  opBaseSchema.extend({
    op: z.literal("fact_add"),
    fact_type: factTypeSchema,
    garment_type: z.string().max(80).nullable().optional(),
    value: factValueSchema,
  }),
  opBaseSchema.extend({
    op: z.literal("fact_reverse"),
    fact_type: factTypeSchema,
    garment_type: z.string().max(80).nullable().optional(),
    value: factValueSchema,
    old_value: factValueSchema,
  }),
  opBaseSchema.extend({
    op: z.literal("signal_add"),
    signal_type: signalTypeSchema,
    signal_value: z.string().min(1).max(120),
    polarity: z.union([z.literal(1), z.literal(-1)]).optional(),
    context: z.string().max(120).optional(),
  }),
  opBaseSchema.extend({
    op: z.literal("signal_reverse"),
    signal_type: signalTypeSchema,
    signal_value: z.string().min(1).max(120),
    polarity: z.union([z.literal(1), z.literal(-1)]).optional(),
    context: z.string().max(120).optional(),
    old_value: z.object({
      signal_value: z.string().min(1).max(120),
      polarity: z.union([z.literal(1), z.literal(-1)]).optional(),
      context: z.string().max(120).optional(),
    }),
    value: z
      .object({
        signal_value: z.string().min(1).max(120).optional(),
        polarity: z.union([z.literal(1), z.literal(-1)]).optional(),
        context: z.string().max(120).optional(),
      })
      .optional(),
  }),
  opBaseSchema.extend({
    op: z.literal("context_split"),
    signal_type: signalTypeSchema,
    signal_value: z.string().min(1).max(120),
    polarity: z.union([z.literal(1), z.literal(-1)]).optional(),
    context: z.string().max(120).optional(),
    new_context_label: z.string().min(1).max(120),
  }),
  opBaseSchema.extend({
    op: z.literal("noop_confirm"),
    fact_type: factTypeSchema.optional(),
    garment_type: z.string().max(80).nullable().optional(),
    signal_type: signalTypeSchema.optional(),
    signal_value: z.string().max(120).optional(),
    polarity: z.union([z.literal(1), z.literal(-1)]).optional(),
    context: z.string().max(120).optional(),
  }),
]);

export const ambiguousSubjectSchema = z.object({
  description: z.string().min(1).max(500),
  candidate_person_refs: z.array(z.string().min(1).max(80)).min(1).max(8),
  evidence_quote: z.string().min(1).max(2000),
});

export const recordFashionOpsResultSchema = z.object({
  ops: z.array(fashionLlmOpSchema).max(32).default([]),
  ambiguous_subjects: z.array(ambiguousSubjectSchema).max(8).default([]),
});

export type FashionLlmOp = z.infer<typeof fashionLlmOpSchema>;
export type AmbiguousSubject = z.infer<typeof ambiguousSubjectSchema>;
export type RecordFashionOpsResult = z.infer<typeof recordFashionOpsResultSchema>;

function coerceStringField(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function coerceConfidence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return 0.6;
}

function coerceSource(value: unknown): "stated" | "inferred" {
  return value === "stated" ? "stated" : "inferred";
}

function coerceOpRecord(raw: unknown): Record<string, unknown> | null {
  if (raw == null || typeof raw !== "object") return null;
  const record = { ...(raw as Record<string, unknown>) };

  const op = coerceStringField(record.op);
  const personRef = coerceStringField(record.person_ref);
  const evidenceQuote = coerceStringField(record.evidence_quote);
  if (!op || !personRef || !evidenceQuote) return null;

  record.op = op;
  record.person_ref = personRef;
  record.evidence_quote = evidenceQuote;
  record.source = coerceSource(record.source);
  record.confidence = coerceConfidence(record.confidence);

  for (const key of [
    "signal_value",
    "context",
    "new_context_label",
    "relation",
    "garment_type",
    "name",
  ] as const) {
    if (!(key in record)) continue;
    if (record[key] === null) continue;
    const coerced = coerceStringField(record[key]);
    if (coerced !== undefined) record[key] = coerced;
    else if (typeof record[key] !== "string") delete record[key];
  }

  if (["signal_add", "signal_reverse", "context_split"].includes(op)) {
    const signalValue = coerceStringField(record.signal_value);
    if (!signalValue) return null;
    record.signal_value = signalValue;
  }

  if (op === "new_person") {
    const relation = coerceStringField(record.relation);
    if (!relation) return null;
    record.relation = relation;
  }

  if (op === "context_split") {
    const label = coerceStringField(record.new_context_label);
    if (!label) return null;
    record.new_context_label = label;
  }

  return record;
}

function coerceAmbiguousSubject(raw: unknown): Record<string, unknown> | null {
  if (raw == null || typeof raw !== "object") return null;
  const record = { ...(raw as Record<string, unknown>) };
  const description = coerceStringField(record.description);
  const evidenceQuote = coerceStringField(record.evidence_quote);
  const refs = Array.isArray(record.candidate_person_refs)
    ? record.candidate_person_refs
        .map((ref) => coerceStringField(ref))
        .filter((ref): ref is string => Boolean(ref))
    : [];
  if (!description || !evidenceQuote || refs.length === 0) return null;
  return {
    description,
    evidence_quote: evidenceQuote,
    candidate_person_refs: refs,
  };
}

/** Normalize Haiku tool payloads before strict schema validation. */
export function coerceRecordFashionOpsInput(raw: unknown): RecordFashionOpsResult {
  if (raw == null || typeof raw !== "object") {
    return { ops: [], ambiguous_subjects: [] };
  }

  const root = raw as Record<string, unknown>;
  const opsIn = Array.isArray(root.ops) ? root.ops : [];
  const ambiguousIn = Array.isArray(root.ambiguous_subjects)
    ? root.ambiguous_subjects
    : [];

  const ops = opsIn
    .map((item) => coerceOpRecord(item))
    .filter((item): item is Record<string, unknown> => item != null);
  const ambiguous_subjects = ambiguousIn
    .map((item) => coerceAmbiguousSubject(item))
    .filter((item): item is Record<string, unknown> => item != null);

  return { ops, ambiguous_subjects } as RecordFashionOpsResult;
}

export function parseRecordFashionOpsResult(raw: unknown): {
  result: RecordFashionOpsResult;
  recoveredPartially: boolean;
  droppedOps: number;
  droppedAmbiguous: number;
  issues: string[];
} {
  const opsIn = Array.isArray((raw as Record<string, unknown> | null)?.ops)
    ? ((raw as Record<string, unknown>).ops as unknown[]).length
    : 0;
  const ambiguousIn = Array.isArray(
    (raw as Record<string, unknown> | null)?.ambiguous_subjects,
  )
    ? ((raw as Record<string, unknown>).ambiguous_subjects as unknown[]).length
    : 0;

  const coerced = coerceRecordFashionOpsInput(raw);
  const strict = recordFashionOpsResultSchema.safeParse(coerced);
  if (strict.success) {
    return {
      result: strict.data,
      recoveredPartially:
        opsIn > strict.data.ops.length ||
        ambiguousIn > strict.data.ambiguous_subjects.length,
      droppedOps: Math.max(0, opsIn - strict.data.ops.length),
      droppedAmbiguous: Math.max(
        0,
        ambiguousIn - strict.data.ambiguous_subjects.length,
      ),
      issues: [],
    };
  }

  const validOps: FashionLlmOp[] = [];
  for (const op of coerced.ops) {
    const parsed = fashionLlmOpSchema.safeParse(op);
    if (parsed.success) validOps.push(parsed.data);
  }

  const validAmbiguous: AmbiguousSubject[] = [];
  for (const subject of coerced.ambiguous_subjects) {
    const parsed = ambiguousSubjectSchema.safeParse(subject);
    if (parsed.success) validAmbiguous.push(parsed.data);
  }

  const droppedOps = Math.max(0, opsIn - validOps.length);
  const droppedAmbiguous = Math.max(0, ambiguousIn - validAmbiguous.length);
  const issues =
    droppedOps > 0 || droppedAmbiguous > 0
      ? strict.error.issues.map((issue) => issue.message)
      : strict.error.issues.map((issue) => issue.message);

  return {
    result: { ops: validOps, ambiguous_subjects: validAmbiguous },
    recoveredPartially: droppedOps > 0 || droppedAmbiguous > 0,
    droppedOps,
    droppedAmbiguous,
    issues,
  };
}

export const RECORD_FASHION_OPS_TOOL = {
  name: RECORD_FASHION_OPS_TOOL_NAME,
  description:
    "Record fashion memory operations extracted from [NEW] conversation messages.",
  input_schema: {
    type: "object" as const,
    properties: {
      ops: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: {
              type: "string",
              enum: [
                "fact_add",
                "fact_reverse",
                "signal_add",
                "signal_reverse",
                "context_split",
                "new_person",
                "noop_confirm",
              ],
            },
            person_ref: { type: "string" },
            fact_type: {
              type: "string",
              enum: [
                "size",
                "fit",
                "no_go",
                "budget_band",
                "body_note",
                "gender_presentation",
                "measurement",
                "depth_default",
              ],
            },
            garment_type: { type: ["string", "null"] },
            value: { type: "object" },
            old_value: { type: "object" },
            signal_type: {
              type: "string",
              enum: [
                "color",
                "style",
                "brand",
                "silhouette",
                "aesthetic",
                "material",
                "pattern",
                "shopping_style",
              ],
            },
            signal_value: { type: "string" },
            polarity: { type: "integer", enum: [1, -1] },
            context: { type: "string" },
            new_context_label: { type: "string" },
            relation: { type: "string" },
            name: { type: ["string", "null"] },
            source: { type: "string", enum: ["stated", "inferred"] },
            confidence: { type: "number" },
            evidence_quote: { type: "string" },
          },
          required: ["op", "person_ref", "source", "confidence", "evidence_quote"],
        },
      },
      ambiguous_subjects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            candidate_person_refs: {
              type: "array",
              items: { type: "string" },
            },
            evidence_quote: { type: "string" },
          },
          required: ["description", "candidate_person_refs", "evidence_quote"],
        },
      },
    },
    required: ["ops", "ambiguous_subjects"],
  },
};
