import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROUTER_PROMPT_STATIC } from "../router/prompt";
import {
  ASK_CLARIFICATION_TOOL_NAME,
  parseFashionRouterToolInput,
} from "../router/tool-schema";

describe("baptism_color_consult", () => {
  it("prompt requires color on dress-code outfits for new clients", () => {
    assert.match(ROUTER_PROMPT_STATIC, /occasion with dress codes/);
    assert.match(ROUTER_PROMPT_STATIC, /baptism/);
    assert.ok(ROUTER_PROMPT_STATIC.includes('display:"visual"'));
    assert.match(
      ROUTER_PROMPT_STATIC,
      /Put it on the pull sheet with\s+slots and depth/,
    );
  });

  it("new client outfit baptism ask includes gap color", () => {
    const parsed = parseFashionRouterToolInput(ASK_CLARIFICATION_TOOL_NAME, {
      reply: "Pull sheet for the baptism — colors matter here.",
      brief: {
        recipient_person_id: "self",
        request_type: "outfit",
        garments: ["shirt", "trousers", "shoes"],
        occasion_context: "baptism",
        quantity_hint: "one look",
        must_haves: [],
        nice_to_haves: [],
        budget_context: { stated: false },
        style_direction: "Dressy baptism outfit",
      },
      questions: [
        {
          text: "What should I pull?",
          gap: "slots",
          kind: "consult",
          quick_options: ["Shirt", "Trousers", "Shoes"],
        },
        {
          text: "How many looks?",
          gap: "depth",
          kind: "consult",
          quick_options: ["1 look", "3 looks", "You decide"],
        },
        {
          text: "Color lane?",
          gap: "color",
          kind: "consult",
          display: "visual",
          quick_options: [
            "Navy family",
            "Charcoal family",
            "Soft neutrals",
            "Surprise me",
          ],
        },
      ],
    });
    assert.equal(parsed?.move, "ask_clarification");
    if (parsed?.move !== "ask_clarification") return;
    assert.ok(parsed.questions.some((q) => q.gap === "color"));
  });
});
