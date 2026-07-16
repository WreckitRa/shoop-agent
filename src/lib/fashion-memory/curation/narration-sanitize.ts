import { logAiChat } from "@/lib/ai-chat/observability";

/**
 * Machinery vocabulary must never reach the customer. When a narration
 * field matches, substitute the plain-voice fallback and log.
 */
export const NARRATION_MACHINERY_RE =
  /\b(funnel|fit score|verified options|pipeline|curation|fallback|fits the brief|verified\s+\w+\s+option)\b/i;

export function sanitizeNarrationField(params: {
  field: string;
  value: string | undefined | null;
  plain: string;
  traceId?: string | null;
}): string {
  const text = params.value?.trim() ?? "";
  if (!text) return params.plain;
  if (!NARRATION_MACHINERY_RE.test(text)) return text;
  logAiChat("warn", "fashion_narration_machinery_rejected", {
    traceId: params.traceId,
    field: params.field,
    rejected: text.slice(0, 160),
  });
  return params.plain;
}

export function sanitizeCurationNarration(params: {
  opening: string;
  brand_note?: string;
  budget_note?: string;
  thin_note?: string;
  plainOpening: string;
  plainThin?: string;
  traceId?: string | null;
}): {
  opening: string;
  brand_note?: string;
  budget_note?: string;
  thin_note?: string;
} {
  const opening = sanitizeNarrationField({
    field: "opening",
    value: params.opening,
    plain: params.plainOpening,
    traceId: params.traceId,
  });
  const thin_note = params.thin_note
    ? sanitizeNarrationField({
        field: "thin_note",
        value: params.thin_note,
        plain: params.plainThin ?? params.plainOpening,
        traceId: params.traceId,
      })
    : undefined;
  const brand_note = params.brand_note
    ? sanitizeNarrationField({
        field: "brand_note",
        value: params.brand_note,
        plain: "I couldn't lock every piece to the brand you named — same-spirit options are in the mix.",
        traceId: params.traceId,
      })
    : undefined;
  const budget_note = params.budget_note
    ? sanitizeNarrationField({
        field: "budget_note",
        value: params.budget_note,
        plain: "Budget was tight for a full set — I leaned on strong basics where the numbers worked.",
        traceId: params.traceId,
      })
    : undefined;
  return { opening, brand_note, budget_note, thin_note };
}
