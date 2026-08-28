import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { imageBudgetForSlot } from "./deliverables";
import { pickImagedIds } from "./refs";
import type { FashionSearchBrief } from "../router/types";
import type { HydratedCandidate } from "../hydration/types";

const brief = (
  type: FashionSearchBrief["request_type"],
  depth: FashionSearchBrief["depth"],
): Pick<FashionSearchBrief, "request_type" | "depth"> => ({
  request_type: type,
  depth,
});

describe("imageBudgetForSlot", () => {
  it("single_item is min(8, agreedDepth × 2)", () => {
    assert.equal(
      imageBudgetForSlot({
        mode: "single_item",
        role: "anchor",
        brief: brief("single_item", { options_per_item: 3, source: "stated" }),
      }),
      6,
    );
    assert.equal(
      imageBudgetForSlot({
        mode: "single_item",
        role: "anchor",
        brief: brief("single_item", { options_per_item: 5, source: "stated" }),
      }),
      8,
    );
  });

  it("outfit support stays 4; anchor uses depth × 2", () => {
    const b = brief("outfit", { looks_wanted: 2, source: "stated" });
    assert.equal(
      imageBudgetForSlot({ mode: "outfit", role: "support", brief: b }),
      4,
    );
    assert.equal(
      imageBudgetForSlot({ mode: "outfit", role: "anchor", brief: b }),
      4,
    );
  });

  it("v3 uses the pre-S1 fixed budgets", () => {
    const prev = process.env.SCORING_WEIGHTS_VERSION;
    process.env.SCORING_WEIGHTS_VERSION = "v3-brand";
    try {
      assert.equal(
        imageBudgetForSlot({
          mode: "single_item",
          role: "anchor",
          brief: brief("single_item", { options_per_item: 5, source: "stated" }),
        }),
        6,
      );
      const b = brief("outfit", { looks_wanted: 2, source: "stated" });
      assert.equal(
        imageBudgetForSlot({ mode: "outfit", role: "anchor", brief: b }),
        4,
      );
    } finally {
      if (prev === undefined) delete process.env.SCORING_WEIGHTS_VERSION;
      else process.env.SCORING_WEIGHTS_VERSION = prev;
    }
  });
});

function cand(
  id: string,
  lane: "usual" | "adjacent" | "new",
  score: number,
): HydratedCandidate {
  return {
    id,
    upid: id,
    title: id,
    image_urls: [],
    media_urls: [],
    matched_by: [0],
    matched_by_color_variant: false,
    variant_options: [],
    raw: { id, title: id },
    size_status: "unknown",
    taste_rating: { taste_fit: score, lane },
    score: { final: score, components: {}, active_components: [], penalties_applied: 0, weights_version: "t" },
  } as HydratedCandidate;
}

describe("pickImagedIds", () => {
  it("explore reserves half the budget for lane=new", () => {
    const candidates = [
      cand("u1", "usual", 0.9),
      cand("u2", "usual", 0.8),
      cand("u3", "usual", 0.7),
      cand("n1", "new", 0.4),
      cand("n2", "new", 0.3),
    ];
    const ids = pickImagedIds({
      candidates,
      budget: 4,
      anchor: "explore",
    });
    assert.equal(ids.size, 4);
    assert.equal(ids.has("n1"), true);
    assert.equal(ids.has("n2"), true);
  });

  it("explore budget ≤ 2 still images at least one new", () => {
    const candidates = [
      cand("u1", "usual", 0.9),
      cand("u2", "usual", 0.8),
      cand("n1", "new", 0.2),
      cand("n2", "new", 0.1),
      cand("n3", "new", 0.05),
    ];
    const ids = pickImagedIds({
      candidates,
      budget: 2,
      anchor: "explore",
    });
    assert.equal(ids.size, 2);
    assert.equal(ids.has("n1"), true);
  });

  it("push always images one adjacent/new even if lowest scored", () => {
    const candidates = [
      cand("u1", "usual", 0.9),
      cand("u2", "usual", 0.8),
      cand("a1", "adjacent", 0.1),
    ];
    const ids = pickImagedIds({
      candidates,
      budget: 2,
      anchor: "push",
    });
    assert.equal(ids.size, 2);
    assert.equal(ids.has("a1"), true);
    assert.equal(ids.has("u1"), true);
  });
});
