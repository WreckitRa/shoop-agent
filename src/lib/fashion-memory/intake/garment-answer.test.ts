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

  it("does not treat Full outfit / One piece as garment SKUs", () => {
    assert.deepEqual(normalizeGarmentClarificationAnswer("Full outfit"), []);
    assert.deepEqual(normalizeGarmentClarificationAnswer("One piece"), []);
  });

  it("maps Mix of both to shoes+accessories without inventing SKUs", () => {
    assert.deepEqual(normalizeGarmentClarificationAnswer("Mix of both"), [
      "shoes",
      "accessories",
    ]);
  });

  it("keeps apparel siblings when sneakers are in the same clause", () => {
    assert.deepEqual(
      normalizeGarmentClarificationAnswer(
        "shirts, trousers, sneakers, overshirt. just show me what you've got",
      ).sort(),
      ["overshirt", "shirts", "sneakers", "trousers"],
    );
  });

  it("keeps coat with boots in the opening clause", () => {
    assert.deepEqual(
      normalizeGarmentClarificationAnswer(
        "winter coat and boots for the commute",
      ).sort(),
      ["boots", "coat"],
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
