import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFallbackPlan } from "../search-planner/fallback-plan";
import { expectedPaletteSourceFromBrief } from "../search-planner/palette-ladder";
import { buildSearchPlannerPrompt } from "../search-planner/prompt";
import type { FashionSearchBrief } from "../router/types";

const base = (): FashionSearchBrief => ({
  recipient_person_id: "abcd",
  request_type: "outfit",
  garments: ["shirt", "trousers", "shoes"],
  occasion_context: "office",
  quantity_hint: "3 looks",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "navy slim office",
  color_direction: { source: "profile" },
  knowledge_state: {
    department: "mens",
    sizes_confirmed: [],
    sizes_unconfirmed: [],
  },
});

describe("planner_depth_precedence", () => {
  it("prompt states depth precedence and preference-anchor ladder", () => {
    const prompt = buildSearchPlannerPrompt();
    assert.match(prompt, /OPTIONS_WANTED \(mandatory per slot\)/);
    assert.match(prompt, /brief\.depth\.source = "stated"/);
    assert.match(prompt, /PREFERENCE ANCHOR/);
  });

  it("stated looks_wanted 3 → anchor slot options_wanted 3", () => {
    const brief: FashionSearchBrief = {
      ...base(),
      depth: { looks_wanted: 3, source: "stated" },
    };
    const plan = buildFallbackPlan({ brief, currentDate: "2026-08-24" });
    const anchor = plan.slots.find((s) => s.role === "anchor");
    assert.equal(anchor?.options_wanted, 3);
    for (const slot of plan.slots.filter((s) => s.role === "support")) {
      assert.equal(slot.options_wanted, Math.max(2, Math.ceil(3 * 0.75)));
    }
  });

  it("you_decide looks_wanted 1 + one outfit → anchor 1, support ≤ 2", () => {
    const brief: FashionSearchBrief = {
      ...base(),
      quantity_hint: "one outfit",
      depth: { looks_wanted: 1, source: "you_decide" },
    };
    const plan = buildFallbackPlan({ brief, currentDate: "2026-08-24" });
    const anchor = plan.slots.find((s) => s.role === "anchor");
    assert.equal(anchor?.options_wanted, 1);
    for (const slot of plan.slots) {
      assert.ok(slot.options_wanted <= 2);
    }
  });

  it("explore skips the profile palette rung", () => {
    const brief: FashionSearchBrief = {
      ...base(),
      preference_anchor: "explore",
    };
    assert.equal(expectedPaletteSourceFromBrief(brief), "spread");
  });
});
