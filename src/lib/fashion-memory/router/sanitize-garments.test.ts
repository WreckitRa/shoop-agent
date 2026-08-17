import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isStylePhraseGarment,
  sanitizeBriefGarments,
} from "./sanitize-garments";
import type { FashionSearchBrief } from "./types";

function baseBrief(
  overrides: Partial<FashionSearchBrief> = {},
): FashionSearchBrief {
  return {
    garments: ["shirt", "bottoms", "shoes"],
    must_haves: [],
    nice_to_haves: [],
    request_type: "outfit",
    stated_facts: {},
    quantity_hint: "one outfit",
    budget_context: { stated: false },
    brand_direction: { brands: [], source: "none" },
    color_direction: { source: "none" },
    knowledge_state: { department: "mens" },
    style_direction: "casual",
    department_scope: "mens",
    occasion_context: "day party",
    recipient_person_id: "p1",
    ...overrides,
  };
}

describe("sanitizeBriefGarments", () => {
  it("moves style phrases out of garments into style_direction", () => {
    const out = sanitizeBriefGarments(
      baseBrief({
        garments: ["cool style laid back", "shirt", "bottoms", "shoes"],
        must_haves: ["laid-back", "cool style"],
      }),
    );
    assert.ok(!out.garments.some((g) => /cool style/i.test(g)));
    assert.ok(out.garments.includes("shirt"));
    assert.match(out.style_direction, /cool style laid back/i);
  });

  it("keeps known garments", () => {
    assert.equal(isStylePhraseGarment("shirt"), false);
    assert.equal(isStylePhraseGarment("cool style laid back"), true);
  });

  it("does not invent shirt/trousers/shoes when all garments are style fluff", () => {
    const out = sanitizeBriefGarments(
      baseBrief({
        garments: ["cool style laid back", "effortless vibe"],
      }),
    );
    assert.deepEqual(out.garments, []);
    assert.match(out.style_direction, /cool style|effortless/i);
  });

  it("collapses shoe/shoes to one family (cmsriozum0017k4xg4g6nm2h9)", () => {
    const out = sanitizeBriefGarments(
      baseBrief({ garments: ["top", "bottom", "shoe", "shoes"] }),
    );
    assert.deepEqual(out.garments, ["top", "bottom", "shoe"]);
  });
});
