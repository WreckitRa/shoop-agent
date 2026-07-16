import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { buildFashionRouterPrompt } from "./prompt";
import { buildRouterContextFromData } from "./router-context-format";
import {
  FALLBACK_CLARIFICATION,
  messageHasTextWithoutTool,
  parseRouterMessage,
  resolveBriefRecipientPersonId,
  runFashionRouter,
} from "./llm-router";
import {
  askClarificationInputSchema,
  fashionSearchBriefSchema,
  parseFashionRouterToolInput,
  READY_TO_SEARCH_TOOL_NAME,
  RESPOND_OFF_TOPIC_TOOL_NAME,
} from "./tool-schema";
import { requestAttributesFromBrief } from "./request-event-from-brief";

describe("buildFashionRouterPrompt", () => {
  it("includes verbatim routing rules and interpolated context blocks", () => {
    const prompt = buildFashionRouterPrompt({
      roster: "#abcd self (Raphael)",
      profiles: "## #abcd self (Raphael)\nsizes: tops M",
      currentDate: "2026-07-08",
    });
    assert.match(prompt, /You are Shoop, a personal fashion shopper and stylist/);
    assert.match(prompt, /Exactly one tool call per turn/);
    assert.match(prompt, /do NOT ask "for yourself or someone else\?"/);
    assert.match(prompt, /three moves/);
    assert.match(prompt, /ACCESSORIES are garments too/);
    assert.match(prompt, /GENERAL PRINCIPLE/);
    assert.doesNotMatch(prompt, /run_intake/);
    assert.match(prompt, /#abcd self \(Raphael\)/);
    assert.match(prompt, /CURRENT DATE: 2026-07-08/);
    assert.doesNotMatch(prompt, /\{ROSTER\}/);
  });
});

describe("buildRouterContextFromData", () => {
  it("always includes self in roster and merges account onboarding into profiles", () => {
    const self = {
      id: "11111111-1111-1111-1111-111111111111",
      user_id: "u1",
      relation: "self" as const,
      name: null,
      birthday: null,
      notes: null,
      intake_completed_at: null,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    };
    const ctx = buildRouterContextFromData({
      people: [self],
      factsByPersonId: new Map([[self.id, []]]),
      signalsByPersonId: new Map([[self.id, []]]),
      conversationMessages: [
        { role: "user", content: "I've got my cousin's wedding in Cyprus next month" },
      ],
      stickyPersonIds: [],
      now: new Date("2026-07-08T12:00:00Z"),
      accountHints: {
        genderPresentation: "mens",
        preferredName: "Raphael",
        sizeLines: [],
      },
    });
    assert.match(ctx.roster, /self \(Raphael\)/);
    assert.match(ctx.profiles, /shop men's/);
    assert.equal(ctx.currentDate, "2026-07-08");
    assert.equal(ctx.conversationMessages.length, 1);
    assert.ok(Object.keys(ctx.personShortIds).length >= 1);
  });
});

describe("fashion router tool schema", () => {
  it("parses ready_to_search brief", () => {
    const parsed = parseFashionRouterToolInput(READY_TO_SEARCH_TOOL_NAME, {
      brief: {
        recipient_person_id: "abcd",
        request_type: "single_item",
        garments: ["shirt"],
        occasion_context: "work_consultant",
        quantity_hint: "one",
        must_haves: ["linen"],
        nice_to_haves: [],
        budget_context: { stated: false },
        style_direction: "Minimal office shirt in breathable linen.",
      },
    });
    assert.equal(parsed?.move, "ready_to_search");
  });

  it("validates clarification shape requires questions with gaps", () => {
    const parsed = askClarificationInputSchema.parse({
      reply: "What are you looking for?",
      questions: [
        {
          text: "What are you looking for?",
          gap: "garment",
          quick_options: ["Shirt", "Full outfit", "Shoes"],
        },
      ],
    });
    assert.equal(parsed.questions.length, 1);
    assert.equal(parsed.questions[0]?.gap, "garment");
    assert.throws(() =>
      askClarificationInputSchema.parse({
        reply: "What are you looking for?",
        missing: ["garment"],
        quick_options: ["Shirt"],
      }),
    );
  });
});

describe("requestAttributesFromBrief", () => {
  it("maps garments, occasion, and must-have color hints", () => {
    const brief = fashionSearchBriefSchema.parse({
      recipient_person_id: "abcd",
      request_type: "single_item",
      garments: ["shirt"],
      occasion_context: "work_consultant",
      quantity_hint: "one",
      must_haves: ["black", "linen"],
      nice_to_haves: [],
      budget_context: { stated: false },
      style_direction: "Black linen office shirt.",
    });
    const attrs = requestAttributesFromBrief(brief);
    assert.equal(attrs.garment, "shirt");
    assert.equal(attrs.occasion, "work_consultant");
    assert.equal(attrs.color, "black");
    assert.equal(attrs.material, "linen");
  });
});

describe("fashion router LLM integration guard", () => {
  it("detects text-only responses without a tool call", () => {
    const textOnly = {
      content: [{ type: "text", text: "Here is my answer" }],
    } as Message;
    assert.equal(messageHasTextWithoutTool(textOnly), true);
  });

  it("retries once on text-only then falls back to clarification", async () => {
    let calls = 0;
    const result = await runFashionRouter(
      {
        context: buildRouterContextFromData({
          people: [],
          factsByPersonId: new Map(),
          signalsByPersonId: new Map(),
          conversationMessages: [{ role: "user", content: "black shirt" }],
          stickyPersonIds: [],
        }),
      },
      {
        createMessage: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              stop_reason: "end_turn",
              content: [{ type: "text", text: "Sure, let me help." }],
            } as Message;
          }
          return {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Still no tool" }],
          } as Message;
        },
      },
    );

    assert.equal(calls, 2);
    assert.deepEqual(result, FALLBACK_CLARIFICATION);
  });

  it("parses a valid tool_use block", () => {
    const message = {
      content: [
        {
          type: "tool_use",
          name: RESPOND_OFF_TOPIC_TOOL_NAME,
          input: { reply: "That one's outside my wardrobe 😄" },
        },
      ],
    } as Message;
    const parsed = parseRouterMessage(message);
    assert.equal(parsed?.move, "respond_off_topic");
  });
});

describe("resolveBriefRecipientPersonId", () => {
  const self = {
    id: "self-uuid",
    user_id: "u1",
    relation: "self" as const,
    name: null,
    birthday: null,
    notes: null,
    intake_completed_at: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
  const mother = {
    ...self,
    id: "mother-uuid",
    relation: "mother" as const,
  };
  const shortIds = { abcd: self.id, efgh: mother.id };

  it("prefers mother when message says for my mother even if brief points at self", () => {
    const id = resolveBriefRecipientPersonId({
      brief: {
        recipient_person_id: "abcd",
        request_type: "single_item",
        garments: ["dress"],
        occasion_context: "formal",
        quantity_hint: "one",
        must_haves: [],
        nice_to_haves: [],
        budget_context: { stated: false },
        style_direction: "",
      },
      personShortIds: shortIds,
      people: [self, mother],
      userMessage:
        "colorful v neck long dress for formal outing for my mother",
    });
    assert.equal(id, mother.id);
  });

  it("keeps explicit non-self brief recipient", () => {
    const id = resolveBriefRecipientPersonId({
      brief: {
        recipient_person_id: "efgh",
        request_type: "single_item",
        garments: ["dress"],
        occasion_context: "formal",
        quantity_hint: "one",
        must_haves: [],
        nice_to_haves: [],
        budget_context: { stated: false },
        style_direction: "",
      },
      personShortIds: shortIds,
      people: [self, mother],
      userMessage: "dress for my mother",
    });
    assert.equal(id, mother.id);
  });
});
