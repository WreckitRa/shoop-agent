/**
 * Sanitize clarification questions: strip machinery/meta asks, dedupe text,
 * and never let roster names appear as quick_options on new-person name asks.
 */
import { logAiChat } from "@/lib/ai-chat/observability";
import {
  isSkipNameOption,
  PERSON_NAME_SKIP_OPTION,
} from "../extraction/person-identity";
import { recordPipelineEvent } from "../observability/trace";
import {
  asNormalizedOptions,
  normalizeClarificationOption,
} from "../router/clarification-defaults";
import type {
  FashionClarificationOption,
  FashionClarificationQuestion,
} from "../router/types";

/** Matches internal bookkeeping questions that must never reach the user. */
export const META_QUESTION_RE =
  /roster|profile|set (him|her|them) up|already (in|on) my/i;

export function isMetaClarificationQuestion(text: string): boolean {
  return META_QUESTION_RE.test(text);
}

function stripRosterNamesFromPersonNameQuestion(
  question: FashionClarificationQuestion,
  rosterNames: string[],
  traceId?: string | null,
): FashionClarificationQuestion {
  if (question.gap !== "person_name") return question;
  const banned = new Set(
    rosterNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  if (!banned.size && !question.quick_options?.length) {
    return {
      ...question,
      quick_options: [{ id: "skip", label: PERSON_NAME_SKIP_OPTION }],
    };
  }

  const kept: FashionClarificationOption[] = [];
  for (const raw of question.quick_options ?? []) {
    const opt = normalizeClarificationOption(raw);
    if (!opt.label) continue;
    if (isSkipNameOption(opt.label)) {
      if (!kept.some((k) => isSkipNameOption(k.label))) {
        kept.push({ id: "skip", label: PERSON_NAME_SKIP_OPTION });
      }
      continue;
    }
    if (banned.has(opt.label.toLowerCase())) {
      logAiChat("info", "roster_name_option_stripped", {
        traceId,
        option: opt.label.slice(0, 80),
        gap: question.gap,
      });
      recordPipelineEvent({
        traceId,
        stage: "gate",
        payload: {
          decision: "roster_name_option_stripped",
          option: opt.label.slice(0, 80),
          gap: question.gap,
        },
      });
      continue;
    }
    // Free-text name asks: drop every non-Skip chip (relation beats name).
    logAiChat("info", "roster_name_option_stripped", {
      traceId,
      option: opt.label.slice(0, 80),
      gap: question.gap,
      reason: "person_name_non_skip",
    });
    recordPipelineEvent({
      traceId,
      stage: "gate",
      payload: {
        decision: "roster_name_option_stripped",
        option: opt.label.slice(0, 80),
        gap: question.gap,
        reason: "person_name_non_skip",
      },
    });
  }

  if (!kept.some((k) => isSkipNameOption(k.label))) {
    kept.push({ id: "skip", label: PERSON_NAME_SKIP_OPTION });
  }
  return { ...question, quick_options: kept.slice(0, 1) };
}

export function rewriteSelfNameInQuestionText(
  text: string,
  selfName: string,
): string {
  const name = selfName.trim();
  if (!name || name.length < 2) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // "Sam17's typical dress size" → "your typical dress size"
  let out = text.replace(new RegExp(`\\b${esc}'s\\b`, "gi"), "your");
  // "What size does Sam17 wear" → "What size do you wear"
  out = out.replace(
    new RegExp(`\\bdoes\\s+${esc}\\b`, "gi"),
    "do you",
  );
  out = out.replace(new RegExp(`\\bis\\s+${esc}\\b`, "gi"), "are you");
  // Bare name leftover in a question about self → you
  out = out.replace(new RegExp(`\\b${esc}\\b`, "gi"), "you");
  // Cleanup "you you" / "your you"
  out = out.replace(/\byou\s+you\b/gi, "you").replace(/\byour\s+you\b/gi, "your");
  return out;
}

export function sanitizeClarificationQuestions(params: {
  questions: FashionClarificationQuestion[];
  traceId?: string | null;
  /** Existing roster display names — banned as person_name quick_options. */
  rosterNames?: string[];
  /** When true, drop person_name questions (relation unique — name optional). */
  stripPersonNameQuestions?: boolean;
  /** Self recipient display name — rewrite to you/your in questions. */
  selfDisplayName?: string | null;
}): FashionClarificationQuestion[] {
  const seen = new Set<string>();
  const out: FashionClarificationQuestion[] = [];
  const rosterNames = params.rosterNames ?? [];
  const selfName = params.selfDisplayName?.trim() || "";

  for (const q of params.questions) {
    let text = q.text.trim();
    if (!text) continue;
    if (selfName) {
      const rewritten = rewriteSelfNameInQuestionText(text, selfName);
      if (rewritten !== text) {
        logAiChat("info", "self_name_rewritten_in_question", {
          traceId: params.traceId,
          from: text.slice(0, 120),
          to: rewritten.slice(0, 120),
        });
        text = rewritten;
      }
    }

    if (params.stripPersonNameQuestions && q.gap === "person_name") {
      logAiChat("info", "person_name_optional_stripped", {
        traceId: params.traceId,
        text: text.slice(0, 200),
      });
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "gate",
        payload: {
          decision: "person_name_optional_stripped",
          text: text.slice(0, 200),
        },
      });
      continue;
    }

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
    out.push(
      stripRosterNamesFromPersonNameQuestion(
        {
          ...q,
          text,
          quick_options: q.quick_options
            ? asNormalizedOptions(q.quick_options)
            : undefined,
        },
        rosterNames,
        params.traceId,
      ),
    );
  }

  return out;
}
