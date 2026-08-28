import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pickLookProduct,
  productForStep,
  productTitleKey,
  readingLookQueries,
  uniqueLookProducts,
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
  it("builds look and buy queries from the verdict, not palette swatches", () => {
    const qs = readingLookQueries(verdict());
    assert.equal(qs.some((q) => q.key.startsWith("palette:")), false);
    assert.ok(qs.some((q) => q.kind === "look" && /tee/i.test(q.query)));
    assert.ok(qs.some((q) => q.kind === "buy" && /overshirt/i.test(q.query)));
    assert.ok(qs.length <= 12);
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
});
