import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectedOutfitLookLabels } from "./outfit-style-catalog";

describe("selectedOutfitLookLabels", () => {
  it("keeps freeform look labels as-is", () => {
    assert.deepEqual(selectedOutfitLookLabels(["jeans + knit", "all black"]), [
      "jeans + knit",
      "all black",
    ]);
  });

  it("canonicalizes in-house family labels", () => {
    assert.deepEqual(
      selectedOutfitLookLabels([
        "athleisure",
        "smart casual",
        "resort and holiday",
      ]),
      ["Athleisure", "Smart casual", "Resort and holiday"],
    );
  });

  it("drops exploded catalog crumbs from a worn-grid save", () => {
    assert.deepEqual(
      selectedOutfitLookLabels([
        "athleisure",
        "hoodie",
        "knit",
        "easy",
        "sporty",
        "blazer",
        "smart",
        "casual",
        "clean",
        "smart casual",
        "smart_casual",
        "linen",
        "resort",
        "holiday",
        "coastal",
        "resort and holiday",
        "resort_holiday",
        "boho",
        "street",
      ]),
      ["Athleisure", "Smart casual", "Resort and holiday"],
    );
  });
});
