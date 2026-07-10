import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import { applyHardDrops } from "../hard-drops/apply-hard-drops";
import { resolveDepartmentEvidence } from "../department";
import {
  resetShopDepartmentCacheForTests,
  setShopDepartmentIndexForTests,
  type ShopDepartmentRow,
} from "../shop-departments";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";

const SEED: ShopDepartmentRow[] = [
  {
    shop_gid: "domain:reddress.com",
    shop_domain: "reddress.com",
    department: "womens",
    confidence: "manual",
  },
  {
    shop_gid: "domain:nordstrom.com",
    shop_domain: "nordstrom.com",
    department: "mixed",
    confidence: "manual",
  },
];

function mensBrief(): FashionSearchBrief {
  return {
    recipient_person_id: "self",
    request_type: "single_item",
    garments: ["blazer"],
    occasion_context: "business",
    quantity_hint: "one",
    must_haves: [],
    nice_to_haves: [],
    budget_context: { stated: false },
    style_direction: "formal blazer",
    department_scope: "mens",
    knowledge_state: {
      department: "mens",
      sizes_confirmed: [],
      sizes_unconfirmed: [],
    },
  };
}

function product(
  id: string,
  opts: {
    title: string;
    shop_domain?: string;
  },
): FashionSlotCatalogProduct {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title: opts.title,
    variant_options: [],
    image_urls: [],
    shop_domain: opts.shop_domain,
    raw: { id, title: opts.title } as CatalogProductSummary,
  };
}

const slot: FashionSearchPlanSlot = {
  slot_id: "blazer",
  garment: "blazer",
  role: "anchor",
  style_direction: "formal",
  palette_constraint: null,
  palette_source: "spread",
  options_wanted: 4,
  query_variants: ["mens blazer"],
};

describe("womens_shop_dropped_in_mens_search", () => {
  beforeEach(() => {
    resetShopDepartmentCacheForTests();
    setShopDepartmentIndexForTests(SEED);
  });

  it("drops reddress.com products in a mens search via shop_map", () => {
    const evidence = resolveDepartmentEvidence(
      {
        title: "Satin Wrap Midi",
        shopDomain: "reddress.com",
      },
      "mens",
    );
    assert.equal(evidence.status, "mismatch");
    assert.equal(evidence.source, "shop_map");

    const result = applyHardDrops({
      slot,
      brief: mensBrief(),
      recipientFacts: [],
      products: [
        product("w1", {
          title: "Satin Wrap Midi",
          shop_domain: "reddress.com",
        }),
        product("m1", {
          title: "Mens Navy Blazer Structured",
          shop_domain: "bonobos.com",
        }),
      ],
      mode: "single_item",
    });

    assert.ok(result.dropped.some((d) => d.product_id === "w1"));
    assert.equal(
      result.dropped.find((d) => d.product_id === "w1")?.rule,
      "department_mismatch",
    );
    assert.ok(result.survivors.some((s) => s.id === "m1"));
  });

  it("lets mixed-shop unknown products survive", () => {
    const evidence = resolveDepartmentEvidence(
      {
        title: "Structured Jacket",
        shopDomain: "nordstrom.com",
      },
      "mens",
    );
    assert.equal(evidence.status, "unknown");

    const result = applyHardDrops({
      slot,
      brief: mensBrief(),
      recipientFacts: [],
      products: [
        product("x1", {
          title: "Structured Jacket",
          shop_domain: "nordstrom.com",
        }),
      ],
      mode: "single_item",
    });

    assert.ok(result.survivors.some((s) => s.id === "x1"));
    assert.ok(
      result.survivors
        .find((s) => s.id === "x1")!
        .suspicions.some((s) => s.rule === "department_unknown"),
    );
  });
});
