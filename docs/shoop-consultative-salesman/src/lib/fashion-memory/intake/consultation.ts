/**
 * Consultation bookkeeping (L2 code side).
 *
 * This module is deliberately dumb. It never reads chip text to decide what
 * the client meant — that is the router LLM's job on the next turn. It only:
 *   1. counts consultative rounds per appointment,
 *   2. builds the APPOINTMENT context line (and the budget-spent note),
 *   3. guarantees the "You decide" chip and escape chip on consult turns,
 *   4. decides whether a clarification may be auto-upgraded to a search
 *      (only when every question is blocking and already satisfied),
 *   5. sanitizes gaps against the whitelist.
 *
 * Wire-up (run-fashion-chat-stream.ts):
 *   const appt = loadAppointment(conversationMeta);
 *   const ctxSuffix = buildAppointmentContext(appt);   // appended after CURRENT DATE
 *   ... router call ...
 *   if (call.name === "ask_clarification") {
 *     const { call: fixed, appt: next } = onClarification(call, appt);
 *     persistAppointment(next); emit chips from fixed;
 *   }
 *   if (call.name === "ready_to_search") persistAppointment(resetAppointment(call.brief));
 */

import {
  BLOCKING_GAPS,
  CLARIFICATION_GAPS,
  type ClarificationGap,
} from "../router/tools";

export const MAX_CONSULT_ROUNDS = 2;

export interface Appointment {
  /** Stable key for "same request": recipient + sorted garments. */
  key: string | null;
  rounds_used: number;
  /** Gaps asked in consult questions so far, to detect repeats. */
  asked: ClarificationGap[];
}

export const EMPTY_APPOINTMENT: Appointment = { key: null, rounds_used: 0, asked: [] };

export function appointmentKey(brief?: { recipient_person_id?: string; garments?: string[] } | null) {
  if (!brief?.garments?.length) return null;
  return `${brief.recipient_person_id ?? "self"}::${[...brief.garments].map((g) => g.toLowerCase()).sort().join(",")}`;
}

export function resetAppointment(brief?: Parameters<typeof appointmentKey>[0]): Appointment {
  return { key: appointmentKey(brief), rounds_used: 0, asked: [] };
}

/** Uncached context suffix. Keep this out of the cached prefix. */
export function buildAppointmentContext(appt: Appointment): string {
  const spent = appt.rounds_used >= MAX_CONSULT_ROUNDS;
  return (
    `APPOINTMENT: rounds_used=${appt.rounds_used}` +
    (spent ? " CONSULTATION BUDGET SPENT — call ready_to_search and declare assumptions." : "")
  );
}

// ---------- clarification handling ----------

type QuickOption = string | { label: string; preview_query: string };
export interface RouterQuestion {
  gap: ClarificationGap;
  kind: "blocking" | "consult";
  text: string;
  why?: string;
  quick_options: QuickOption[];
  allow_multiple?: boolean;
}
export interface AskClarificationCall {
  reply: string;
  known_summary?: string;
  questions: RouterQuestion[];
  escape_chip?: string;
  brief?: any;
}

const YOU_DECIDE_BY_LANG: Record<string, string> = {
  en: "You decide",
  fr: "Tu décides",
  ar: "أنت قرر",
  es: "Tú decides",
};
const ESCAPE_BY_LANG: Record<string, string> = {
  en: "Just show me",
  fr: "Vas-y, montre-moi",
  ar: "يلا فرجيني",
  es: "Muéstrame ya",
};

function labelOf(o: QuickOption) {
  return typeof o === "string" ? o : o.label;
}

/**
 * Guarantees the UI contract on consult questions. The prompt already asks
 * the LLM to add these; this is the seatbelt, not the driver. Language is a
 * hint from the orchestrator's detected user language (default en).
 */
export function enforceConsultChips(call: AskClarificationCall, lang = "en"): AskClarificationCall {
  const youDecide = YOU_DECIDE_BY_LANG[lang] ?? YOU_DECIDE_BY_LANG.en;
  const escape = ESCAPE_BY_LANG[lang] ?? ESCAPE_BY_LANG.en;

  const questions = call.questions.map((q) => {
    if (q.kind !== "consult") return q;
    const has = q.quick_options.some((o) => /you decide|tu décides|أنت قرر|tú decides/i.test(labelOf(o)));
    const opts = has ? q.quick_options : [...q.quick_options.slice(0, 4), youDecide];
    return { ...q, quick_options: opts };
  });

  const hasConsult = questions.some((q) => q.kind === "consult");
  return {
    ...call,
    questions,
    escape_chip: hasConsult ? call.escape_chip ?? escape : undefined,
  };
}

/** Drop unknown gaps; drop consult questions past budget; dedupe by gap. */
export function sanitizeQuestions(call: AskClarificationCall, appt: Appointment): AskClarificationCall {
  const seen = new Set<string>();
  const spent = appt.rounds_used >= MAX_CONSULT_ROUNDS;
  const questions = call.questions.filter((q) => {
    if (!(CLARIFICATION_GAPS as readonly string[]).includes(q.gap)) return false;
    if (seen.has(q.gap)) return false;
    // kind is the LLM's; but a gap in the blocking set is always blocking.
    if (BLOCKING_GAPS.has(q.gap)) q.kind = "blocking";
    if (q.kind === "consult" && spent) return false;
    seen.add(q.gap);
    return true;
  });
  return { ...call, questions: questions.slice(0, 4) };
}

/**
 * Old behavior: if all gaps were already satisfied, upgrade to search.
 * New behavior: only when every remaining question is BLOCKING and satisfied.
 * A consult question is never skipped by code — if the LLM chose to ask it,
 * the client sees it.
 */
export function mayAutoUpgradeToSearch(
  call: AskClarificationCall,
  isSatisfied: (gap: ClarificationGap) => boolean,
): boolean {
  if (call.questions.length === 0) return true;
  if (call.questions.some((q) => q.kind === "consult")) return false;
  return call.questions.every((q) => isSatisfied(q.gap));
}

export function onClarification(
  raw: AskClarificationCall,
  appt: Appointment,
  lang = "en",
): { call: AskClarificationCall; appt: Appointment } {
  const key = appointmentKey(raw.brief) ?? appt.key;
  const same = key === appt.key || appt.key === null;
  const base: Appointment = same ? { ...appt, key } : resetAppointment(raw.brief);

  const sanitized = sanitizeQuestions(raw, base);
  const call = enforceConsultChips(sanitized, lang);

  const consultGaps = call.questions.filter((q) => q.kind === "consult").map((q) => q.gap);
  const next: Appointment = {
    key,
    rounds_used: consultGaps.length > 0 ? base.rounds_used + 1 : base.rounds_used,
    asked: [...base.asked, ...consultGaps],
  };
  return { call, appt: next };
}

/**
 * Dodge integration: existing dodge logic keys on gap and counts declines.
 * Chip taps for "You decide" and the escape chip are ANSWERS, not dodges.
 * Export the predicate so post-router.ts can use it without knowing labels.
 */
export function isResolutionTap(message: string): boolean {
  const m = message.trim();
  const labels = [...Object.values(YOU_DECIDE_BY_LANG), ...Object.values(ESCAPE_BY_LANG)];
  return labels.some((l) => l.toLowerCase() === m.toLowerCase());
}
