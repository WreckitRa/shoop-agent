import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROUTER_PROMPT_STATIC } from "../router/prompt";
import {
  parseFashionRouterToolInput,
  READY_TO_SEARCH_TOOL_NAME,
} from "../router/tool-schema";

const baseBrief = {
  recipient_person_id: "self",
  request_type: "single_item" as const,
  garments: ["shirt"],
  occasion_context: "office",
  quantity_hint: "a few",
  must_haves: [] as string[],
  nice_to_haves: [] as string[],
  budget_context: { stated: false },
  style_direction: "navy and white shirts",
  depth: { options_per_item: 4, source: "assumed" as const },
  preference_anchor: "unspecified" as const,
};

describe("consult_speed_signal", () => {
  it("prompt treats speed as intent across languages", () => {
    assert.match(ROUTER_PROMPT_STATIC, /SPEED SIGNALS/);
    assert.match(ROUTER_PROMPT_STATIC, /Interpret intent/);
  });

  for (const assumptions of [
    [
      "Went with 4 options",
      "Stayed in your usual navy/white lane",
      "Assumed office",
    ],
    ["J'ai pris 4 options", "Resté sur navy/blanc", "Bureau, je suppose"],
    ["اخترت 4 خيارات", "بقيت على الكحلي والأبيض", "افترضت المكتب"],
  ]) {
    it(`ready_to_search carries assumptions (${assumptions[0]})`, () => {
      const parsed = parseFashionRouterToolInput(READY_TO_SEARCH_TOOL_NAME, {
        brief: { ...baseBrief, assumptions },
      });
      assert.equal(parsed?.move, "ready_to_search");
      if (parsed?.move !== "ready_to_search") return;
      assert.ok((parsed.brief.assumptions?.length ?? 0) >= 1);
    });
  }
});
