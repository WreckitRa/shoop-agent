import type { FashionClarificationQuestion } from "../router/types";
import {
  bucketForIntakeField,
  intakeFieldForBucket,
  type IntakeSizeField,
  type SizeGarmentBucket,
} from "./garment-size-fields";

const BUCKETS: SizeGarmentBucket[] = ["shoes", "dresses", "bottoms", "tops"];

function bucketFromQuestionText(text: string): SizeGarmentBucket | null {
  const t = text.toLowerCase();
  if (/\b(shoe|shoes|sneaker|boot|heel|loafer|sandal)\b/.test(t)) return "shoes";
  if (/\b(dress|dresses|gown|skirt)\b/.test(t)) return "dresses";
  if (/\b(bottom|waist|pant|trouser|jean|chino|short)\b/.test(t)) return "bottoms";
  if (/\b(top|shirt|tee|blouse|sweater|jacket|blazer|coat)\b/.test(t)) {
    return "tops";
  }
  return null;
}

function asBucket(raw: string | undefined | null): SizeGarmentBucket | null {
  const t = raw?.trim().toLowerCase() ?? "";
  return (BUCKETS as string[]).includes(t) ? (t as SizeGarmentBucket) : null;
}

/**
 * LLM size asks often omit `field` or set field:"size". Map them onto
 * size_tops|size_bottoms|size_shoes|size_dresses so answers persist correctly
 * and cross-chat gates see the right FashionFact bucket.
 */
export function normalizeSizeQuestionFields(
  question: FashionClarificationQuestion,
): FashionClarificationQuestion {
  if (question.gap !== "size") return question;

  let bucket =
    asBucket(question.garment_type) ??
    (question.field && question.field.startsWith("size_")
      ? bucketForIntakeField(question.field as IntakeSizeField)
      : null) ??
    bucketFromQuestionText(question.text);

  // LLM often emits field:"size" (not in ApplyField union) — fall back to tops
  // only when text/garment gave nothing.
  const rawField = question.field as string | undefined;
  if (!bucket && rawField === "size") {
    bucket = "tops";
  }
  if (!bucket) return question;

  return {
    ...question,
    garment_type: bucket,
    field: intakeFieldForBucket(bucket),
  };
}

export function normalizeClarificationSizeFields(
  questions: FashionClarificationQuestion[],
): FashionClarificationQuestion[] {
  return questions.map(normalizeSizeQuestionFields);
}
