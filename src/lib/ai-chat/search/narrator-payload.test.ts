import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEngineToolResultPayload,
  validateNarratorProductMentions,
  type EngineSearchResult,
} from "./engine";
import { blazerTraceBrief } from "./fixtures/blazer-trace-fixture";
import type { CuratedPick } from "../types";

function engineResult(picks: CuratedPick[], ruledOut?: EngineSearchResult["ruledOut"]): EngineSearchResult {
  return {
    brief: blazerTraceBrief,
    products: picks,
    curatedPicks: picks,
    rawCount: 131,
    surfacedUpids: picks.map((p) => p.upid ?? p.id),
    stats: [],
    thin: false,
    loosened: false,
    portfolio: [],
    slottingMethod: "tier_judge",
    curationFallback: false,
    ruledOut,
    allowedProductIds: picks.map((p) => p.id),
  };
}

describe("narrator payload — tier placements only (P0 #12)", () => {
  const pick: CuratedPick = {
    id: "gid://shopify/Product/valid-black",
    title: "Men's Black Wool Blend Tailored Blazer",
    slot: "shoop_pick",
    reason: "Black wool blend with tailored structure for office wear.",
    verdict: "buy",
    insight: {
      retailerCheckNote: "test",
      fitReasons: ["a", "b", "c"],
      checkedItems: ["x"],
      pickStory: "story",
      changeMindItems: ["y", "z"],
    },
    tier: 1,
  };

  it("payload includes verdict-first narration contract and kill stats", () => {
    const payload = JSON.parse(buildEngineToolResultPayload(engineResult([pick])));
    assert.ok(payload.narration_contract);
    assert.match(payload.narration_contract, /CLIENT READ/i);
    assert.match(payload.narration_contract, /GOLD EXEMPLARS/i);
    assert.equal(payload.curation_stats.pooled, 131);
    assert.ok(payload.expertise_principles?.length);
    assert.equal(payload.hero_product_id, pick.id);
    assert.equal(payload.placements[0].is_hero, true);
  });

  it("payload includes allowed_product_ids and placements", () => {
    const payload = JSON.parse(buildEngineToolResultPayload(engineResult([pick])));
    assert.deepEqual(payload.allowed_product_ids, [pick.id]);
    assert.equal(payload.placements.length, 1);
    assert.equal(payload.placements[0].product_id, pick.id);
    assert.equal(payload.placements[0].tier, 1);
    assert.equal(payload.curation_stats.pooled, 131);
  });

  it("ruled_out comes from gate drops for kill-count narration", () => {
    const ruled = [
      {
        productId: "gid://shopify/Product/verity-womens",
        title: "VERITY Tailored Blazer — Women's",
        reason: "scoped to men's but product signals women's",
        gate: "gender" as const,
      },
    ];
    const payload = JSON.parse(buildEngineToolResultPayload(engineResult([pick], ruled)));
    assert.equal(payload.ruled_out.length, 1);
    assert.equal(payload.ruled_out[0].product_id, ruled[0].productId);
    assert.ok(payload.rejection_summary?.length);
  });

  it("validateNarratorProductMentions rejects ids outside rack", () => {
    const check = validateNarratorProductMentions(
      "Try gid://shopify/Product/verity-womens for a slimmer fit.",
      [pick.id],
    );
    assert.equal(check.ok, false);
    assert.ok(check.violations.includes("gid://shopify/Product/verity-womens"));
  });
});
