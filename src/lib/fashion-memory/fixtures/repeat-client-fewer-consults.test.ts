import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPersonSnapshot } from "../extraction/context-format";
import { ROUTER_PROMPT_STATIC } from "../router/prompt";
import {
  ASK_CLARIFICATION_TOOL_NAME,
  parseFashionRouterToolInput,
  READY_TO_SEARCH_TOOL_NAME,
} from "../router/tool-schema";
import type { PersonRow, StyleSignalRow } from "../types";

const person: PersonRow = {
  id: "p-self",
  user_id: "u1",
  relation: "self",
  name: "Alex",
  birthday: null,
  notes: null,
  intake_completed_at: "2026-08-01T00:00:00.000Z",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

const quickSignal: StyleSignalRow = {
  id: "sig-1",
  user_id: "u1",
  person_id: "p-self",
  context: "global",
  signal_type: "shopping_style",
  value: "quick",
  polarity: 1,
  source: "inferred",
  confidence: 0.8,
  evidence_count: 2,
  status: "active",
  source_quote: "Just show me",
  first_seen_at: "2026-08-20T00:00:00.000Z",
  last_seen_at: "2026-08-24T00:00:00.000Z",
};

const appointmentBrief = {
  recipient_person_id: "self",
  request_type: "single_item" as const,
  garments: ["shirt"],
  occasion_context: "office",
  quantity_hint: "a few",
  must_haves: [] as string[],
  nice_to_haves: [] as string[],
  budget_context: { stated: false },
  style_direction: "navy shirts",
};

describe("repeat_client_fewer_consults", () => {
  it("prompt skips consult once shopping_style:quick is on the profile", () => {
    assert.match(ROUTER_PROMPT_STATIC, /shopping_style:quick/);
    assert.match(ROUTER_PROMPT_STATIC, /skip consultative questions/);
  });

  it("snapshot surfaces shopping_style:quick for the second appointment", () => {
    const snap = formatPersonSnapshot({
      person,
      facts: [],
      signals: [quickSignal],
      shortIds: { "p-self": "s1" },
    });
    assert.match(snap, /shopping_style:quick/);
  });

  it("first appointment still consults; second appointment searches without consult questions", () => {
    const first = parseFashionRouterToolInput(ASK_CLARIFICATION_TOOL_NAME, {
      reply: "Two quick calls so I pull the right rack:",
      known_summary: "Going on: men's, M, navy shirts, office.",
      escape_chip: "Just show me",
      questions: [
        {
          text: "How many do you want to see?",
          gap: "depth",
          kind: "consult",
          why: "changes how many I pull",
          quick_options: ["3", "5", "You decide"],
        },
        {
          text: "Stay navy, or shake it up?",
          gap: "preference_anchor",
          kind: "consult",
          why: "so I don't play it too safe",
          quick_options: ["Keep it me", "Push me a little", "You decide"],
        },
      ],
      brief: appointmentBrief,
    });
    assert.equal(first?.move, "ask_clarification");
    if (first?.move !== "ask_clarification") return;
    const firstConsults = first.questions.filter((q) => q.kind === "consult");
    assert.equal(firstConsults.length, 2);

    const second = parseFashionRouterToolInput(READY_TO_SEARCH_TOOL_NAME, {
      brief: {
        ...appointmentBrief,
        depth: { options_per_item: 4, source: "assumed" },
        assumptions: ["Went with 4 options", "Stayed navy", "Assumed office"],
      },
    });
    assert.equal(second?.move, "ready_to_search");
    if (second?.move !== "ready_to_search") return;
    assert.ok((second.brief.assumptions?.length ?? 0) >= 1);
    assert.ok(firstConsults.length > 0);
  });
});
