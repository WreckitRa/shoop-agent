import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTaxonomyAttributeFilters } from "./taxonomy-attribute-filters";
import type { SearchBrief } from "./types";

function brief(overrides: Partial<SearchBrief> = {}): SearchBrief {
  return {
    archetype: "specific",
    query: "men's navy blazer",
    mustHaves: [],
    niceToHaves: [],
    budget: { amountCents: 20000, type: "soft", currency: "USD" },
    variantConstraints: {},
    genderScope: "mens",
    recipient: { kind: "self" },
    rankingProfile: "relevance_first",
    ...overrides,
  };
}

describe("buildTaxonomyAttributeFilters", () => {
  it("maps compound size brief to Size OR values", () => {
    const filters = buildTaxonomyAttributeFilters(
      brief({ variantConstraints: { size: "M / 42R" } }),
    );
    const size = filters?.find((f) => f.name === "Size");
    assert.ok(size);
    assert.ok(size!.values.includes("M"));
    assert.ok(size!.values.includes("42"));
    assert.ok(size!.values.includes("L"));
  });

  it("includes Color and Target gender when set", () => {
    const filters = buildTaxonomyAttributeFilters(
      brief({
        variantConstraints: { color: "Navy" },
        genderScope: "womens",
      }),
    );
    assert.deepEqual(
      filters?.find((f) => f.name === "Color")?.values,
      ["Navy"],
    );
    assert.deepEqual(
      filters?.find((f) => f.name === "Target gender")?.values,
      ["Female"],
    );
  });

  it("returns undefined when no filterable constraints", () => {
    assert.equal(
      buildTaxonomyAttributeFilters(brief({ genderScope: "unknown" })),
      undefined,
    );
  });
});
