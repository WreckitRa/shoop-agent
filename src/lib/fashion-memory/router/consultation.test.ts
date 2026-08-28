import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONSULTATION_BUDGET_SPENT_NOTE,
  JUST_SHOW_ME_LABEL,
  YOU_DECIDE_LABEL,
  coerceMislabelledPreferenceAnchor,
  defaultKindForGap,
  ensureYouDecideOption,
  isEscapeOrYouDecideMessage,
  nextConsultRoundsUsed,
  questionsHaveConsult,
} from "./consultation";
import { buildFashionRouterContextBlock } from "./prompt";
import type { FashionClarificationQuestion } from "./types";
import type { FashionPendingBriefMetaV1, FashionSearchBrief } from "./types";

const consultQ = (
  gap: FashionClarificationQuestion["gap"],
): FashionClarificationQuestion => ({
  text: `consult ${gap}`,
  gap,
  kind: "consult",
  quick_options: ["A", "B"],
});

const brief = (garments: string[]): FashionSearchBrief => ({
  recipient_person_id: "self",
  request_type: "single_item",
  garments,
  occasion_context: "general",
  quantity_hint: "a few",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "shirts",
});

const pending = (
  garments: string[],
  rounds: 0 | 1 | 2,
): FashionPendingBriefMetaV1 => ({
  version: 1,
  brief: brief(garments),
  recipientPersonId: "self",
  savedAt: "2026-08-24T00:00:00.000Z",
  consult_rounds_used: rounds,
});

describe("consultation helpers", () => {
  it("defaults new gaps to consult and blocking gaps to blocking", () => {
    assert.equal(defaultKindForGap("size"), "blocking");
    assert.equal(defaultKindForGap("depth"), "consult");
    assert.equal(defaultKindForGap("preference_anchor"), "consult");
    assert.equal(defaultKindForGap("slots"), "consult");
  });

  it("appends You decide only on consult questions", () => {
    const withChip = ensureYouDecideOption(consultQ("depth"));
    assert.ok(
      withChip.quick_options?.some((o) =>
        typeof o === "string"
          ? o === YOU_DECIDE_LABEL
          : o.label === YOU_DECIDE_LABEL,
      ),
    );
    const blocking: FashionClarificationQuestion = {
      text: "Size?",
      gap: "size",
      kind: "blocking",
      quick_options: ["M", "L"],
    };
    assert.deepEqual(ensureYouDecideOption(blocking).quick_options, ["M", "L"]);
  });

  it("treats You decide / Just show me as answers, not dodges", () => {
    assert.equal(isEscapeOrYouDecideMessage(YOU_DECIDE_LABEL), true);
    assert.equal(isEscapeOrYouDecideMessage(JUST_SHOW_ME_LABEL), true);
    assert.equal(isEscapeOrYouDecideMessage("whatever else"), false);
    assert.equal(
      isEscapeOrYouDecideMessage("Ooh, let me see what you've got!"),
      true,
    );
  });

  it("caps consult rounds at 2 and resets on a new garment set", () => {
    const first = nextConsultRoundsUsed({
      pending: null,
      brief: brief(["shirt"]),
      questions: [consultQ("depth")],
    });
    assert.equal(first, 1);
    const anchorOnly = nextConsultRoundsUsed({
      pending: pending(["shirt"], 1),
      brief: brief(["shirt"]),
      questions: [consultQ("preference_anchor")],
    });
    assert.equal(anchorOnly, 1);
    const second = nextConsultRoundsUsed({
      pending: pending(["shirt"], 1),
      brief: brief(["shirt"]),
      questions: [consultQ("preference_anchor"), consultQ("depth")],
    });
    assert.equal(second, 2);
    const reset = nextConsultRoundsUsed({
      pending: pending(["shirt"], 2),
      brief: brief(["jacket"]),
      questions: [consultQ("depth")],
    });
    assert.equal(reset, 1);
    assert.equal(
      questionsHaveConsult([{ gap: "size", kind: "blocking" }]),
      false,
    );
  });

  it("does not append You decide on preference_anchor", () => {
    const q = ensureYouDecideOption(consultQ("preference_anchor"));
    assert.equal(
      q.quick_options?.some((o) =>
        typeof o === "string"
          ? o === YOU_DECIDE_LABEL
          : o.label === YOU_DECIDE_LABEL,
      ),
      false,
    );
  });

  it("relabels The usual / Push me chips as preference_anchor", () => {
    const q = coerceMislabelledPreferenceAnchor({
      text: "Same navy Percival lane, or something new?",
      gap: "occasion",
      kind: "consult",
      quick_options: [
        { id: "the_usual", label: "The usual", preselected: true },
        { id: "push_me_a_little", label: "Push me a little" },
        { id: "something_new", label: "Something new" },
        { id: "you_decide", label: YOU_DECIDE_LABEL },
      ],
    });
    assert.equal(q.gap, "preference_anchor");
    assert.equal(
      q.quick_options?.some((o) =>
        typeof o === "string"
          ? o === YOU_DECIDE_LABEL
          : o.label === YOU_DECIDE_LABEL,
      ),
      false,
    );
  });

  it("injects the budget-spent note into the uncached context", () => {
    const block = buildFashionRouterContextBlock({
      roster: "#self",
      profiles: "## self",
      currentDate: "2026-08-24",
      consultation_budget_spent: true,
    });
    assert.match(block, new RegExp(CONSULTATION_BUDGET_SPENT_NOTE));
  });
});
