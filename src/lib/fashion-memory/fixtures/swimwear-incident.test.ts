/**
 * Swimwear incident — "beach swimsuits" then "2-piece" returned one-pieces
 * and blazers because swim was an unmapped pass-through family (no taxonomy
 * filter, no item-type exclusivity, lying rail headers from the brief alone).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import {
  hasGarmentTaxonomyMapping,
  taxonomyCategoriesForGarment,
} from "../catalog-search/garment-taxonomy";
import { dedupeProductsAcrossSlots } from "../catalog-search/dedupe";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { FashionSlotCatalogResult } from "../catalog-search/types";
import { applyHardDrops } from "../hard-drops/apply-hard-drops";
import { checkItemType, resolveGarmentFamily } from "../hard-drops/item-type";
import {
  displayGarmentFromSurvivors,
  refineSwimBriefGarments,
  resolveSwimSubtype,
} from "../hard-drops/swimwear";
import { buildFashionRouterPrompt } from "../router/prompt";
import {
  assessRouterEscalation,
  isCommonUnmappedFamily,
  isKnownGarmentFamily,
} from "../router/garment-family";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";

function product(
  id: string,
  title: string,
  taxonomy?: string,
): FashionSlotCatalogProduct {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title,
    variant_options: [],
    image_urls: [],
    taxonomy_category: taxonomy,
    raw: { id, title } as CatalogProductSummary,
  };
}

function beachBrief(garments: string[], mustHaves: string[] = []): FashionSearchBrief {
  return {
    recipient_person_id: "self",
    request_type: "single_item",
    garments,
    occasion_context: "beach",
    quantity_hint: "a few",
    must_haves: mustHaves,
    nice_to_haves: [],
    budget_context: { stated: false },
    style_direction: "beach swim",
    department_scope: "womens",
    knowledge_state: {
      department: "womens",
      sizes_confirmed: [],
      sizes_unconfirmed: [],
    },
  };
}

const POOL = [
  product("bikini-1", "Classic Triangle Bikini Set"),
  product("one-1", "Bahamas One Piece"),
  product("blazer-1", "CLASSIC FIT SUITING BLAZER"),
  product("ambiguous-1", "Solid Black Swimsuit"),
];

describe("swimwear_taxonomy_mapped", () => {
  it("maps generic + subtype swim garments to Shopify GIDs", () => {
    assert.equal(
      taxonomyCategoriesForGarment("swimsuit")[0],
      "gid://shopify/TaxonomyCategory/aa-1-20",
    );
    assert.equal(
      taxonomyCategoriesForGarment("two-piece swimsuit")[0],
      "gid://shopify/TaxonomyCategory/aa-1-20-6",
    );
    assert.equal(
      taxonomyCategoriesForGarment("one-piece swimsuit")[0],
      "gid://shopify/TaxonomyCategory/aa-1-20-22",
    );
    assert.equal(hasGarmentTaxonomyMapping("bikini"), true);
    assert.equal(isKnownGarmentFamily("swimsuit"), true);
    assert.equal(isCommonUnmappedFamily("swimsuit"), false);
  });

  it("no longer escalates mapped swim as unknown_family_common", () => {
    const reasons = assessRouterEscalation({
      userText: "2-piece swimsuits for the beach",
      garments: ["two-piece swimsuit"],
    });
    assert.ok(!reasons.includes("unknown_family_common"));
  });
});

describe("swimwear_two_piece_beach_hard_drops", () => {
  it("drops one-piece + blazer from a two-piece slot; keeps bikini", () => {
    const brief = beachBrief(["two-piece swimsuit"]);
    const slot: FashionSearchPlanSlot = {
      slot_id: "two-piece",
      garment: "two-piece swimsuit",
      role: "anchor",
      style_direction: "beach two-piece",
      palette_constraint: "",
      palette_source: "none",
      options_wanted: 4,
      query_variants: ["womens two piece swimsuit"],
    };
    const { survivors, dropped } = applyHardDrops({
      products: POOL,
      slot,
      brief,
      recipientFacts: [],
      mode: "single_item",
    });
    const titles = survivors.map((p) => p.title);
    assert.ok(titles.includes("Classic Triangle Bikini Set"));
    assert.ok(!titles.includes("Bahamas One Piece"));
    assert.ok(!titles.includes("CLASSIC FIT SUITING BLAZER"));
    assert.ok(
      dropped.some(
        (d) =>
          d.product_id === "one-1" && d.rule === "item_type_mismatch",
      ),
    );
    assert.ok(
      dropped.some(
        (d) =>
          d.product_id === "blazer-1" && d.rule === "item_type_mismatch",
      ),
    );
  });

  it("soft beach swimsuit does not invent one-/two-piece exclusivity", () => {
    const brief = beachBrief(["swimsuit"]);
    for (const title of [
      "Bahamas One Piece",
      "Classic Triangle Bikini Set",
      "Solid Black Swimsuit",
    ]) {
      assert.equal(
        checkItemType(product("x", title), "swimsuit", brief),
        null,
        `should keep ${title}`,
      );
    }
    assert.equal(
      checkItemType(
        product("x", "CLASSIC FIT SUITING BLAZER"),
        "swimsuit",
        brief,
      )?.rule,
      "item_type_mismatch",
    );
  });
});

describe("swimwear_brief_refinement", () => {
  it("upgrades generic swimsuit when must_haves name two-piece", () => {
    assert.deepEqual(
      refineSwimBriefGarments({
        garments: ["swimsuit"],
        mustHaves: ["2-piece"],
      }),
      ["two-piece swimsuit"],
    );
    assert.equal(resolveSwimSubtype("2-piece swimsuits"), "two_piece");
  });

  it("leaves soft beach garment alone without subtype must_haves", () => {
    assert.deepEqual(
      refineSwimBriefGarments({
        garments: ["swimsuit"],
        mustHaves: [],
      }),
      ["swimsuit"],
    );
  });
});

describe("swimwear_presentation_labels", () => {
  it("labels rails from survivor consensus when plan garment is generic", () => {
    assert.equal(
      displayGarmentFromSurvivors({
        planGarment: "swimsuit",
        survivorTitles: [
          "Classic Triangle Bikini Set",
          "High Waist Two Piece",
        ],
      }),
      "two-piece swimsuit",
    );
    assert.equal(
      displayGarmentFromSurvivors({
        planGarment: "two-piece swimsuit",
        survivorTitles: ["Classic Triangle Bikini Set"],
      }),
      "two-piece swimsuit",
    );
    assert.equal(
      displayGarmentFromSurvivors({
        planGarment: "swimsuit",
        survivorTitles: [],
      }),
      "swimsuit",
    );
  });
});

describe("swimwear_cross_slot_upid_dedupe", () => {
  it("keeps a UPID in the first slot only", () => {
    const shared = product("shared-1", "Classic Triangle Bikini Set");
    const slots: FashionSlotCatalogResult[] = [
      {
        slot_id: "a",
        garment: "bikini",
        products: [shared, product("a-only", "Other Bikini")],
        query_variants_used: [],
        counts: { unique_products: 2, per_variant: [2], reformulated: false },
        query_logs: [],
      },
      {
        slot_id: "b",
        garment: "swimsuit",
        products: [shared, product("b-only", "Solid Black Swimsuit")],
        query_variants_used: [],
        counts: { unique_products: 2, per_variant: [2], reformulated: false },
        query_logs: [],
      },
    ];
    const out = dedupeProductsAcrossSlots(slots);
    assert.equal(out[0]!.products.length, 2);
    assert.deepEqual(
      out[1]!.products.map((p) => p.id),
      ["b-only"],
    );
  });
});

describe("swimwear_router_prompt", () => {
  it("documents generic vs construction-preserving swim garments", () => {
    const prompt = buildFashionRouterPrompt({
      roster: "#self",
      profiles: "",
      currentDate: "2026-08-10",
    });
    assert.match(prompt, /do not\s+invent a subtype/i);
    assert.match(prompt, /two-piece swimsuit/);
    assert.match(prompt, /never reframe/i);
  });
});

describe("swimwear_family_resolution", () => {
  it("head-noun prefers swim over shorts/dress for swim titles", () => {
    assert.equal(resolveGarmentFamily("Mens Board Shorts")?.family, "swimwear");
    assert.equal(resolveGarmentFamily("Floral Swim Dress")?.family, "swimwear");
  });
});
