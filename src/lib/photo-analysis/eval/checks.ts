import { cardVoiceIssues, type ReadingView } from "../verdict-reading";

export type VerdictEvalCheck = {
  id: string;
  ok: boolean;
  detail?: string;
};

export function runVerdictCardChecks(view: ReadingView): VerdictEvalCheck[] {
  const voice = cardVoiceIssues(view);
  const checks: VerdictEvalCheck[] = [
    {
      id: "opening_words",
      ok: !voice.some((i) => i.startsWith("opening_words")),
    },
    {
      id: "opening_evidence",
      ok: !voice.includes("opening_evidence"),
    },
    {
      id: "opening_banned_vocab",
      ok: !voice.includes("opening_banned_vocab"),
    },
    {
      id: "internal_vocab",
      ok: !voice.includes("internal_vocab"),
    },
    {
      id: "named_swatches",
      ok: !voice.includes("unnamed_swatch"),
    },
    {
      id: "three_rules",
      ok: view.rules.length === 3,
      detail: String(view.rules.length),
    },
    {
      id: "no_area_dupes",
      ok: !voice.some((i) => i.startsWith("dup:")),
    },
    {
      id: "no_check_path_as_dont",
      ok: view.areas
        .filter((a) => a.id === "fit" || a.id === "proportion")
        .every((a) => a.recs.every((r) => r.kind !== "dont")),
    },
    {
      id: "cta_copy_ready",
      ok: true,
    },
  ];
  return checks;
}
