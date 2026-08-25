import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseFashionRouterToolInput,
  READY_TO_SEARCH_TOOL_NAME,
} from "../router/tool-schema";

describe("complete_brief_no_consult", () => {
  it("a fully stated first message is ready_to_search with stated depth", () => {
    const parsed = parseFashionRouterToolInput(READY_TO_SEARCH_TOOL_NAME, {
      brief: {
        recipient_person_id: "new",
        request_type: "outfit",
        garments: ["shirt", "trousers", "shoes"],
        occasion_context: "business event",
        quantity_hint: "3 looks",
        must_haves: [],
        nice_to_haves: [],
        budget_context: { stated: true, max: 100, currency: "USD" },
        style_direction: "Full formal outfit for Joe under $100.",
        stated_facts: {
          person_ref: "new",
          new_person: { name: "Joe" },
          department: "mens",
          sizes: { tops: "M", bottoms: "33", shoes: "10" },
        },
        depth: { looks_wanted: 3, source: "stated" },
        assumptions: [],
      },
    });
    assert.equal(parsed?.move, "ready_to_search");
    if (parsed?.move !== "ready_to_search") return;
    assert.equal(parsed.brief.depth?.looks_wanted, 3);
    assert.equal(parsed.brief.depth?.source, "stated");
  });
});
