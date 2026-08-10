import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkBriefInvariants } from "./invariants";
import type { FashionSearchBrief } from "../router/types";

const baseBrief = (request_type: FashionSearchBrief["request_type"]): FashionSearchBrief => ({
  recipient_person_id: "self",
  request_type,
  garments: ["athleisure"],
  occasion_context: "general",
  quantity_hint: "a few",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "wfh",
});

describe("checkBriefInvariants", () => {
  it("does not trip on outfit wording — intent is the router LLM's job", () => {
    const tripped = checkBriefInvariants({
      messages: [{ role: "user", content: "full outfit for the office" }],
      brief: baseBrief("multi_item"),
    });
    assert.ok(!tripped.includes("outfit_language_multi_item_brief" as never));
  });

  it("still trips on accessories coerced into clothing", () => {
    const tripped = checkBriefInvariants({
      messages: [
        { role: "user", content: "stylish accessories for Gabriel for work" },
      ],
      brief: {
        ...baseBrief("multi_item"),
        garments: ["shirt", "trousers"],
      },
    });
    assert.ok(tripped.includes("accessories_coerced"));
  });
});
