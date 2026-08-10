import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import { checkItemType, resolveGarmentFamily } from "./item-type";

function product(id: string, title: string): FashionSlotCatalogProduct {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title,
    variant_options: [],
    image_urls: [],
    raw: { id, title } as CatalogProductSummary,
  };
}

const mensBrief: FashionSearchBrief = {
  recipient_person_id: "p1",
  request_type: "outfit",
  garments: ["blazer", "dress shirt", "dress pants", "dress shoes", "tie"],
  occasion_context: "business",
  quantity_hint: "outfit",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "formal",
  knowledge_state: {
    department: "mens",
    sizes_confirmed: [],
    sizes_unconfirmed: [],
  },
};

describe("resolveGarmentFamily head-noun heuristic", () => {
  const cases: Array<[string, string | null]> = [
    ["Mens Oxford Shirt", "top"],
    ["COTTON POPLIN SHIRT", "top"],
    ["Dark Emerald Crew Neck", "top"],
    ["Tie Dye Paisley Button Up Mens Short Sleeve Shirt (Black/White)", "top"],
    ["Ribbed+ Short Sleeve Button Down", "top"],
    ["DRESS PANT", "bottom"],
    ["OVERSIZED TAILORED SUITING SHORT", "bottom"],
    ["Rib Long Sleeve Split Hem Dress", "dress"],
    ["Modal High-Neck Open-Back Mini Dress in Matcha Green", "dress"],
    ["Suiting Blazer Vest", "outerwear"],
    ["CLASSIC FIT SUITING BLAZER", "outerwear"],
    ["Round Waxed Cotton Laces | Brown", "footwear_accessory"],
    ["Men's Classic No Show Sock | Black", "socks"],
    ["Franchise Slide Mens Sandals (Cool Grey/White)", "footwear"],
    ["Black Slippers", "footwear"],
    ["Mens Max Tie in Amber Satin", "neckwear"],
    ["Josh Bow Tie ~ Deep Sage Solid", "neckwear"],
    ["LOCKE WHITE", null],
    ["CRUZ BLACK", null],
  ];

  for (const [title, expected] of cases) {
    it(`${title} → ${expected ?? "unknown"}`, () => {
      const resolved = resolveGarmentFamily(title);
      assert.equal(resolved?.family ?? null, expected);
    });
  }
});

describe("resolveGarmentFamily swimwear", () => {
  const cases: Array<[string, string]> = [
    ["Bahamas One Piece", "swimwear"],
    ["Soleil One Piece With Removable Straps", "swimwear"],
    ["Classic Triangle Bikini Set", "swimwear"],
    ["High Waist Two Piece", "swimwear"],
    ["Mens Board Shorts Navy", "swimwear"],
  ];
  for (const [title, expected] of cases) {
    it(`${title} → ${expected}`, () => {
      assert.equal(resolveGarmentFamily(title)?.family, expected);
    });
  }
});

describe("checkItemType drops cross-family junk", () => {
  const drops: Array<[string, string, string]> = [
    ["dress shoes", "Round Waxed Cotton Laces | Brown", "item_type_mismatch"],
    ["dress shoes", "Men's Classic No Show Sock | Black", "item_type_mismatch"],
    ["dress shoes", "DRESS PANT", "item_type_mismatch"],
    [
      "dress shoes",
      "Modal High-Neck Open-Back Mini Dress in Matcha Green",
      "item_type_mismatch",
    ],
    ["dress shirt", "Rib Long Sleeve Split Hem Dress", "item_type_mismatch"],
    ["dress shirt", "DRESS PANT", "item_type_mismatch"],
    ["dress pants", "COTTON POPLIN SHIRT", "item_type_mismatch"],
    ["blazer", "Ribbed+ Short Sleeve Button Down", "item_type_mismatch"],
    // Casual footwear in a formal footwear slot.
    ["dress shoes", "Franchise Slide Mens Sandals", "item_type_mismatch"],
    ["dress shoes", "Black Slippers", "item_type_mismatch"],
    // Women's-coded footwear in a mens slot.
    [
      "dress shoes",
      "Emarra Black Suede Slingback Court Shoes",
      "department_mismatch",
    ],
    // Swim slot drops apparel + opposite construction.
    ["two-piece swimsuit", "CLASSIC FIT SUITING BLAZER", "item_type_mismatch"],
    [
      "two-piece swimsuit",
      "Bahamas One Piece",
      "item_type_mismatch",
    ],
    [
      "one-piece swimsuit",
      "Classic Triangle Bikini Set",
      "item_type_mismatch",
    ],
  ];

  for (const [garment, title, rule] of drops) {
    it(`${garment} slot drops "${title}" (${rule})`, () => {
      const drop = checkItemType(product("x", title), garment, mensBrief);
      assert.equal(drop?.rule, rule);
    });
  }
});

describe("checkItemType keeps on-family and unknown items", () => {
  const keeps: Array<[string, string]> = [
    ["blazer", "CLASSIC FIT SUITING BLAZER"],
    ["blazer", "Suiting Blazer Vest"],
    ["dress shirt", "Mens Oxford Shirt"],
    ["dress shirt", "COTTON POPLIN SHIRT"],
    ["dress shirt", "Dark Emerald Crew Neck"],
    ["dress pants", "DRESS PANT"],
    ["dress pants", "OVERSIZED TAILORED SUITING SHORT"],
    ["dress shoes", "CRUZ BLACK"],
    ["dress shoes", "LOCKE WHITE"],
    ["tie", "Mens Max Tie in Amber Satin"],
    // Tie-dye must not read as neckwear — it stays a shirt in a top slot.
    ["dress shirt", "Tie Dye Paisley Button Up Mens Short Sleeve Shirt"],
    ["two-piece swimsuit", "Classic Triangle Bikini Set"],
    ["one-piece swimsuit", "Bahamas One Piece"],
    // Generic swimsuit: both constructions OK; ambiguous titles survive.
    ["swimsuit", "Bahamas One Piece"],
    ["swimsuit", "Classic Triangle Bikini Set"],
    ["swimsuit", "Solid Black Swimsuit"],
  ];

  for (const [garment, title] of keeps) {
    it(`${garment} slot keeps "${title}"`, () => {
      const drop = checkItemType(product("x", title), garment, mensBrief);
      assert.equal(drop, null);
    });
  }
});

describe("checkItemType is department-aware", () => {
  it("womens slot keeps slingback court shoes", () => {
    const womensBrief: FashionSearchBrief = {
      ...mensBrief,
      knowledge_state: {
        department: "womens",
        sizes_confirmed: [],
        sizes_unconfirmed: [],
      },
    };
    const drop = checkItemType(
      product("x", "Emarra Black Suede Slingback Court Shoes"),
      "shoes",
      womensBrief,
    );
    // Footwear slot, non-formal, womens dept — slingback is on-brief here.
    assert.equal(drop, null);
  });
});
