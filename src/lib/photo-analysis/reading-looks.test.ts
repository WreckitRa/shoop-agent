import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fallbackFaceQuery,
  fallbackLookQuery,
  groupReadingLooks,
  pickLookProduct,
  productForStep,
  productTitleKey,
  readingLookQueries,
  uniqueLookProducts,
  wardrobePlanHasBuys,
} from "./reading-looks";
import type { StylistVerdict } from "./verdict";

function verdict(over: Partial<StylistVerdict> = {}): StylistVerdict {
  return {
    verdict_status: {
      readiness: "final",
      overall_confidence: 0.8,
      data_completeness: 0.7,
      sources_used: [],
      remaining_unknowns: [],
      assumptions: [],
      verdict_scope: "full",
    },
    executive_verdict: {
      headline: "h",
      profile_summary: "s",
      signature_style_statement: "",
      desired_impression: [],
      impressions_to_avoid: [],
      strongest_assets: [],
      biggest_opportunities: [],
      non_negotiables: [],
      top_priorities: [],
    },
    style_identity: {},
    color_system: {
      near_face_colors: [
        {
          name: "Ink Navy",
          representative_hex: "#1B2A4A",
          priority: "essential",
          best_uses: ["Polos"],
          notes: "",
        },
      ],
      core_colors: [
        {
          name: "Deep Charcoal",
          representative_hex: "#2F2F32",
          priority: "strong",
          best_uses: ["Overshirt"],
          notes: "",
        },
      ],
      best_neutrals: [],
      accent_colors: [],
      use_carefully: [],
    },
    proportion_and_silhouette: {},
    size_and_fit: {},
    garment_playbook: [
      {
        category: "overshirt",
        importance: "core",
        shopping_keywords: ["unlined overshirt"],
        colors: ["charcoal"],
      },
    ],
    fabrics_patterns_and_climate: {},
    grooming_and_accessories: {},
    outfit_formulas: [
      {
        occasion: "Campus week",
        formality: "easy",
        formula: ["substantial tee", "straight trousers"],
        color_options: ["ink navy"],
        silhouette_notes: "",
        footwear: ["refined sneakers"],
        accessories: [],
        climate_variation: "",
        avoid: [],
      },
    ],
    wardrobe_plan: {
      shopping_priorities: [
        {
          rank: 1,
          item: "charcoal unlined overshirt",
          quantity: 1,
          specification: "unlined, ink or charcoal",
          preferred_colors: ["charcoal"],
          budget_guidance: null,
          versatility: 0.9,
          why_now: "One layer changes the outfit.",
        },
      ],
      actions: [],
    },
    shopping_engine_profile: {},
    user_facing_verdict: {
      title: "t",
      opening: "o",
      golden_rules: [],
      mistakes_to_avoid: [],
      first_five_actions: [],
      confidence_note: "",
      review_trigger: "",
    },
    ...over,
  } as StylistVerdict;
}

describe("readingLookQueries", () => {
  it("builds look and buy queries from the verdict, not hex palette keys", () => {
    const qs = readingLookQueries(verdict());
    assert.equal(qs.some((q) => q.key.startsWith("palette:")), false);
    assert.ok(qs.some((q) => q.kind === "look" && /tee/i.test(q.query)));
    assert.ok(qs.some((q) => q.kind === "buy" && /overshirt/i.test(q.query)));
    assert.ok(qs.some((q) => q.kind === "swatch" && /navy/i.test(q.query)));
    assert.ok(qs.filter((q) => q.kind === "look" || q.kind === "buy").length <= 20);
  });

  it("searches a wearable colour for neon/pastel avoid families", () => {
    const qs = readingLookQueries(
      verdict({
        color_system: {
          ...verdict().color_system,
          use_carefully: [
            {
              color_or_family: "NEON COLORS",
              issue: "Fights a gentle colouring",
              how_to_wear: "Keep it off the neck",
            },
          ],
        },
      }),
    );
    const neon = qs.find((q) => q.kind === "avoid");
    assert.ok(neon);
    assert.match(neon?.query ?? "", /neon/i);
    assert.equal(/NEON COLORS/i.test(neon?.query ?? ""), false);
    assert.equal(/keep it off/i.test(neon?.query ?? ""), false);
  });

  it("does not search the avoid issue when it mentions a neckline", () => {
    const qs = readingLookQueries(
      verdict({
        color_system: {
          ...verdict().color_system,
          use_carefully: [
            {
              color_or_family: "ICY PASTELS",
              issue: "Keep it off the neck",
              how_to_wear: "Never next to your face",
            },
          ],
        },
      }),
    );
    const icy = qs.find((q) => q.kind === "avoid");
    assert.ok(icy);
    assert.equal(icy?.query, "light pastel crew neck");
    assert.equal(/keep it off the neck/i.test(icy?.query ?? ""), false);
  });

  it("keeps a full four-piece look even when later looks share a query", () => {
    const qs = readingLookQueries(
      verdict({
        outfit_formulas: [
          {
            occasion: "Everyday campus study",
            formula: ["chambray workshirt", "overshirt", "straight denim"],
            color_options: ["indigo"],
            footwear: ["sneakers"],
          },
          {
            occasion: "Study day with older kids and errands",
            formula: ["fleece hoodie", "track pant", "ripstop"],
            color_options: ["charcoal"],
            footwear: ["sneakers"],
          },
          {
            occasion: "Casual date",
            formula: ["twill knit polo", "chinos", "overshirt"],
            color_options: ["cream"],
            footwear: ["loafers"],
          },
        ],
      }),
    );
    const looks = qs.filter((q) => q.kind === "look");
    assert.equal(looks.length, 12);
    assert.equal(looks.filter((q) => q.lookLabel === "Casual date").length, 4);
    assert.equal(
      looks.filter((q) => /sneakers/i.test(q.query)).length,
      2,
      "shared footwear still searches per look",
    );
  });

  it("pulls five named looks with the garments each formula needs", () => {
    const occasions = [
      "Weekday studio",
      "School run",
      "Casual date",
      "Weekend market",
      "Dinner out",
    ];
    const qs = readingLookQueries(
      verdict({
        outfit_formulas: occasions.map((occasion) => ({
          occasion,
          formula: ["knit polo", "straight trousers"],
          color_options: ["navy"],
          footwear: ["sneakers"],
        })),
      }),
    );
    const looks = qs.filter((q) => q.kind === "look");
    assert.equal(new Set(looks.map((q) => q.lookId)).size, 5);
    assert.deepEqual(
      [...new Set(looks.map((q) => q.lookLabel))],
      occasions,
    );
    assert.equal(
      looks.filter((q) => q.lookLabel === "Dinner out").length,
      3,
    );
  });

  it("skips a repeated piece inside one look", () => {
    const qs = readingLookQueries(
      verdict({
        outfit_formulas: [
          {
            occasion: "Campus",
            formula: ["chambray workshirt", "Chambray Workshirt", "denim"],
            color_options: ["indigo"],
            footwear: ["sneakers"],
          },
        ],
      }),
    );
    const looks = qs.filter((q) => q.lookId === "look-0");
    assert.equal(looks.length, 3);
  });

  it("collapses colourway variants of the same garment", () => {
    assert.equal(
      productTitleKey("Tried & True Chambray Workshirt - Vintage Indigo"),
      "tried & true chambray workshirt",
    );
    const shirt = {
      id: "gid://shopify/Product/1",
      title: "Tried & True Chambray Workshirt - Vintage Indigo",
      imageUrl: "https://cdn.example/a.jpg",
      price: null,
    };
    const variant = {
      ...shirt,
      id: "gid://shopify/Product/2",
      title: "Tried & True Chambray Workshirt - Dark Wash",
    };
    assert.deepEqual(uniqueLookProducts([shirt, variant]), [shirt]);
    assert.equal(
      pickLookProduct([variant], new Set(["gid://shopify/Product/1"]), new Set([
        productTitleKey(shirt.title),
      ])),
      null,
    );
  });

  it("matches an add-step to the buy product", () => {
    const product = {
      id: "gid://shopify/Product/1",
      title: "Ink Overshirt",
      imageUrl: "https://cdn.example/o.jpg",
      price: null,
    };
    const hit = productForStep("Add one charcoal or ink unlined overshirt.", [
      {
        key: "buy:charcoal unlined overshirt",
        kind: "buy",
        query: "charcoal unlined overshirt",
        product,
      },
    ]);
    assert.equal(hit?.title, "Ink Overshirt");
  });

  it("retries a look query without the colour word", () => {
    assert.equal(
      fallbackLookQuery("ink navy substantial tee", "substantial tee"),
      "substantial tee",
    );
    assert.equal(fallbackLookQuery("substantial tee", "substantial tee"), null);
  });

  it("retries a face colour without the garment", () => {
    assert.equal(fallbackFaceQuery("neon crew neck", "crew neck"), "neon");
    assert.equal(fallbackFaceQuery("crew neck", "crew neck"), null);
  });

  it("keeps labeled look groups even when a look has no product", () => {
    const shirt = {
      id: "gid://shopify/Product/1",
      title: "Tee",
      imageUrl: "https://cdn.example/t.jpg",
      price: null,
      garment: "tee",
    };
    const trouser = {
      id: "gid://shopify/Product/2",
      title: "Trouser",
      imageUrl: "https://cdn.example/p.jpg",
      price: null,
      garment: "trousers",
    };
    const grouped = groupReadingLooks([
      {
        key: "look:0:0",
        kind: "look",
        query: "navy tee",
        lookId: "look-0",
        lookLabel: "Weekday studio",
        piece: "tee",
        product: shirt,
      },
      {
        key: "look:0:1",
        kind: "look",
        query: "navy trousers",
        lookId: "look-0",
        lookLabel: "Weekday studio",
        piece: "trousers",
        product: trouser,
      },
      {
        key: "look:1:0",
        kind: "look",
        query: "cream polo",
        lookId: "look-1",
        lookLabel: "Half look",
        piece: "polo",
        product: { ...shirt, id: "gid://shopify/Product/3", title: "Polo" },
      },
      {
        key: "look:2:0",
        kind: "look",
        query: "empty",
        lookId: "look-2",
        lookLabel: "Missed",
        piece: "coat",
        product: null,
      },
    ]);
    assert.equal(grouped.looks.length, 3);
    assert.equal(grouped.looks[0]?.label, "Weekday studio");
    assert.equal(grouped.looks[1]?.label, "Half look");
    assert.equal(grouped.looks[2]?.label, "Missed");
    assert.match(grouped.looks[0]?.formula ?? "", /tee/);
    assert.equal(grouped.droppedLookCount, 1);
  });

  it("emits no buy queries when wardrobe_plan is empty, even with a core playbook", () => {
    const qs = readingLookQueries(
      verdict({
        wardrobe_plan: {},
      }),
    );
    assert.equal(qs.some((q) => q.kind === "buy"), false);
    assert.equal(wardrobePlanHasBuys(verdict({ wardrobe_plan: {} })), false);
    assert.equal(wardrobePlanHasBuys(verdict()), true);
  });
});
