import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROUTER_PROMPT_STATIC } from "../router/prompt";
import {
  ASK_CLARIFICATION_TOOL_NAME,
  parseFashionRouterToolInput,
  RESPOND_OFF_TOPIC_TOOL_NAME,
} from "../router/tool-schema";

describe("greeting_first_contact", () => {
  it("greetings are MOVE 2 first contact, never off-topic", () => {
    assert.match(ROUTER_PROMPT_STATIC, /FIRST CONTACT \/ GREETING/);
    assert.match(ROUTER_PROMPT_STATIC, /is NOT\s+respond_off_topic/);
  });

  it("hey parses as ask_clarification with a garment gap", () => {
    const parsed = parseFashionRouterToolInput(ASK_CLARIFICATION_TOOL_NAME, {
      reply: "Welcome back, Raphael. Where are we going today?",
      questions: [
        {
          text: "Picking up the office refresh, something for the weekend, or a gift?",
          gap: "garment",
          kind: "blocking",
          quick_options: [
            "More for the wedding",
            "Something for the weekend",
            "A gift",
            "Something else",
          ],
        },
      ],
    });
    assert.equal(parsed?.move, "ask_clarification");
    if (parsed?.move !== "ask_clarification") return;
    assert.equal(parsed.questions[0]?.gap, "garment");
    const off = parseFashionRouterToolInput(RESPOND_OFF_TOPIC_TOOL_NAME, {
      reply: "joke",
    });
    assert.equal(off?.move, "respond_off_topic");
  });
});
