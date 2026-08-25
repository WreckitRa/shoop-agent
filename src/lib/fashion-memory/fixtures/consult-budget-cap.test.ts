import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONSULTATION_BUDGET_SPENT_NOTE,
  nextConsultRoundsUsed,
} from "../router/consultation";
import { buildFashionRouterContextBlock } from "../router/prompt";
import type {
  FashionClarificationQuestion,
  FashionPendingBriefMetaV1,
  FashionSearchBrief,
} from "../router/types";

const brief: FashionSearchBrief = {
  recipient_person_id: "self",
  request_type: "single_item",
  garments: ["bag"],
  occasion_context: "gift",
  quantity_hint: "one",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "a nice bag",
};

const consult: FashionClarificationQuestion = {
  text: "Price band?",
  gap: "budget",
  kind: "consult",
  quick_options: ["You decide"],
};

describe("consult_budget_cap", () => {
  it("third consult turn is blocked by the spent note", () => {
    const afterTwo: FashionPendingBriefMetaV1 = {
      version: 1,
      brief,
      recipientPersonId: "self",
      savedAt: "2026-08-24T00:00:00.000Z",
      consult_rounds_used: 2,
    };
    const used = nextConsultRoundsUsed({
      pending: afterTwo,
      brief,
      questions: [consult],
    });
    assert.equal(used, 2);
    const ctx = buildFashionRouterContextBlock({
      roster: "#self",
      profiles: "## self",
      currentDate: "2026-08-24",
      consultation_budget_spent: used >= 2,
    });
    assert.match(ctx, new RegExp(CONSULTATION_BUDGET_SPENT_NOTE));
  });
});
