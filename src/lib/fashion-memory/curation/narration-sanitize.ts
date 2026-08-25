import { logAiChat } from "@/lib/ai-chat/observability";
import { recordPipelineEvent } from "../observability/trace";

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
  next_step_offer?: { text: string; chips: string[] };
  plainOpening: string;
  plainThin?: string;
  assumptions?: string[];
  traceId?: string | null;
}): {
  opening: string;
  brand_note?: string;
  budget_note?: string;
  thin_note?: string;
  next_step_offer?: { text: string; chips: string[] };
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
  const next_step_offer = params.next_step_offer
    && params.next_step_offer.text.trim()
    && params.next_step_offer.chips.filter((c) => c.trim()).length >= 2
      ? {
          text: params.next_step_offer.text.trim(),
          chips: params.next_step_offer.chips.map((c) => c.trim()).filter(Boolean).slice(0, 4),
        }
      : undefined;
  return {
    opening: repairUnspokenAssumptions({
      opening,
      assumptions: params.assumptions,
      traceId: params.traceId,
    }),
    brand_note,
    budget_note,
    thin_note,
    next_step_offer,
  };
}

/** First ~6 content words, lowercased, for a tolerant "did they say this" check. */
function assumptionKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
}

function assumptionVoiced(opening: string, assumption: string): boolean {
  const hay = opening.toLowerCase();
  const key = assumptionKey(assumption);
  if (!key) return true;
  if (hay.includes(key)) return true;
  const words = key.split(" ");
  const hits = words.filter((w) => w.length > 2 && hay.includes(w)).length;
  return hits >= Math.min(3, words.length);
}

export function repairUnspokenAssumptions(params: {
  opening: string;
  assumptions?: string[];
  traceId?: string | null;
}): string {
  const missing = (params.assumptions ?? []).filter(
    (a) => !assumptionVoiced(params.opening, a),
  );
  if (missing.length === 0) return params.opening;
  recordPipelineEvent({
    traceId: params.traceId,
    stage: "curation",
    payload: {
      kind: "assumptions_repaired",
      missing: missing.length,
      total: params.assumptions?.length ?? 0,
    },
  });
  return `${missing.join(" ")} ${params.opening}`.trim();
}
