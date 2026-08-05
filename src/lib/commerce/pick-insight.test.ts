import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHonestCheckedItems, buildHeuristicInsight } from "./pick-insight";

describe("checkedItems honesty (P0 #14)", () => {
  it("only lists checks that actually ran", () => {
    const items = buildHonestCheckedItems({
      priceVerified: true,
      sizeExactMatch: true,
      colorGatePassed: true,
      genderGatePassed: true,
      candidateCount: 15,
    });
    assert.ok(items.some((l) => /live catalog lookup/i.test(l)));
    assert.ok(items.some((l) => /Your size is in stock/i.test(l)));
    assert.ok(items.some((l) => /Color matched/i.test(l)));
    assert.equal(
      items.some((l) => /Available sizes \/ colors in search results/i.test(l)),
      false,
    );
  });

  it("omits size line when no size constraint was checked", () => {
    const items = buildHonestCheckedItems({
      priceVerified: true,
      sizeExactMatch: null,
      colorGatePassed: null,
      genderGatePassed: null,
      candidateCount: 10,
    });
    assert.equal(items.some((l) => /size/i.test(l)), false);
  });

  it("fitReasons avoid banned template phrases (P1 #15)", () => {
    const insight = buildHeuristicInsight(
      { title: "Men's Black Blazer" },
      12,
      "shoop_pick",
      "Black wool blend with structured shoulders.",
      {
        priceVerified: true,
        sizeExactMatch: true,
        colorGatePassed: true,
        genderGatePassed: true,
        candidateCount: 12,
      },
    );
    const joined = insight.fitReasons.join(" ");
    assert.equal(/Best overall match to your profile/i.test(joined), false);
    assert.equal(/Lines up with the product type/i.test(joined), false);
  });
});
