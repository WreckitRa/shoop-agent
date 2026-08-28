import { buildPersonShortIdMap } from "./extraction/context-format";
import { formatPersonChoiceLabel } from "./extraction/person-identity";
import type { AmbiguousSubject, FashionLlmOp } from "./extraction/tool-schema";
import type { FashionClarificationQuestion, FashionRouterResult } from "./router/types";
import type { PersonRow } from "./types";

export type NextRouterAsk = { gap: "recipient"; chips: string[] };

export function personFromRef(
  ref: string,
  people: PersonRow[],
  personShortIds: Record<string, string>,
): PersonRow | null {
  const raw = ref.trim().replace(/^#/, "");
  if (!raw) return null;
  const fromShort = personShortIds[raw.toLowerCase()];
  if (fromShort) return people.find((p) => p.id === fromShort) ?? null;
  return people.find((p) => p.id === raw) ?? null;
}

export function chipsForUnresolvedSubject(
  subject: AmbiguousSubject,
  people: PersonRow[],
  personShortIds: Record<string, string>,
): string[] {
  const chips: string[] = [];
  const seen = new Set<string>();
  for (const ref of subject.candidate_person_refs) {
    const person = personFromRef(ref, people, personShortIds);
    if (!person) continue;
    const label = formatPersonChoiceLabel(person);
    if (seen.has(label)) continue;
    seen.add(label);
    chips.push(label);
  }
  if (!chips.includes("Other")) chips.push("Other");
  return chips;
}

export function formatUnresolvedLine(
  subject: AmbiguousSubject,
  people: PersonRow[],
  personShortIds: Record<string, string>,
): string {
  const mention = subject.description.trim() || "someone";
  const labels = chipsForUnresolvedSubject(
    subject,
    people,
    personShortIds,
  ).filter((c) => c !== "Other");
  const could = labels.length ? labels.join(", ") : "more than one roster person";
  return `UNRESOLVED: "${mention}" could be ${could}`;
}

export function unresolvedContextLines(
  subjects: AmbiguousSubject[],
  people: PersonRow[],
  personShortIds?: Record<string, string>,
): string[] {
  const shorts = personShortIds ?? buildPersonShortIdMap(people);
  return subjects.map((s) => formatUnresolvedLine(s, people, shorts));
}

export function nextRouterAsksFromUnresolved(params: {
  subjects: AmbiguousSubject[];
  people: PersonRow[];
  personShortIds?: Record<string, string>;
}): NextRouterAsk[] {
  if (!params.subjects.length) return [];
  const shorts = params.personShortIds ?? buildPersonShortIdMap(params.people);
  return params.subjects.map((subject) => ({
    gap: "recipient" as const,
    chips: chipsForUnresolvedSubject(subject, params.people, shorts),
  }));
}

export function personFromRecipientChip(
  label: string,
  people: PersonRow[],
): PersonRow | null {
  const want = label.trim().toLowerCase();
  if (!want || want === "other" || want === "skip") return null;
  return (
    people.find(
      (p) => formatPersonChoiceLabel(p).toLowerCase() === want,
    ) ??
    people.find((p) => (p.name ?? "").trim().toLowerCase() === want) ??
    null
  );
}

export function recipientQuestionFromUnresolved(params: {
  subjects: AmbiguousSubject[];
  people: PersonRow[];
  personShortIds?: Record<string, string>;
}): FashionClarificationQuestion | null {
  const asks = nextRouterAsksFromUnresolved(params);
  const chips = [...new Set(asks.flatMap((a) => a.chips))];
  if (chips.length < 2) return null;
  const mention = params.subjects[0]?.description.trim() || "person";
  return {
    text: `Which ${mention} did you mean?`,
    gap: "recipient",
    kind: "blocking",
    quick_options: chips,
    allow_other: true,
  };
}

export function bundleUnresolvedRecipientAsk(params: {
  result: FashionRouterResult;
  subjects: AmbiguousSubject[];
  people: PersonRow[];
  personShortIds?: Record<string, string>;
  isRefinement: boolean;
  alreadyAsked: boolean;
}): FashionRouterResult {
  if (params.isRefinement || params.alreadyAsked || !params.subjects.length) {
    return params.result;
  }
  const question = recipientQuestionFromUnresolved(params);
  if (!question) return params.result;

  if (params.result.move === "ask_clarification") {
    if (params.result.questions.some((q) => q.gap === "recipient")) {
      return params.result;
    }
    return {
      ...params.result,
      questions: [question, ...params.result.questions],
    };
  }

  const reply =
    params.result.move === "respond_off_topic"
      ? params.result.reply
      : params.result.move === "ready_to_search"
        ? (params.result.reply ?? question.text)
        : question.text;

  return {
    move: "ask_clarification",
    reply: reply || question.text,
    questions: [question],
    brief: params.result.move === "ready_to_search" ? params.result.brief : undefined,
  };
}

export function attachParkedOps(
  subjects: AmbiguousSubject[],
  parkedOps: FashionLlmOp[],
): AmbiguousSubject[] {
  if (!parkedOps.length) return subjects;
  if (!subjects.length) {
    return [
      {
        description: "unresolved",
        candidate_person_refs: ["unresolved"],
        evidence_quote: parkedOps[0]!.evidence_quote,
        parked_ops: parkedOps,
      },
    ];
  }
  return [
    { ...subjects[0]!, parked_ops: parkedOps },
    ...subjects.slice(1),
  ];
}

export function parkedOpsFromSubjects(
  subjects: AmbiguousSubject[] | null | undefined,
): FashionLlmOp[] {
  if (!subjects?.length) return [];
  return subjects.flatMap((s) => s.parked_ops ?? []);
}

export function remapParkedOpsToPersonRef(
  ops: FashionLlmOp[],
  personRef: string,
): FashionLlmOp[] {
  return ops
    .filter((op) => op.op !== "new_person")
    .map((op) => ({ ...op, person_ref: personRef }));
}

export function mergeAmbiguousSubjects(
  a: AmbiguousSubject[],
  b: AmbiguousSubject[],
): AmbiguousSubject[] {
  const merged = [...a];
  for (const subject of b) {
    const dup = merged.some(
      (m) =>
        m.description === subject.description &&
        m.candidate_person_refs.join("\0") ===
          subject.candidate_person_refs.join("\0"),
    );
    if (!dup) merged.push(subject);
  }
  return merged;
}
