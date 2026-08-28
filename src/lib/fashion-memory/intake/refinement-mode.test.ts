import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FashionSearchBrief } from "../router/types";
import {
  classifyRefinementMode,
  familyDiff,
  isSingleFamilyChange,
} from "./refinement-mode";

const base = (): FashionSearchBrief => ({
  recipient_person_id: "self",
  request_type: "outfit",
  garments: ["shirt", "trousers"],
  occasion_context: "office",
  quantity_hint: "a few",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "",
  depth: { looks_wanted: 1, source: "assumed" },
});

describe("classifyRefinementMode", () => {
  it("first search with no on-screen result is full", () => {
    assert.equal(classifyRefinementMode(null, base()), "full");
  });

  it("same garments + looser color/anchor is rescore-only", () => {
    const prev = base();
    const next: FashionSearchBrief = {
      ...base(),
      color_direction: { stated_colors: ["navy"], source: "stated" },
      preference_anchor: "keep",
      style_direction: "sharper",
      must_haves: ["navy"],
    };
    assert.equal(classifyRefinementMode(prev, next), "rescore-only");
  });

  it("swap one family is partial", () => {
    const prev = base();
    const next: FashionSearchBrief = {
      ...base(),
      garments: ["shirt", "shoes"],
    };
    assert.equal(classifyRefinementMode(prev, next), "partial");
    const diff = familyDiff(prev.garments, next.garments);
    assert.equal(isSingleFamilyChange(diff), true);
  });

  it("drop one piece is partial", () => {
    const next: FashionSearchBrief = { ...base(), garments: ["shirt"] };
    assert.equal(classifyRefinementMode(base(), next), "partial");
  });

  it("tighter budget is full", () => {
    const prev: FashionSearchBrief = {
      ...base(),
      budget_context: { stated: true, max: 400, currency: "USD" },
    };
    const next: FashionSearchBrief = {
      ...base(),
      budget_context: { stated: true, max: 200, currency: "USD" },
    };
    assert.equal(classifyRefinementMode(prev, next), "full");
  });

  it("looser budget with same garments is rescore-only", () => {
    const prev: FashionSearchBrief = {
      ...base(),
      budget_context: { stated: true, max: 200, currency: "USD" },
    };
    const next: FashionSearchBrief = {
      ...base(),
      budget_context: { stated: true, max: 400, currency: "USD" },
    };
    assert.equal(classifyRefinementMode(prev, next), "rescore-only");
  });

  it("recipient change is full", () => {
    assert.equal(
      classifyRefinementMode(base(), {
        ...base(),
        recipient_person_id: "dad",
      }),
      "full",
    );
  });

  it("occasion prose rewrite does not force a re-plan", () => {
    assert.equal(
      classifyRefinementMode(base(), {
        ...base(),
        occasion_context: "winter commute",
      }),
      "rescore-only",
    );
    assert.equal(
      classifyRefinementMode(
        { ...base(), occasion_context: "commute" },
        {
          ...base(),
          occasion_context: "winter commute",
          color_direction: { stated_colors: ["camel"], source: "stated" },
          must_haves: ["camel color"],
        },
      ),
      "rescore-only",
    );
  });

  it("request_type outfit vs multi_item with same families is rescore-only", () => {
    assert.equal(
      classifyRefinementMode(base(), {
        ...base(),
        request_type: "multi_item",
      }),
      "rescore-only",
    );
  });

  it("two family swaps are full", () => {
    const next: FashionSearchBrief = {
      ...base(),
      garments: ["blazer", "shoes"],
    };
    assert.equal(classifyRefinementMode(base(), next), "full");
  });
});
