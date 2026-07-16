import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasConcreteGarmentDirection,
  mergeResolvedGarmentsIntoBriefGarments,
  normalizeGarmentClarificationAnswer,
} from "./garment-answer";
import { garmentToSizeBucket } from "./garment-size-fields";

describe("normalizeGarmentClarificationAnswer", () => {
  it("keeps a bare bracelets chip", () => {
    assert.deepEqual(normalizeGarmentClarificationAnswer("bracelets"), [
      "bracelets",
    ]);
  });

  it("extracts bracelets from free text that also mentions shoe size", () => {
    assert.deepEqual(
      normalizeGarmentClarificationAnswer(
        "bracelets. What's his shoe size, if shoes are in the mix? 11–12",
      ),
      ["bracelets"],
    );
  });

  it("parses the no-shoes accessory chip", () => {
    assert.deepEqual(
      normalizeGarmentClarificationAnswer(
        "Watches, belts, bags, bracelets — no shoes",
      ),
      ["watches", "belts", "bags", "bracelets"],
    );
  });

  it("parses shoes-and-accessories chip", () => {
    assert.deepEqual(
      normalizeGarmentClarificationAnswer("Shoes (and other accessories)"),
      ["shoes"],
    );
  });
});

describe("hasConcreteGarmentDirection", () => {
  it("treats accessories as concrete direction (planner decomposes tray)", () => {
    assert.equal(hasConcreteGarmentDirection(["accessories"]), true);
    assert.equal(hasConcreteGarmentDirection(["bracelets"]), true);
  });
});

describe("mergeResolvedGarmentsIntoBriefGarments", () => {
  it("replaces vague accessories with bracelets", () => {
    assert.deepEqual(
      mergeResolvedGarmentsIntoBriefGarments(["accessories"], ["bracelets"]),
      ["bracelets"],
    );
  });
});

describe("garmentToSizeBucket accessories", () => {
  it("skips one-size accessories; belts use simple waist/bottoms", () => {
    assert.equal(garmentToSizeBucket("bracelets"), null);
    assert.equal(garmentToSizeBucket("watch"), null);
    assert.equal(garmentToSizeBucket("accessories"), null);
    assert.equal(garmentToSizeBucket("belt"), "bottoms");
  });

  it("still maps shoes and shirts", () => {
    assert.equal(garmentToSizeBucket("shoes"), "shoes");
    assert.equal(garmentToSizeBucket("shirt"), "tops");
  });
});
