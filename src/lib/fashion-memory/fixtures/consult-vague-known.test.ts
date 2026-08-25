import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { YOU_DECIDE_LABEL, ensureYouDecideOption } from "../router/consultation";
import {
  ASK_CLARIFICATION_TOOL_NAME,
  parseFashionRouterToolInput,
} from "../router/tool-schema";

describe("consult_vague_known", () => {
  it("ask_clarification shape: known_summary, ≤3 consult questions, You decide, escape_chip", () => {
    const parsed = parseFashionRouterToolInput(ASK_CLARIFICATION_TOOL_NAME, {
      reply: "Easy. Two quick calls so I pull the right rack:",
      known_summary:
        "Going on: men's, M, slim, the navy-and-white you usually pick, for the office.",
      escape_chip: "Just show me",
      questions: [
        {
          text: "How many do you want to see?",
          gap: "depth",
          kind: "consult",
          why: "changes how many I pull",
          quick_options: ["3", "5", "8"],
        },
        {
          text: "Stay navy-and-slim, or shake it up?",
          gap: "preference_anchor",
          kind: "consult",
          why: "so I don't play it too safe",
          quick_options: ["Keep it me", "Push me a little", "Something new"],
        },
      ],
      brief: {
        recipient_person_id: "self",
        request_type: "single_item",
        garments: ["shirt"],
        occasion_context: "office",
        quantity_hint: "some",
        must_haves: [],
        nice_to_haves: [],
        budget_context: { stated: false },
        style_direction: "navy slim shirts",
      },
    });
    assert.equal(parsed?.move, "ask_clarification");
    if (parsed?.move !== "ask_clarification") return;
    assert.ok(parsed.known_summary);
    assert.ok(parsed.escape_chip);
    assert.ok(parsed.questions.length <= 3);
    for (const q of parsed.questions) {
      const withDecide = ensureYouDecideOption(q);
      assert.ok(
        withDecide.quick_options?.some((o) =>
          typeof o === "string"
            ? o === YOU_DECIDE_LABEL
            : o.label === YOU_DECIDE_LABEL,
        ),
      );
    }
  });
});
