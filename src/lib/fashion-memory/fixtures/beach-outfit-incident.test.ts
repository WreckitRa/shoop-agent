/**
 * Beach-outfit clarification path — LLM must own outfit intent; size answers
 * must not collapse a parked beach outfit into a shirt search.
 *
 * Trace: cmsnrzcr60002xf0fjgr1gem0
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resumePendingShoppingBrief } from "../intake/pending-brief";
import { ROUTER_PROMPT_STATIC } from "../router/prompt";
import {
  ASK_CLARIFICATION_TOOL_NAME,
  parseFashionRouterToolInput,
} from "../router/tool-schema";
import type { FashionSearchBrief } from "../router/types";

function beachOutfitBrief(
  overrides: Partial<FashionSearchBrief> = {},
): FashionSearchBrief {
  return {
    recipient_person_id: "self",
    request_type: "outfit",
    garments: ["top", "bottom", "shoes"],
    occasion_context: "beach",
    quantity_hint: "one outfit",
    must_haves: [],
    nice_to_haves: [],
    budget_context: { stated: false },
    style_direction:
      "Beach outfit for a couples outing — relaxed, flattering, ready for sun.",
    ...overrides,
  };
}

describe("beach_outfit_router_intent", () => {
  it("router prompt requires LLM outfit judgment for beach/going-out asks", () => {
    assert.match(ROUTER_PROMPT_STATIC, /interpret INTENT/i);
    assert.match(ROUTER_PROMPT_STATIC, /beach outfit with my husband/i);
    assert.match(ROUTER_PROMPT_STATIC, /ALWAYS include `brief` on ask_clarification/i);
    assert.match(
      ROUTER_PROMPT_STATIC,
      /keep the ORIGINAL shopping brief/i,
    );
    assert.doesNotMatch(
      ROUTER_PROMPT_STATIC,
      /map(?:ping)? by (?:exact )?word/i,
    );
  });

  it("ask_clarification accepts a provisional shopping brief", () => {
    const parsed = parseFashionRouterToolInput(ASK_CLARIFICATION_TOOL_NAME, {
      reply: "Quick sizing so everything I pull actually fits.",
      questions: [
        {
          text: "What size in tops?",
          gap: "size",
          garment_type: "tops",
          quick_options: ["S", "M", "L"],
        },
      ],
      brief: beachOutfitBrief(),
    });
    assert.equal(parsed?.move, "ask_clarification");
    if (parsed?.move !== "ask_clarification") return;
    assert.equal(parsed.brief?.request_type, "outfit");
    assert.equal(parsed.brief?.occasion_context, "beach");
    assert.deepEqual(parsed.brief?.garments, ["top", "bottom", "shoes"]);
  });

  it("size-chip ready_to_search keeps parked beach outfit, not shirts", () => {
    const pending = beachOutfitBrief();
    const fromSizeChip: FashionSearchBrief = {
      recipient_person_id: "self",
      request_type: "single_item",
      garments: ["shirt"],
      occasion_context: "general",
      quantity_hint: "one",
      must_haves: [],
      nice_to_haves: [],
      budget_context: { stated: false },
      style_direction: "What size does Passola usually wear in tops? M",
      department_scope: "womens",
      stated_facts: {
        person_ref: "self",
        sizes: { tops: "M" },
      },
    };

    const resumed = resumePendingShoppingBrief(pending, fromSizeChip);
    assert.equal(resumed.request_type, "outfit");
    assert.equal(resumed.occasion_context, "beach");
    assert.deepEqual(resumed.garments, ["top", "bottom", "shoes"]);
    assert.match(resumed.style_direction, /beach/i);
    assert.equal(resumed.stated_facts?.sizes?.tops, "M");
    assert.equal(resumed.department_scope, "womens");
  });
});
