import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextConsultRoundsUsed,
} from "../router/consultation";
import { ROUTER_PROMPT_STATIC } from "../router/prompt";
import {
  ASK_CLARIFICATION_TOOL_NAME,
  READY_TO_SEARCH_TOOL_NAME,
  parseFashionRouterToolInput,
} from "../router/tool-schema";
import type {
  FashionClarificationQuestion,
  FashionPendingBriefMetaV1,
  FashionSearchBrief,
} from "../router/types";

const brief: FashionSearchBrief = {
  recipient_person_id: "self",
  request_type: "outfit",
  garments: ["shirt", "trousers", "blazer", "shoes"],
  occasion_context: "baptism",
  quantity_hint: "one look",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "Dressy baptism look with a blazer.",
};

const blockingOnly: FashionClarificationQuestion[] = [
  {
    text: "What sizes should I pull?",
    gap: "size",
    kind: "blocking",
    garment_type: "tops",
    quick_options: ["M", "L"],
  },
  {
    text: "Bottoms?",
    gap: "size",
    kind: "blocking",
    garment_type: "bottoms",
    quick_options: ["32", "34"],
  },
];

describe("baptism_pull_sheet_after_blocking", () => {
  it("prompt: blocking rounds never consume the consultative budget", () => {
    assert.match(
      ROUTER_PROMPT_STATIC,
      /Blocking rounds never consume the consultative budget/,
    );
    assert.match(ROUTER_PROMPT_STATIC, /still owe the client the pull sheet/);
    assert.match(
      ROUTER_PROMPT_STATIC,
      /Assuming depth on a client who has already answered three questions is\s+forbidden/,
    );
  });

  it("blocking-only turn does not spend consult rounds", () => {
    const pending: FashionPendingBriefMetaV1 = {
      version: 1,
      brief,
      recipientPersonId: "self",
      savedAt: "2026-08-25T00:00:00.000Z",
      consult_rounds_used: 0,
    };
    const used = nextConsultRoundsUsed({
      pending,
      brief,
      questions: blockingOnly,
    });
    assert.equal(used, 0);
  });

  it("next move after essentials is pull sheet or stated-depth search", () => {
    const pullSheet = parseFashionRouterToolInput(ASK_CLARIFICATION_TOOL_NAME, {
      reply: "Almost there — what should I pull, and how many looks?",
      brief,
      questions: [
        {
          text: "What should I pull?",
          gap: "slots",
          kind: "consult",
          allow_multiple: true,
          display: "checklist",
          quick_options: [
            { id: "shirt", label: "Shirt", preselected: true },
            { id: "trousers", label: "Trousers", preselected: true },
            { id: "blazer", label: "Blazer", preselected: true },
            { id: "shoes", label: "Shoes", preselected: true },
          ],
        },
        {
          text: "How many looks?",
          gap: "depth",
          kind: "consult",
          quick_options: ["1 look", "3 looks", "You decide"],
        },
      ],
    });
    assert.equal(pullSheet?.move, "ask_clarification");
    if (pullSheet?.move === "ask_clarification") {
      const gaps = pullSheet.questions.map((q) => q.gap);
      assert.ok(gaps.includes("slots"));
      assert.ok(gaps.includes("depth"));
    }

    const search = parseFashionRouterToolInput(READY_TO_SEARCH_TOOL_NAME, {
      brief: {
        ...brief,
        depth: { looks_wanted: 1, source: "stated" },
      },
    });
    assert.equal(search?.move, "ready_to_search");
    if (search?.move === "ready_to_search") {
      assert.equal(search.brief.depth?.source, "stated");
    }
  });
});
