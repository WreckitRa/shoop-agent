import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildKillStats,
  buildNarratorInstructions,
  NARRATOR_GOLD_EXEMPLARS,
  NARRATOR_VERDICT_FIRST_CONTRACT,
  runnerUpPlacement,
} from "./narrator-contract";
import { blazerTraceBrief } from "./fixtures/blazer-trace-fixture";
import type { CuratedPick } from "../types";

describe("narrator contract", () => {
  it("includes hard verdict format sections", () => {
    assert.match(NARRATOR_VERDICT_FIRST_CONTRACT, /CLIENT READ/i);
    assert.match(NARRATOR_VERDICT_FIRST_CONTRACT, /THE CALL/i);
    assert.match(NARRATOR_VERDICT_FIRST_CONTRACT, /RUNNER-UP/i);
    assert.match(NARRATOR_VERDICT_FIRST_CONTRACT, /KILL COUNT/i);
    assert.match(NARRATOR_VERDICT_FIRST_CONTRACT, /ESCAPE HATCH/i);
    assert.match(NARRATOR_VERDICT_FIRST_CONTRACT, /NO closing preference questions/i);
  });

  it("includes two gold exemplars", () => {
    assert.match(NARRATOR_GOLD_EXEMPLARS, /EXEMPLAR A/i);
    assert.match(NARRATOR_GOLD_EXEMPLARS, /EXEMPLAR B/i);
    assert.match(NARRATOR_GOLD_EXEMPLARS, /club DJ/i);
    assert.match(NARRATOR_GOLD_EXEMPLARS, /looked at 131/i);
  });

  it("builds kill stats from pool and ruled-out", () => {
    const stats = buildKillStats({
      pooled: 131,
      ruledOut: Array.from({ length: 126 }, (_, i) => ({
        productId: `gid://${i}`,
        title: "x",
        reason: "wrong color",
        gate: "color" as const,
      })),
      survived: 5,
    });
    assert.equal(stats.pooled, 131);
    assert.equal(stats.rejected, 126);
    assert.equal(stats.survived, 5);
  });

  it("picks runner-up distinct from hero", () => {
    const hero: CuratedPick = {
      id: "a",
      title: "Hero",
      slot: "shoop_pick",
      reason: "r",
      verdict: "buy",
      insight: {
        retailerCheckNote: "n",
        fitReasons: ["a", "b", "c"],
        checkedItems: ["x"],
        pickStory: "s",
        changeMindItems: ["y", "z"],
      },
    };
    const alt: CuratedPick = {
      ...hero,
      id: "b",
      title: "Alt",
      slot: "best_value",
      verdict: "wait",
    };
    assert.equal(runnerUpPlacement([hero, alt], hero)?.id, "b");
  });

  it("instructions include kill count, runner-up, and exemplars", () => {
    const text = buildNarratorInstructions({
      brief: blazerTraceBrief,
      killStats: buildKillStats({ pooled: 131, survived: 5 }),
      hero: {
        id: "gid://shopify/Product/valid-black",
        title: "Men's Black Wool Blend Tailored Blazer",
        slot: "shoop_pick",
        reason: "Black wool blend with tailored structure for office wear.",
        verdict: "buy",
        insight: {
          retailerCheckNote: "n",
          fitReasons: ["a", "b", "c"],
          checkedItems: ["x"],
          pickStory: "s",
          changeMindItems: ["y", "z"],
        },
      },
      runnerUp: {
        id: "gid://shopify/Product/navy",
        title: "Navy Stripe Blazer",
        slot: "best_value",
        reason: "Solid alternate if navy is acceptable.",
        verdict: "wait",
        insight: {
          retailerCheckNote: "n",
          fitReasons: ["a", "b", "c"],
          checkedItems: ["x"],
          pickStory: "s",
          changeMindItems: ["y", "z"],
        },
      },
      rejectionLines: ["color: requires black but product signals another color"],
      expertisePrinciples: [
        "Office blazers: navy and charcoal are the business defaults; black reads evening unless work is nightlife.",
      ],
    });
    assert.match(text, /looked at 131, rejected/i);
    assert.match(text, /GOLD EXEMPLARS/i);
    assert.match(text, /Runner-up/i);
    assert.match(text, /CLIENT READ/i);
    assert.match(text, /NO closing preference questions/i);
  });
});
