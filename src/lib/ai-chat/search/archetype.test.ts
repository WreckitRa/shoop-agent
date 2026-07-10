import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchBrief,
  classifyArchetype,
  classifyBudgetType,
  genderScopeFromPresentation,
} from "./archetype";

describe("classifyArchetype", () => {
  it("classifies explicit constraints as specific", () => {
    assert.equal(
      classifyArchetype({ query: "men's running shoes size US 10 under $120" })
        .archetype,
      "specific",
    );
    assert.equal(
      classifyArchetype({ query: "iPhone 15 vs Pixel 8" }).archetype,
      "specific",
    );
  });

  it("classifies short bare-category asks as broad", () => {
    assert.equal(classifyArchetype({ query: "black t-shirt" }).archetype, "broad");
  });

  it("splits gifts by whether there is a direction", () => {
    assert.equal(
      classifyArchetype({ query: "birthday gift for my wife" }).archetype,
      "gift_vague",
    );
    assert.equal(
      classifyArchetype({
        query: "birthday gift for my wife",
        hasRecipientFacts: true,
      }).archetype,
      "gift_directed",
    );
    assert.equal(
      classifyArchetype({ query: "gift for my dad", hasGiftAnchor: true })
        .archetype,
      "gift_directed",
    );
  });
});

describe("classifyBudgetType", () => {
  it("reads strict phrasing as hard", () => {
    assert.equal(classifyBudgetType("must be under $100"), "hard");
    assert.equal(classifyBudgetType("strictly no more than 50"), "hard");
  });
  it("reads fuzzy phrasing as soft", () => {
    assert.equal(classifyBudgetType("something around $80"), "soft");
    assert.equal(classifyBudgetType("roughly 200 ish"), "soft");
  });
  it("defaults to none", () => {
    assert.equal(classifyBudgetType("a cozy wool sweater"), "none");
  });
});

describe("genderScopeFromPresentation", () => {
  it("maps presentations to scopes", () => {
    assert.equal(genderScopeFromPresentation("masculine"), "mens");
    assert.equal(genderScopeFromPresentation("Female"), "womens");
    assert.equal(genderScopeFromPresentation("nonbinary"), "unisex");
    assert.equal(genderScopeFromPresentation(undefined), "unknown");
    assert.equal(genderScopeFromPresentation("something else"), "unknown");
  });
});

describe("buildSearchBrief", () => {
  it("never applies the buyer's gender scope to a gift recipient", () => {
    const brief = buildSearchBrief({
      query: "birthday gift for my wife",
      fields: { recipient: { kind: "other", label: "wife" } },
      ctx: { buyerGenderScope: "mens" },
    });
    assert.equal(brief.recipient.kind, "other");
    assert.equal(brief.genderScope, "unknown");
  });

  it("applies the buyer's gender scope to self requests", () => {
    const brief = buildSearchBrief({
      query: "lightweight running jacket",
      ctx: { buyerGenderScope: "womens" },
    });
    assert.equal(brief.recipient.kind, "self");
    assert.equal(brief.genderScope, "womens");
  });

  it("does not inherit the buyer's stored sizes for a gift", () => {
    const brief = buildSearchBrief({
      query: "gift for my dad",
      fields: { recipient: { kind: "other", label: "dad" } },
      ctx: { memoryVariantConstraints: { size: "M" } },
    });
    assert.equal(brief.variantConstraints.size, undefined);
  });

  it("auto-applies stored sizes for self requests", () => {
    const brief = buildSearchBrief({
      query: "a new merino base layer",
      ctx: { memoryVariantConstraints: { size: "M" } },
    });
    assert.equal(brief.variantConstraints.size, "M");
  });

  it("derives budget amount from the price ceiling", () => {
    const brief = buildSearchBrief({
      query: "headphones around $200",
      priceMaxCents: 20_000,
    });
    assert.equal(brief.budget.amountCents, 20_000);
    assert.equal(brief.budget.type, "soft");
  });
});
