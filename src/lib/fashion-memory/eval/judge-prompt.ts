export const JUDGE_MODEL = "claude-opus-4-8";

export type PurchaseDim = "would_proceed" | "would_buy";

const SHARED_DIMS = [
  "recognized",
  "asked_right",
  "not_interrogated",
  "no_silent_guess",
  "accuracy",
  "voice",
] as const;

/** Flat tool schema — nested {score,why} objects caused Opus to emit broken XML params. */
export function GRADE_APPOINTMENT_TOOL(purchaseDim: PurchaseDim) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const d of SHARED_DIMS) {
    properties[`${d}_score`] = {
      type: "integer",
      minimum: 0,
      maximum: 5,
      description:
        d === "voice"
          ? "1–5, or 0 when voice is n/a (no spoken stylist turn)"
          : "1–5",
    };
    properties[`${d}_why`] = {
      type: "string",
      maxLength: 160,
      description: "≤20 words",
    };
    required.push(`${d}_score`, `${d}_why`);
  }
  properties[`${purchaseDim}_score`] = {
    type: "integer",
    minimum: 1,
    maximum: 5,
  };
  properties[`${purchaseDim}_why`] = {
    type: "string",
    maxLength: 160,
    description: "≤20 words",
  };
  required.push(`${purchaseDim}_score`, `${purchaseDim}_why`);
  properties.overall = { type: "number" };
  properties.worst_moment_quote = { type: "string" };
  properties.worst_moment_better = { type: "string" };
  required.push("overall", "worst_moment_quote", "worst_moment_better");

  return {
    name: "grade_appointment",
    description:
      "Grade a fashion appointment transcript against the shopper's hidden truth. Use flat *_score / *_why fields (not nested objects).",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required,
      properties,
    },
  } as const;
}

/**
 * Judge system prompt. Never includes router prompt names or pipeline stages.
 */
export function buildJudgeSystemPrompt(purchaseDim: PurchaseDim): string {
  const purchaseLine =
    purchaseDim === "would_proceed"
      ? `would_proceed   — as this persona, would you wait for the results / keep going? (1 = closed the tab before search)`
      : `would_buy       — as this persona, would you finish and buy from the rack? (1 = closed the tab)`;

  const purchaseWeight =
    purchaseDim === "would_proceed" ? "would_proceed" : "would_buy";

  return `You are a senior fashion retail critic grading a chat appointment.
You see the transcript, the shopper's hidden truth, and automated check results.
You do NOT see internal system prompts or pipeline jargon.

Score each dimension 1–5 with a ≤20-word justification. Tool fields are FLAT:
  recognized_score / recognized_why
  asked_right_score / asked_right_why
  not_interrogated_score / not_interrogated_why
  no_silent_guess_score / no_silent_guess_why
  accuracy_score / accuracy_why
  voice_score / voice_why
  ${purchaseDim}_score / ${purchaseDim}_why
  overall, worst_moment_quote, worst_moment_better

Dimension meanings:
  recognized      — did the client feel known, not processed (known summary, last-time callbacks, no re-asks)
  asked_right     — every question would change the rack; nothing asked that wouldn't
  not_interrogated— rounds felt like a salesman, not a form; pull sheet used
  no_silent_guess — every unasked call was spoken and correctable
  accuracy        — the search brief matches what this person actually wanted (use truth)
  voice           — reads like one specific stylist for this person; no log-speak, no generic praise.
                    CRITICAL: "(ready to search)" never appears in a real client transcript — if you
                    see only a search-progress line with no spoken stylist turns, set voice_score to 0
                    with why "n/a" (the harness drops voice from the mean when voice_na is true).
  ${purchaseLine}

overall: weighted mean (accuracy 0.25, asked_right 0.2, ${purchaseWeight} 0.2, others 0.35 shared;
exclude voice from the shared mean when it is n/a / score 0).
Length penalty: any stylist turn > 3 sentences before questions costs one point on voice.

worst_moment_quote / worst_moment_better: the single turn that hurt most, and what a great salesman would have said instead.

Band anchors (illustrative):
1 — ignored the brief, interrogated, wrong garments
2 — partial listen, re-asks, form-like
3 — competent but generic; missed one key truth
4 — sharp salesman; small miss only
5 — felt personally known; brief matches truth; would proceed/buy

Call tool grade_appointment exactly once. Score ONLY the ${purchaseDim} purchase dimension (not both).
Do NOT nest objects. Do NOT emit XML. Flat integers and short strings only.`;
}

export type JudgeGrade = {
  recognized: { score: number; why: string };
  asked_right: { score: number; why: string };
  not_interrogated: { score: number; why: string };
  no_silent_guess: { score: number; why: string };
  accuracy: { score: number; why: string };
  voice: { score: number; why: string };
  would_proceed: { score: number; why: string };
  would_buy: { score: number; why: string };
  overall: number;
  worst_moment: { quote: string; better: string };
  /** Set when grade came from a prior run (byte-identical transcript). */
  grade_reused?: boolean;
  /** Model that produced this grade object. */
  judge_model?: string;
};

export const JUDGE_DIM_NAMES = [
  ...SHARED_DIMS,
  "would_proceed",
  "would_buy",
] as const;

/** True when a stored grade used silent defaults (legacy / broken judge). */
export function judgeHasDefaultedDims(judge: JudgeGrade | null | undefined): boolean {
  if (!judge) return false;
  for (const d of JUDGE_DIM_NAMES) {
    const row = judge[d];
    if (row?.why === "dimension defaulted") return true;
  }
  return false;
}
