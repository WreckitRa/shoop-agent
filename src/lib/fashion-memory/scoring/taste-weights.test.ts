/**
 * Fixture: taste can outrank shopify_rank under v4, and v3 ignores it.
 *
 * Not a live baseline. A planted rack where matching items sit below
 * Shopify rank 0..2. Proves the weight switch, not what real racks look like.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import { scoreSlotProducts } from "./orchestrator";
import {
  tasteFitForHeroes,
  type TasteFitSignal,
} from "./taste-fit";
import {
  isTasteScoringEnabled,
  scoringComponentKeys,
  scoringWeightsVersion,
} from "./weights";

function withWeights(
  alias: "v3-brand" | "v4-taste",
  fn: () => void,
): void {
  const prev = process.env.SCORING_WEIGHTS_VERSION;
  process.env.SCORING_WEIGHTS_VERSION = alias;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.SCORING_WEIGHTS_VERSION;
    else process.env.SCORING_WEIGHTS_VERSION = prev;
  }
}

afterEach(() => {
  delete process.env.SCORING_WEIGHTS_VERSION;
});

function product(
  id: string,
  opts: { title: string; colors?: string[] },
): FashionSlotCatalogProduct {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title: opts.title,
    variant_options: [],
    image_urls: [],
    raw: { id, title: opts.title } as CatalogProductSummary,
    normalized: {
      colors: {
        buckets: (opts.colors ?? ["unknown"]) as never[],
        status: opts.colors?.length ? "resolved" : "unknown",
      },
      sizes: [],
    },
  };
}

function logsForRank(products: FashionSlotCatalogProduct[]) {
  return [
    {
      slot_id: "s1",
      variant_index: 0,
      query: "q",
      reformulation: false,
      status: "ok" as const,
      raw_count: products.length,
      duration_ms: 1,
      products: products.map((p) => ({ id: p.id })),
    },
  ];
}

const slot: FashionSearchPlanSlot = {
  slot_id: "s1",
  garment: "blazer",
  role: "anchor",
  style_direction: "work",
  palette_constraint: null,
  palette_source: "spread",
  options_wanted: 3,
  query_variants: ["womens blazer"],
};

const brief: FashionSearchBrief = {
  recipient_person_id: "p1",
  request_type: "single_item",
  garments: ["blazer"],
  occasion_context: "work",
  quantity_hint: "",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "work",
};

function heroMean(
  products: FashionSlotCatalogProduct[],
  signals: TasteFitSignal[],
  heroCount = 3,
): number | null {
  const scored = scoreSlotProducts({
    slot,
    brief,
    recipientFacts: [],
    products,
    queryLogs: logsForRank(products),
  });
  const heroes = scored.products.slice(0, heroCount).map((p) => ({
    product_id: p.id,
    slot_id: "s1",
    product: p,
  }));
  return tasteFitForHeroes({
    heroes,
    signals,
    preference_anchor: "keep",
  }).mean;
}

const MAYA_RACK = [
  product("trend-1", { title: "Red party blazer", colors: ["red"] }),
  product("trend-2", { title: "Emerald oversized blazer", colors: ["green"] }),
  product("trend-3", { title: "Pink boxy blazer", colors: ["pink"] }),
  product("navy-tailored", { title: "Navy tailored blazer", colors: ["navy"] }),
  product("navy-relaxed", { title: "Navy relaxed blazer", colors: ["navy"] }),
];

const MAYA_SIGNALS: TasteFitSignal[] = [
  { signal_type: "color", value: "navy", polarity: 1 },
  { signal_type: "silhouette", value: "tailored", polarity: 1 },
];

describe("taste-weights fixture", () => {
  it("default alias is v4-taste", () => {
    assert.equal(scoringWeightsVersion(), "20260828-v4-taste");
    assert.equal(isTasteScoringEnabled(), true);
    assert.equal(scoringComponentKeys().includes("taste_fit"), true);
  });

  it("v3-brand drops taste_fit from the active key set", () => {
    withWeights("v3-brand", () => {
      assert.equal(scoringWeightsVersion(), "20260709-v3-brand");
      assert.equal(isTasteScoringEnabled(), false);
      assert.equal(scoringComponentKeys().includes("taste_fit"), false);
    });
  });

  it("v3: shopify_rank buries the matching item (mean −1)", () => {
    withWeights("v3-brand", () => {
      assert.equal(heroMean(MAYA_RACK, MAYA_SIGNALS), -1);
    });
  });

  it("v3 ignores taste_rating so rank still wins", () => {
    withWeights("v3-brand", () => {
      const products = MAYA_RACK.map((p) => ({ ...p }));
      const match = products.find((p) => p.id === "navy-tailored")!;
      match.taste_rating = {
        taste_fit: 1,
        lane: "usual",
      };
      assert.equal(heroMean(products, MAYA_SIGNALS), -1);
    });
  });

  it("v4: taste_rating lifts the matching item into heroes", () => {
    withWeights("v4-taste", () => {
      const products = MAYA_RACK.map((p) => ({ ...p }));
      const match = products.find((p) => p.id === "navy-tailored")!;
      match.taste_rating = {
        taste_fit: 1,
        lane: "usual",
      };
      const mean = heroMean(products, MAYA_SIGNALS);
      assert.ok(mean != null && mean > -1, `expected lift, got ${mean}`);
    });
  });
});
