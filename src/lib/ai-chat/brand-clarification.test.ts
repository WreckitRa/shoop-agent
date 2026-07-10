import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildBrandClarificationQuestion,
  categoryBenefitsFromBrandQuestion,
  isBrandClarificationQuestion,
} from "./brand-clarification";

describe("brand-clarification", () => {
  it("detects brand question ids", () => {
    assert.equal(isBrandClarificationQuestion({ id: "brands" }), true);
    assert.equal(isBrandClarificationQuestion({ id: "preferred_brands" }), true);
    assert.equal(isBrandClarificationQuestion({ id: "budget" }), false);
  });

  it("flags brand-relevant categories", () => {
    assert.equal(categoryBenefitsFromBrandQuestion(["shoes"]), true);
    assert.equal(categoryBenefitsFromBrandQuestion(["home"]), false);
  });

  it("builds optional multi-select brand chips for a category", () => {
    const q = buildBrandClarificationQuestion(["shoes"]);
    assert.equal(q.id, "brands");
    assert.equal(q.optional, true);
    assert.equal(q.allowMultiple, true);
    assert.ok(q.options.some((o) => o.label === "Nike"));
    assert.ok(q.options.some((o) => o.id === "open_to_any"));
  });
});
