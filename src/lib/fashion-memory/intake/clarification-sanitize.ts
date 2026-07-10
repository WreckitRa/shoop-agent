/**
 * Sanitize clarification questions: strip machinery/meta asks and dedupe text.
 */
import { logAiChat } from "@/lib/ai-chat/observability";
import { recordPipelineEvent } from "../observability/trace";
import type { FashionClarificationQuestion } from "../router/types";

/** Matches internal bookkeeping questions that must never reach the user. */
export const META_QUESTION_RE =
  /roster|profile|set (him|her|them) up|already (in|on) my/i;

export function isMetaClarificationQuestion(text: string): boolean {
  return META_QUESTION_RE.test(text);
}

export function sanitizeClarificationQuestions(params: {
  questions: FashionClarificationQuestion[];
  traceId?: string | null;
}): FashionClarificationQuestion[] {
  const seen = new Set<string>();
  const out: FashionClarificationQuestion[] = [];

  for (const q of params.questions) {
    const text = q.text.trim();
    if (!text) continue;

    if (isMetaClarificationQuestion(text)) {
      logAiChat("info", "meta_question_stripped", {
        traceId: params.traceId,
        text: text.slice(0, 200),
        gap: q.gap,
      });
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "gate",
        payload: {
          decision: "meta_question_stripped",
          text: text.slice(0, 200),
          gap: q.gap,
        },
      });
      continue;
    }

    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...q, text });
  }

  return out;
}
