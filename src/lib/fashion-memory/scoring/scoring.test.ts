import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { FashionSearchBrief } from "../router/types";
import type { FashionFactRow } from "../types";
import type {
  FashionCatalogQueryLog,
  FashionSlotCatalogProduct,
} from "../catalog-search/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import {
  computeSuspicionPenalty,
  isPaletteComponentActive,
  isSizeComponentActive,
  renormalizedWeights,
  scoreCorroboration,
  scoreProduct,
  scoreRating,
  scoreShopifyRank,
  scoreSizeConfirmed,
} from "./components";
import { paletteComponentScore, paletteMatch } from "./palette-match";
import { scoreSlotProducts } from "./orchestrator";
import { SCORING_WEIGHTS, scoringComponentKeys, scoringWeights, scoringWeightsVersion } from "./weights";

function fact<T extends FashionFactRow["fact_type"]>(
  fact_type: T,
  value: FashionFactRow["value"],
  garment_type: string | null = null,
): FashionFactRow {
  return {
    id: `fact-${fact_type}-${String(value)}`,
    user_id: "u1",
    person_id: "p1",
    fact_type,
    garment_type,
    value,
    source_quote: null,
    status: "active",
    superseded_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as FashionFactRow;
}

function product(
  id: string,
  overrides: Partial<FashionSlotCatalogProduct> & { raw?: CatalogProductSummary } = {},
): FashionSlotCatalogProduct {
  return {
    id,
    upid: id,
    matched_by: overrides.matched_by ?? [0],
    matched_by_color_variant: false,
    title: overrides.title ?? "Test Product",
    variant_options: overrides.variant_options ?? [],
    image_urls: [],
    raw: overrides.raw ?? ({ id, title: overrides.title ?? "Test Product" } as CatalogProductSummary),
    normalized: overrides.normalized,
    price: overrides.price,
    taxonomy_category: overrides.taxonomy_category,
    rating_value: overrides.rating_value,
    review_count: overrides.review_count,
    matched_only_unfiltered: overrides.matched_only_unfiltered,
    suspicions: overrides.suspicions,
  };
}

const briefWithSizes: FashionSearchBrief = {
  recipient_person_id: "p1",
  request_type: "single_item",
  garments: ["shirt"],
  occasion_context: "general",
  quantity_hint: "one",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "shirt",
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shirt"],
    sizes_unconfirmed: [],
  },
};

const briefSizesUnknown: FashionSearchBrief = {
  ...briefWithSizes,
  knowledge_state: {
    department: "mens",
    sizes_confirmed: [],
    sizes_unconfirmed: ["shirt"],
  },
};

function planSlot(overrides: Partial<FashionSearchPlanSlot> = {}): FashionSearchPlanSlot {
  return {
    slot_id: "s1",
    garment: "shirt",
    role: "hero",
    style_direction: "casual shirt",
    palette_constraint: null,
    palette_source: "spread",
    options_wanted: 6,
    query_variants: ["mens casual shirt"],
    ...overrides,
  };
}

function queryLogsForRanks(
  ranks: Record<string, number>,
): FashionCatalogQueryLog[] {
  return Object.entries(ranks).map(([id, rank], variant_index) => {
    const products = Array.from({ length: rank + 1 }, (_, i) =>
      i === rank ? { id } : { id: `filler-${variant_index}-${i}` },
    );
    return {
      slot_id: "s1",
      variant_index,
      query: `q-${variant_index}`,
      reformulation: false,
      status: "ok" as const,
      raw_count: products.length,
      duration_ms: 1,
      products,
    };
  });
}

describe("scoreShopifyRank", () => {
  const cases: Array<[number, number]> = [
    [0, 1.0],
    [20, 0.5],
    [80, 0.2],
  ];
  for (const [rank, expected] of cases) {
    it(`rank ${rank} → ${expected}`, () => {
      assert.equal(scoreShopifyRank(rank), expected);
    });
  }
});

describe("scoreCorroboration", () => {
  const p = product("p1");
  const cases: Array<[number, number]> = [
    [1, 0],
    [2, 0.6],
    [3, 1.0],
    [5, 1.0],
  ];
  for (const [variants, expected] of cases) {
    it(`${variants} variant(s) → ${expected}`, () => {
      assert.equal(
        scoreCorroboration({
          variantCount: variants,
          matchedOnlyUnfiltered: false,
          product: p,
        }),
        expected,
      );
    });
  }

  it("matched_only_unfiltered without category caps at 0.6", () => {
    assert.equal(
      scoreCorroboration({
        variantCount: 4,
        matchedOnlyUnfiltered: true,
        product: product("p1"),
      }),
      0.6,
    );
  });

  it("matched_only_unfiltered with taxonomy category is not capped", () => {
    assert.equal(
      scoreCorroboration({
        variantCount: 4,
        matchedOnlyUnfiltered: true,
        product: product("p1", { taxonomy_category: "Shirts" }),
      }),
      1.0,
    );
  });
});

describe("scoreRating", () => {
  it("missing rating → 0.5 neutral", () => {
    assert.equal(scoreRating(product("p1")), 0.5);
    assert.equal(scoreRating(product("p1", { rating_value: 4.8, review_count: 0 })), 0.5);
  });

  it("prior-average reviews → 0.5", () => {
    assert.equal(scoreRating(product("p1", { rating_value: 4.0, review_count: 100 })), 0.5);
  });

  it("strong reviews → 0.9 when Bayesian b=4.8", () => {
    // value 5.0 × 80 reviews → b = (80 + 400) / 100 = 4.8 → score 0.9
    const score = scoreRating(product("p1", { rating_value: 5.0, review_count: 80 }));
    assert.ok(Math.abs(score - 0.9) < 0.001, `expected 0.9 got ${score}`);
  });

  it("weak reviews → 0.1 when Bayesian b=3.2", () => {
    // value 3.0 × 80 reviews → b = (80 + 240) / 100 = 3.2 → score 0.1
    const score = scoreRating(product("p1", { rating_value: 3.0, review_count: 80 }));
    assert.ok(Math.abs(score - 0.1) < 0.001, `expected 0.1 got ${score}`);
  });
});

describe("scoreSizeConfirmed", () => {
  const recipientFacts = [fact("size", { system: "alpha", value: "M" }, "tops")];

  it("exact alpha match → 1.0", () => {
    const p = product("p1", {
      normalized: {
        colors: { status: "unknown", buckets: [] },
        sizes: [
          {
            raw: "M",
            status: "resolved",
            size: { alpha: "M" },
          },
        ],
      },
    });
    assert.equal(
      scoreSizeConfirmed({ product: p, garment: "shirt", recipientFacts }),
      1.0,
    );
  });

  it("unknown size labels → 0 neutral", () => {
    const p = product("p1", {
      normalized: {
        colors: { status: "unknown", buckets: [] },
        sizes: [{ raw: "?", status: "unknown", size: null }],
      },
    });
    assert.equal(
      scoreSizeConfirmed({ product: p, garment: "shirt", recipientFacts }),
      0,
    );
  });
});

describe("paletteMatch + paletteComponentScore", () => {
  it("two-tone with one in-palette bucket → partial", () => {
    assert.equal(paletteMatch(["black", "red"], "black neutral palette"), "partial");
  });

  it("occasion_default out-of-palette never below neutral", () => {
    const score = paletteComponentScore({
      buckets: ["red"],
      colorStatus: "resolved",
      constraint: "black neutral palette",
      source: "occasion_default",
    });
    assert.ok(score >= 0.5, `expected >= 0.5 got ${score}`);
    assert.equal(score, 0.5);
  });

  it("unknown product colors → 0.5 regardless of source", () => {
    assert.equal(
      paletteComponentScore({
        buckets: [],
        colorStatus: "unknown",
        constraint: "black",
        source: "stated",
      }),
      0.5,
    );
  });

  it("stated in-palette → 1.0", () => {
    assert.equal(
      paletteComponentScore({
        buckets: ["black"],
        colorStatus: "resolved",
        constraint: "black neutral palette",
        source: "stated",
      }),
      1.0,
    );
  });
});

describe("renormalizedWeights", () => {
  it("inactive size + palette redistribute to sum 1", () => {
    const w = renormalizedWeights(["shopify_rank", "corroboration", "rating"]);
    const sum = w.shopify_rank + w.corroboration + w.rating;
    assert.ok(Math.abs(sum - 1) < 1e-9);
    assert.ok(w.shopify_rank > SCORING_WEIGHTS.shopify_rank);
  });
});

describe("suspicion penalties", () => {
  it("caps total penalty", () => {
    assert.equal(computeSuspicionPenalty(1), 0.03);
    assert.equal(computeSuspicionPenalty(3), 0.08);
    assert.equal(computeSuspicionPenalty(10), 0.08);
  });
});

describe("commission is not a scoring input", () => {
  const BANNED = [
    "commission",
    "affiliate",
    "payout",
    "cpc",
    "cpa",
    "revshare",
  ] as const;
  const bannedRe = new RegExp(`\\b(${BANNED.join("|")})\\b`, "i");

  function assertClean(label: string, value: unknown) {
    const blob = JSON.stringify(value).toLowerCase();
    for (const word of BANNED) {
      assert.equal(blob.includes(word), false, `${label} contains ${word}`);
    }
  }

  function collectTs(dir: string, out: string[]) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        collectTs(path, out);
        continue;
      }
      if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
    }
  }

  it("weights, brief, catalog product, and score output have no rate fields", () => {
    assertClean("weights", {
      weights: scoringWeights(),
      keys: scoringComponentKeys(),
      version: scoringWeightsVersion(),
    });
    assertClean("brief", briefSizesUnknown);
    assertClean("product", product("p1"));
    const score = scoreProduct({
      product: product("p1"),
      slot: planSlot(),
      brief: briefSizesUnknown,
      recipientFacts: [],
      bestRank: 0,
    });
    assertClean("score", score);
  });

  it("ranking-layer source has no commission or affiliate identifiers", () => {
    const files: string[] = [];
    collectTs(join(process.cwd(), "src/lib/fashion-memory/scoring"), files);
    collectTs(join(process.cwd(), "src/lib/fashion-memory/router"), files);
    files.push(
      join(process.cwd(), "src/lib/fashion-memory/curation/build-input.ts"),
      join(process.cwd(), "src/lib/fashion-memory/catalog-search/types.ts"),
      join(process.cwd(), "src/lib/fashion-memory/hydration/types.ts"),
    );
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const hit = bannedRe.exec(text);
      assert.equal(hit, null, `${file} contains ${hit?.[0]}`);
    }
  });
});

describe("scoreProduct integration", () => {
  it("attaches breakdown with weights_version", () => {
    const score = scoreProduct({
      product: product("p1"),
      slot: planSlot(),
      brief: briefSizesUnknown,
      recipientFacts: [],
      bestRank: 0,
    });
    assert.equal(score.weights_version, scoringWeightsVersion());
    assert.ok(score.final >= 0 && score.final <= 1);
    assert.ok(score.components.shopify_rank > 0);
  });

  it("explore drops corroboration; keep keeps it", () => {
    const corroborated = product("hi", { matched_by: [0, 1, 2] });
    const singleton = product("lo", { matched_by: [0] });
    const keepHi = scoreProduct({
      product: corroborated,
      slot: planSlot(),
      brief: { ...briefSizesUnknown, preference_anchor: "keep" },
      recipientFacts: [],
      bestRank: 0,
    });
    const keepLo = scoreProduct({
      product: singleton,
      slot: planSlot(),
      brief: { ...briefSizesUnknown, preference_anchor: "keep" },
      recipientFacts: [],
      bestRank: 0,
    });
    assert.ok(keepHi.final > keepLo.final);

    const exploreHi = scoreProduct({
      product: corroborated,
      slot: planSlot(),
      brief: { ...briefSizesUnknown, preference_anchor: "explore" },
      recipientFacts: [],
      bestRank: 0,
    });
    const exploreLo = scoreProduct({
      product: singleton,
      slot: planSlot(),
      brief: { ...briefSizesUnknown, preference_anchor: "explore" },
      recipientFacts: [],
      bestRank: 0,
    });
    assert.equal(exploreHi.active_components.includes("corroboration"), false);
    assert.ok(exploreHi.active_components.includes("shopify_rank"));
    assert.ok(Math.abs(exploreHi.final - exploreLo.final) < 1e-9);

    const prev = process.env.SCORING_WEIGHTS_VERSION;
    process.env.SCORING_WEIGHTS_VERSION = "v3-brand";
    try {
      const v3Explore = scoreProduct({
        product: corroborated,
        slot: planSlot(),
        brief: { ...briefSizesUnknown, preference_anchor: "explore" },
        recipientFacts: [],
        bestRank: 0,
      });
      assert.equal(v3Explore.active_components.includes("corroboration"), true);
    } finally {
      if (prev === undefined) delete process.env.SCORING_WEIGHTS_VERSION;
      else process.env.SCORING_WEIGHTS_VERSION = prev;
    }
  });
});

describe("scoreSlotProducts properties", () => {
  it("nothing dropped — same ids and length", () => {
    const products = [
      product("a", { matched_by: [0] }),
      product("b", { matched_by: [0, 1] }),
      product("c", { matched_by: [0, 1, 2], suspicions: [{ rule: "no_price", evidence: "x", source_field: "price" }] }),
    ];
    const { products: out } = scoreSlotProducts({
      slot: planSlot(),
      brief: briefSizesUnknown,
      recipientFacts: [],
      products,
      queryLogs: queryLogsForRanks({ a: 2, b: 10, c: 0 }),
    });
    assert.equal(out.length, products.length);
    assert.deepEqual(
      out.map((p) => p.id).sort(),
      products.map((p) => p.id).sort(),
    );
    for (const p of out) assert.ok(p.score);
  });

  it("uncertainty neutrality — unknown at rank 5 beats known-mediocre at rank 60", () => {
    const unknown = product("unknown", { matched_by: [0] });
    const knownMediocre = product("known", {
      matched_by: [0, 1, 2],
      rating_value: 3.2,
      review_count: 200,
    });

    const { products: out } = scoreSlotProducts({
      slot: planSlot(),
      brief: briefSizesUnknown,
      recipientFacts: [],
      products: [knownMediocre, unknown],
      queryLogs: queryLogsForRanks({ unknown: 5, known: 60 }),
    });
    assert.equal(out[0]?.id, "unknown");
    assert.ok((out[0]?.score?.final ?? 0) > (out[1]?.score?.final ?? 0));
  });

  it("no cheap bias — identical products same score except outlier flag", () => {
    const cheap = product("cheap", { price: { amount: 5, currency: "USD" } });
    const fair = product("fair", { price: { amount: 80, currency: "USD" } });
    const { products: out } = scoreSlotProducts({
      slot: planSlot(),
      brief: briefSizesUnknown,
      recipientFacts: [],
      products: [cheap, fair],
      queryLogs: queryLogsForRanks({ cheap: 3, fair: 3 }),
    });
    const cheapScore = out.find((p) => p.id === "cheap")!.score!;
    const fairScore = out.find((p) => p.id === "fair")!.score!;
    assert.equal(cheapScore.final, fairScore.final);
    assert.equal(cheapScore.components.shopify_rank, fairScore.components.shopify_rank);
  });

  it("determinism — same input twice", () => {
    const products = [product("a"), product("b", { matched_by: [0, 1] })];
    const params = {
      slot: planSlot({ palette_constraint: "navy", palette_source: "profile" as const }),
      brief: briefSizesUnknown,
      recipientFacts: [] as FashionFactRow[],
      products,
      queryLogs: queryLogsForRanks({ a: 1, b: 4 }),
    };
    const first = scoreSlotProducts(params);
    const second = scoreSlotProducts(params);
    assert.deepEqual(
      first.products.map((p) => p.score),
      second.products.map((p) => p.score),
    );
  });

  it("sorts descending by final, tie-break shopify_rank", () => {
    const low = product("low", { matched_by: [0] });
    const high = product("high", { matched_by: [0, 1] });
    const { products: out } = scoreSlotProducts({
      slot: planSlot(),
      brief: briefSizesUnknown,
      recipientFacts: [],
      products: [low, high],
      queryLogs: queryLogsForRanks({ low: 40, high: 0 }),
    });
    assert.equal(out[0]?.id, "high");
  });
});

describe("component activation", () => {
  it("size inactive when garment in sizes_unconfirmed", () => {
    assert.equal(isSizeComponentActive(briefSizesUnknown, "shirt", []), false);
    assert.equal(
      isSizeComponentActive(briefWithSizes, "shirt", [
        fact("size", { system: "alpha", value: "M" }, "tops"),
      ]),
      true,
    );
  });

  it("palette inactive for spread or empty constraint", () => {
    assert.equal(isPaletteComponentActive(planSlot()), false);
    assert.equal(
      isPaletteComponentActive(
        planSlot({ palette_constraint: "navy", palette_source: "profile" }),
      ),
      true,
    );
    assert.equal(
      isPaletteComponentActive(
        planSlot({ palette_constraint: "navy", palette_source: "spread" }),
      ),
      false,
    );
  });
});
