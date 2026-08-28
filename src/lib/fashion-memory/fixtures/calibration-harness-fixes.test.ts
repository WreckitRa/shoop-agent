import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseClarificationAnswersFromMessage } from "../intake/apply-intake-reply";
import {
  findConsistencyMismatches,
  hardSetBriefFromChips,
  chipsFromClarificationTurn,
} from "../intake/consistency-gate";
import { missingSizeBucketsForGarments } from "../intake/identity-gate";
import {
  clampStatedSizesToNamedFamilies,
  sizeFamiliesNamedInText,
} from "../intake/usable-stated-size";
import type { FashionSearchBrief } from "../router/types";
import { ROUTER_PROMPT_STATIC } from "../router/prompt";

describe("multi-part Done answers become stated facts", () => {
  it("five questions, one Done line → every gap parsed; no empty gaps", () => {
    const questions = [
      { text: "What's the vibe?", gap: "style_lane" as const },
      { text: "What kind of date?", gap: "occasion" as const },
      { text: "Any budget?", gap: "budget" as const },
      {
        text: "Tops size?",
        gap: "size" as const,
        field: "size_tops",
        garment_type: "tops",
      },
      {
        text: "Shoe size?",
        gap: "size" as const,
        field: "size_shoes",
        garment_type: "shoes",
      },
    ];
    const done =
      "style_lane: Chic & sleek | occasion: Dinner out | budget: No cap | size_tops: M | size_shoes: 9";
    const parsed = parseClarificationAnswersFromMessage(done, questions);
    assert.equal(parsed.style_lane, "Chic & sleek");
    assert.equal(parsed.occasion, "Dinner out");
    assert.equal(parsed.budget, "No cap");
    assert.equal(parsed.size_tops, "M");
    assert.equal(parsed.size_shoes, "9");
  });
});

describe("cal-08 preference_anchor consistency", () => {
  it("confirmed push chip ≠ unspecified brief → hard-set push; drop keep assumption", () => {
    const brief = {
      preference_anchor: "unspecified",
      garments: ["Top", "Trousers"],
      request_type: "outfit",
      must_haves: [],
      nice_to_haves: [],
      budget_context: { stated: false },
      assumptions: [
        "Kept it in your usual lane — say the word for something new.",
      ],
    } as FashionSearchBrief;
    const chips = chipsFromClarificationTurn({
      questions: [
        {
          text: "Same navy lane?",
          gap: "preference_anchor",
          quick_options: ["The usual", "Push me a little", "Something new"],
        },
        { text: "How many looks?", gap: "depth" },
      ],
      userMessage: "Push me a little, and 2 looks please.",
      answers: {},
    });
    assert.equal(chips.preferenceAnchor, "push");
    assert.equal(chips.depthLooks, 2);
    const mismatches = findConsistencyMismatches({ brief, chips });
    assert.ok(mismatches.some((m) => m.gap === "preference_anchor"));
    const fixed = hardSetBriefFromChips(brief, chips, [
      "preference_anchor",
      "depth",
    ]);
    assert.equal(fixed.preference_anchor, "push");
    assert.equal(fixed.depth?.looks_wanted, 2);
    assert.ok(
      !(fixed.assumptions ?? []).some((a) => /usual lane/i.test(a)),
    );
  });
});

describe("cal-02 womens outfit includes dresses size family", () => {
  it("womens outfit with top/bottom/shoes still asks dresses", () => {
    const missing = missingSizeBucketsForGarments(
      [],
      ["top", "trousers", "shoes"],
      null,
      "womens",
      null,
      "outfit",
    );
    assert.ok(missing.includes("dresses"));
    assert.ok(missing.includes("tops"));
    assert.ok(missing.includes("shoes"));
  });

  it("mens outfit never asks dresses", () => {
    const missing = missingSizeBucketsForGarments(
      [],
      ["top", "bottom", "shoes"],
      null,
      "mens",
      null,
      "outfit",
    );
    assert.ok(!missing.includes("dresses"));
  });
});

describe("stated sizes only for named families", () => {
  it("clamps profile-copied shoes when client only named tops+bottoms", () => {
    const sizes = clampStatedSizesToNamedFamilies({
      sizes: { tops: "L", bottoms: "34", shoes: "10" },
      conversationTexts: ["slots: Top, Trousers, Blazer"],
    });
    assert.equal(sizes?.tops, "L");
    assert.equal(sizes?.bottoms, "34");
    assert.equal(sizes?.shoes, undefined);
  });

  it("jeans opening names bottoms", () => {
    assert.ok(sizeFamiliesNamedInText("looking for jeans, size L").has("bottoms"));
    assert.ok(sizeFamiliesNamedInText("sweater size S").has("tops"));
  });
});

describe("pull sheet one-card prompt rule", () => {
  it("prompt forbids slots after depth/anchor", () => {
    assert.match(
      ROUTER_PROMPT_STATIC,
      /Never ask slots on a later turn after depth or\s+preference_anchor/i,
    );
    assert.match(
      ROUTER_PROMPT_STATIC,
      /multi-part reply answers the open questions in order/i,
    );
    assert.match(
      ROUTER_PROMPT_STATIC,
      /stated_facts\.sizes only for families the client NAMED/i,
    );
  });
});
