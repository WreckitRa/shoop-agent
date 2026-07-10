import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSearchBrief } from "./archetype";
import {
  giftDirectedAllowsLegacyCatalogSearch,
  giftSearchNeedsDirectionPicker,
  inferGiftDirectionLabelFromQuery,
} from "./gift-direction-gate";

describe("gift direction gate", () => {
  it("requires direction picker when gift has no direction_label", () => {
    const brief = buildSearchBrief({
      query: "holiday gift for friend",
      fields: {
        archetype: "gift_vague",
        recipient: { kind: "other", label: "friend" },
      },
    });
    assert.equal(giftSearchNeedsDirectionPicker(brief), true);
  });

  it("allows search when direction_label is set", () => {
    const brief = buildSearchBrief({
      query: "tech gadgets",
      fields: {
        archetype: "gift_directed",
        direction_label: "Tech & gadgets",
        recipient: { kind: "other", label: "friend" },
      },
    });
    assert.equal(giftSearchNeedsDirectionPicker(brief), false);
  });

  it("infers direction_label from thematic query after chip pick", () => {
    const brief = buildSearchBrief({
      query: "Tech & gadgets",
      fields: {
        archetype: "gift_directed",
        recipient: { kind: "other", label: "friend" },
      },
    });
    const inferred = inferGiftDirectionLabelFromQuery(brief, "Tech & gadgets");
    assert.equal(inferred.directionLabel, "Tech & gadgets");
    assert.equal(giftSearchNeedsDirectionPicker(inferred), false);
  });

  it("does not infer direction from product-like query", () => {
    const brief = buildSearchBrief({
      query: "wireless earbuds",
      fields: {
        archetype: "gift_directed",
        recipient: { kind: "other", label: "friend" },
      },
    });
    const inferred = inferGiftDirectionLabelFromQuery(
      brief,
      "wireless earbuds",
    );
    assert.equal(inferred.directionLabel, undefined);
  });

  it("allows legacy catalog fallback for directed gifts with sanitized queries", () => {
    const brief = buildSearchBrief({
      query: "luxury skincare set moisturizer serum face cream premium",
      fields: {
        archetype: "gift_directed",
        direction_label: "Beauty & skincare",
        recipient: { kind: "other", label: "friend" },
      },
    });
    assert.equal(
      giftDirectedAllowsLegacyCatalogSearch(
        brief,
        "luxury skincare gift set moisturizer serum face cream premium",
      ),
      true,
    );
  });

  it("blocks legacy fallback for vague gifts without direction", () => {
    const brief = buildSearchBrief({
      query: "gift for friend",
      fields: {
        archetype: "gift_vague",
        recipient: { kind: "other", label: "friend" },
      },
    });
    assert.equal(
      giftDirectedAllowsLegacyCatalogSearch(brief, "gift for friend"),
      false,
    );
  });
});
