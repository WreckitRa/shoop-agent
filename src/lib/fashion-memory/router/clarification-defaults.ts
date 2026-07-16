import { PERSON_NAME_SKIP_OPTION } from "../extraction/person-identity";
import type {
  FashionClarificationGap,
  FashionClarificationQuestion,
} from "./types";

const OTHER = "Other";

/** Default chips when the LLM omits quick_options for a known gap. */
export function defaultQuickOptionsForGap(
  gap: FashionClarificationGap,
  garmentType?: string,
): string[] {
  const bucket = garmentType?.trim().toLowerCase() ?? "";
  switch (gap) {
    case "department":
      return ["Men's", "Women's", "Mix it", OTHER];
    case "size":
      if (bucket === "shoes" || /\bshoe/.test(bucket)) {
        return ["7", "8", "9", "10", "11", OTHER];
      }
      if (bucket === "bottoms" || /\b(pant|trouser|waist)/.test(bucket)) {
        return ["28", "30", "32", "34", "36", OTHER];
      }
      if (bucket === "dresses" || /\bdress/.test(bucket)) {
        return ["XS", "S", "M", "L", "XL", OTHER];
      }
      // tops / unknown size
      return ["XS", "S", "M", "L", "XL", OTHER];
    case "recipient":
      return ["For me", "Someone else", OTHER];
    case "person_name":
      // Free text + Skip only — never seed roster names.
      return [PERSON_NAME_SKIP_OPTION];
    case "garment":
      return ["One piece", "Full outfit", "A few options", OTHER];
    case "occasion":
      return ["Work", "Weekend", "Event / night out", OTHER];
    case "budget":
      return ["$150", "$250", "$400", OTHER];
    default:
      return [OTHER];
  }
}

/**
 * Ensure every clarification question has tappable options, always ending
 * with Other so free-form answers are available — except person_name (Skip only).
 */
export function ensureClarificationQuickOptions(
  question: FashionClarificationQuestion,
): FashionClarificationQuestion {
  if (question.gap === "person_name") {
    return {
      ...question,
      quick_options: [PERSON_NAME_SKIP_OPTION],
    };
  }

  const existing = (question.quick_options ?? [])
    .map((o) => o.trim())
    .filter(Boolean);
  const base =
    existing.length >= 2
      ? existing
      : defaultQuickOptionsForGap(question.gap, question.garment_type);

  const withoutOther = base.filter(
    (o) => o.toLowerCase() !== OTHER.toLowerCase(),
  );
  return {
    ...question,
    quick_options: [...withoutOther.slice(0, 5), OTHER],
  };
}

export function ensureQuestionsHaveQuickOptions(
  questions: FashionClarificationQuestion[],
): FashionClarificationQuestion[] {
  return questions.map(ensureClarificationQuickOptions);
}

export { OTHER as CLARIFICATION_OTHER_OPTION };
