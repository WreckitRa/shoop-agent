import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANCHOR_KEEP_ASSUMPTION,
  decideAnchorGate,
  profileHasRelevantAnchorSignal,
} from "../router/anchor-gate";
import {
  nextConsultRoundsUsed,
  ensureYouDecideOption,
  YOU_DECIDE_LABEL,
} from "../router/consultation";
import { defaultQuickOptionsForGap } from "../router/clarification-defaults";
import { ROUTER_PROMPT_STATIC } from "../router/prompt";
import { formatRecentPicksLine, garmentFamiliesFromRequestEvents } from "../router/profile-context-format";
import {
  ASK_CLARIFICATION_TOOL_NAME,
  parseFashionRouterToolInput,
  READY_TO_SEARCH_TOOL_NAME,
} from "../router/tool-schema";
import type { FashionPendingBriefMetaV1, FashionSearchBrief } from "../router/types";
import type { RequestEventRow, StyleSignalRow } from "../types";

const shirtBrief: FashionSearchBrief = {
  recipient_person_id: "self",
  request_type: "single_item",
  garments: ["shirt"],
  occasion_context: "office",
  quantity_hint: "some shirts",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "office shirts",
  preference_anchor: "unspecified",
};

const shirtSignal: StyleSignalRow = {
  id: "sig-shirt",
  user_id: "u1",
  person_id: "self",
  context: "work",
  signal_type: "style",
  value: "navy oxford shirts, slim",
  polarity: 1,
  source: "stated",
  confidence: 0.9,
  evidence_count: 3,
  status: "active",
  source_quote: "I like navy oxfords",
  first_seen_at: "2026-08-01T00:00:00.000Z",
  last_seen_at: "2026-08-12T00:00:00.000Z",
};

describe("preference_anchor_always_asked", () => {
  it("prompt makes preference_anchor mandatory when a relevant signal exists", () => {
    assert.match(ROUTER_PROMPT_STATIC, /preference_anchor — MANDATORY/);
    assert.match(ROUTER_PROMPT_STATIC, /The usual/);
    assert.match(
      ROUTER_PROMPT_STATIC,
      /No "You decide" on this question/,
    );
  });

  it("known client + shirt signal → ask includes preference_anchor with The usual preselected", () => {
    const parsed = parseFashionRouterToolInput(ASK_CLARIFICATION_TOOL_NAME, {
      reply: "Going on: men's, M, slim — last time you took the navy Oxford.",
      known_summary: "Going on: men's, M, slim — last time you took the navy Oxford.",
      brief: shirtBrief,
      questions: [
        {
          text: "Last time you took the navy Oxford — same lane?",
          gap: "preference_anchor",
          kind: "consult",
          why: "navy Oxford last time",
          quick_options: [
            { id: "the_usual", label: "The usual", preselected: true },
            "Push me a little",
            "Something new",
          ],
        },
        {
          text: "How many?",
          gap: "depth",
          kind: "consult",
          quick_options: ["3", "5", "You decide"],
        },
      ],
    });
    assert.equal(parsed?.move, "ask_clarification");
    if (parsed?.move !== "ask_clarification") return;
    const anchor = parsed.questions.find((q) => q.gap === "preference_anchor");
    assert.ok(anchor);
    const first = anchor!.quick_options?.[0];
    assert.ok(typeof first === "object");
    if (typeof first === "object") {
      assert.equal(first.label, "The usual");
      assert.equal(first.preselected, true);
    }
    const withDecide = ensureYouDecideOption(anchor!);
    assert.equal(
      withDecide.quick_options?.some((o) =>
        typeof o === "string"
          ? o === YOU_DECIDE_LABEL
          : o.label === YOU_DECIDE_LABEL,
      ),
      false,
    );
  });

  it("defaults seed The usual preselected without You decide", () => {
    const opts = defaultQuickOptionsForGap("preference_anchor");
    assert.equal(typeof opts[0], "object");
    if (typeof opts[0] === "object") {
      assert.equal(opts[0].label, "The usual");
      assert.equal(opts[0].preselected, true);
    }
    assert.equal(
      opts.some((o) =>
        typeof o === "string"
          ? o === YOU_DECIDE_LABEL
          : o.label === YOU_DECIDE_LABEL,
      ),
      false,
    );
  });

  it("shopping_style quick → ask is blocking + preference_anchor only", () => {
    assert.match(
      ROUTER_PROMPT_STATIC,
      /EXCEPT preference_anchor/,
    );
    const parsed = parseFashionRouterToolInput(ASK_CLARIFICATION_TOOL_NAME, {
      reply: "One tap — the usual, or something new?",
      brief: shirtBrief,
      questions: [
        {
          text: "The usual, or something new?",
          gap: "preference_anchor",
          kind: "consult",
          quick_options: [
            { id: "the_usual", label: "The usual", preselected: true },
            "Push me a little",
            "Something new",
          ],
        },
      ],
    });
    assert.equal(parsed?.move, "ask_clarification");
    if (parsed?.move !== "ask_clarification") return;
    assert.equal(parsed.questions.length, 1);
    assert.equal(parsed.questions[0]?.gap, "preference_anchor");
  });

  it("swimwear brief + shirt-only signals → unspecified, gate does not fire", () => {
    assert.equal(
      profileHasRelevantAnchorSignal({
        garments: ["swimwear"],
        signals: [shirtSignal],
      }),
      false,
    );
    const decision = decideAnchorGate({
      brief: {
        ...shirtBrief,
        garments: ["swimwear"],
        preference_anchor: "unspecified",
      },
      signals: [shirtSignal],
    });
    assert.equal(decision.action, "pass");
  });

  it("ready_to_search with unspecified on known client → ask then force unspecified+assumption", () => {
    assert.equal(
      profileHasRelevantAnchorSignal({
        garments: ["shirt"],
        signals: [shirtSignal],
      }),
      true,
    );
    const first = decideAnchorGate({
      brief: shirtBrief,
      signals: [shirtSignal],
      alreadyRetried: false,
    });
    assert.equal(first.action, "ask");
    const second = decideAnchorGate({
      brief: shirtBrief,
      signals: [shirtSignal],
      alreadyRetried: true,
    });
    assert.equal(second.action, "force_keep");
    if (second.action !== "force_keep") return;
    assert.equal(second.brief.preference_anchor, "unspecified");
    assert.ok(second.brief.assumptions?.includes(ANCHOR_KEEP_ASSUMPTION));
  });

  it("LLM inventing keep without asking still forces ask on known client", () => {
    const decision = decideAnchorGate({
      brief: { ...shirtBrief, preference_anchor: "keep" },
      signals: [shirtSignal],
      preferenceAnchorAsked: false,
    });
    assert.equal(decision.action, "ask");
  });

  it("after preference_anchor was asked, keep passes", () => {
    const decision = decideAnchorGate({
      brief: { ...shirtBrief, preference_anchor: "keep" },
      signals: [shirtSignal],
      preferenceAnchorAsked: true,
    });
    assert.equal(decision.action, "pass");
  });

  it("same but blue after results → no anchor question", () => {
    const decision = decideAnchorGate({
      brief: shirtBrief,
      signals: [shirtSignal],
      lastUserMessage: "same but blue",
      lastAssistantWasCuration: true,
      lastBriefGarments: ["shirt"],
    });
    assert.equal(decision.action, "pass");
  });

  it("anchor-only consult turn leaves consult_rounds_used unchanged", () => {
    const pending: FashionPendingBriefMetaV1 = {
      version: 1,
      brief: shirtBrief,
      recipientPersonId: "self",
      savedAt: "2026-08-25T00:00:00.000Z",
      consult_rounds_used: 1,
    };
    const used = nextConsultRoundsUsed({
      pending,
      brief: shirtBrief,
      questions: [
        {
          text: "The usual?",
          gap: "preference_anchor",
          kind: "consult",
          quick_options: ["The usual"],
        },
      ],
    });
    assert.equal(used, 1);
  });

  it("formats recent_picks from request events", () => {
    const events: RequestEventRow[] = [
      {
        id: "e1",
        user_id: "u1",
        person_id: "self",
        conversation_id: null,
        attributes: {
          garment: "shirt",
          color: "navy",
          brand: "Charles Tyrwhitt",
        },
        created_at: "2026-08-12T10:00:00.000Z",
      },
      {
        id: "e2",
        user_id: "u1",
        person_id: "self",
        conversation_id: null,
        attributes: { garment: "shoes", brand: "Dean Oxfords" },
        created_at: "2026-08-12T10:00:00.000Z",
      },
    ];
    const line = formatRecentPicksLine(events);
    assert.match(line ?? "", /recent_picks:/);
    assert.match(line ?? "", /shirt →/);
    assert.match(line ?? "", /shoe/);
    const families = garmentFamiliesFromRequestEvents(events);
    assert.equal(families.has("shirt"), true);
    assert.equal(families.has("shoe"), true);
  });

  it("prefers purchase events and uses the bought phrasing", () => {
    const events: RequestEventRow[] = [
      {
        id: "click",
        user_id: "u1",
        person_id: "self",
        conversation_id: null,
        attributes: {
          garment: "shirt",
          color: "white",
          brand: "unqlo",
        },
        created_at: "2026-08-28T10:00:00.000Z",
      },
      {
        id: "buy",
        user_id: "u1",
        person_id: "self",
        conversation_id: null,
        attributes: {
          kind: "purchase",
          garment: "shirt",
          color: "white",
          brand: "unqlo",
        },
        created_at: "2026-08-28T11:00:00.000Z",
      },
    ];
    const line = formatRecentPicksLine(events);
    assert.match(line ?? "", /bought/);
    assert.doesNotMatch(line ?? "", /shirt →/);
  });

  it("words this turn fill the anchor without asking", () => {
    const search = parseFashionRouterToolInput(READY_TO_SEARCH_TOOL_NAME, {
      brief: {
        ...shirtBrief,
        preference_anchor: "keep",
        depth: { options_per_item: 3, source: "assumed" },
      },
    });
    assert.equal(search?.move, "ready_to_search");
    if (search?.move !== "ready_to_search") return;
    assert.equal(search.brief.preference_anchor, "keep");
  });
});
