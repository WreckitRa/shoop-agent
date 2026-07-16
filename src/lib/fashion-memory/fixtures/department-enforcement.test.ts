import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import { buildVariantFilterPlans } from "../catalog-search/category-hedge";
import { buildSlotCatalogFilters } from "../catalog-search/slot-filters";
import {
  composeSlotIntentString,
  dedupeIntentParts,
} from "../catalog-search/slot-intent";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import { applyHardDrops } from "../hard-drops/apply-hard-drops";
import type { FashionSearchBrief } from "../router/types";
import { scoreDepartmentConfirmed, scoreProduct } from "../scoring/components";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import {
  departmentFromRelation,
  ensureDepartmentQueryPrefix,
} from "../department";
import { validateSlotQueryVariants } from "../search-planner/validator";


function mensBlazerBrief(): FashionSearchBrief {
  return {
    recipient_person_id: "self",
    request_type: "single_item",
    garments: ["blazer"],
    occasion_context: "general",
    quantity_hint: "one",
    must_haves: ["linen", "lightweight"],
    nice_to_haves: ["elegant", "lightweight", "warm weather"],
    budget_context: { stated: false },
    style_direction: "lightweight linen blazer tailored elegant",
    department_scope: "mens",
    knowledge_state: {
      department: "mens",
      sizes_confirmed: ["blazer"],
      sizes_unconfirmed: [],
    },
  };
}

function womensBrief(): FashionSearchBrief {
  return {
    ...mensBlazerBrief(),
    department_scope: "womens",
    knowledge_state: {
      department: "womens",
      sizes_confirmed: ["blazer"],
      sizes_unconfirmed: [],
    },
  };
}

function boysHoodieBrief(): FashionSearchBrief {
  return {
    recipient_person_id: "kid",
    request_type: "single_item",
    garments: ["hoodie"],
    occasion_context: "general",
    quantity_hint: "one",
    must_haves: [],
    nice_to_haves: [],
    budget_context: { stated: false },
    style_direction: "casual hoodie",
    department_scope: "boys",
    knowledge_state: {
      department: "boys",
      sizes_confirmed: ["hoodie"],
      sizes_unconfirmed: [],
    },
  };
}

function product(
  id: string,
  overrides: Partial<FashionSlotCatalogProduct> & {
    raw?: CatalogProductSummary;
    attributes?: Array<{ name: string; value: string }>;
  } = {},
): FashionSlotCatalogProduct {
  const title = overrides.title ?? "Test Product";
  const attrs = overrides.attributes;
  const raw =
    overrides.raw ??
    ({
      id,
      title,
      ...(attrs?.length
        ? { metadata: { attributes: attrs } }
        : {}),
    } as CatalogProductSummary);
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title,
    variant_options: overrides.variant_options ?? [],
    image_urls: [],
    raw,
    normalized: overrides.normalized,
    price: overrides.price,
    taxonomy_category: overrides.taxonomy_category,
  };
}

const blazerSlot: FashionSearchPlanSlot = {
  slot_id: "blazer",
  garment: "blazer",
  role: "anchor",
  style_direction: "lightweight linen blazer tailored elegant",
  palette_constraint: null,
  palette_source: "spread",
  options_wanted: 4,
  query_variants: [
    "lightweight linen blazer",
    "tailored elegant blazer",
    "mens structured blazer refined",
    "mens classic navy blazer",
  ],
};

describe("department_query_prefix", () => {
  it("strips stacked mens+womens when enforcing womens", () => {
    assert.equal(
      ensureDepartmentQueryPrefix(
        "mens womens formal v-neck long dress vibrant jewel tones",
        "womens",
      ),
      "womens formal v-neck long dress vibrant jewel tones",
    );
  });

  it("strips opposite department when enforcing mens", () => {
    assert.equal(
      ensureDepartmentQueryPrefix("womens linen blazer", "mens"),
      "mens linen blazer",
    );
  });

  it("infers womens from mother/wife relations and mens from father/brother", () => {
    assert.equal(departmentFromRelation("mother"), "womens");
    assert.equal(departmentFromRelation("mom"), "womens");
    assert.equal(departmentFromRelation("wife"), "womens");
    assert.equal(departmentFromRelation("father"), "mens");
    assert.equal(departmentFromRelation("brother"), "mens");
    assert.equal(departmentFromRelation("self"), null);
    assert.equal(departmentFromRelation("friend"), null);
  });
});

describe("mens_blazer_no_womens_leak", () => {
  it("every query variant starts with mens; validator prepends when missing", () => {
    const result = validateSlotQueryVariants({
      variants: blazerSlot.query_variants,
      paletteSource: "spread",
      department: "mens",
    });
    assert.equal(result.ok, true);
    assert.ok(result.variants.length >= 4);
    for (const v of result.variants) {
      assert.equal(v.split(/\s+/)[0]?.toLowerCase(), "mens");
    }
    assert.ok(result.reasons.some((r) => r.startsWith("prepended_department:")));
  });

  it("Target gender [Male, Unisex] on filtered lanes only", () => {
    const brief = mensBlazerBrief();
    const profile = { countryCode: "US", currency: "USD", positiveSignals: [] };
    const plans = buildVariantFilterPlans({
      garment: "blazer",
      brief,
      profile,
      queries: ["mens linen blazer", "mens tailored blazer"],
    });
    assert.equal(plans[0]!.category_filtered, false);
    assert.equal(plans[0]!.filters.attributes, undefined);
    assert.equal(plans[1]!.category_filtered, true);
    assert.deepEqual(plans[1]!.filters.attributes, [
      { name: "Target gender", values: ["Male", "Unisex"] },
    ]);

    const filtered = buildSlotCatalogFilters({ brief, profile, garment: "blazer" });
    assert.deepEqual(filtered.attributes, [
      { name: "Target gender", values: ["Male", "Unisex"] },
    ]);
  });

  it("Women's Linen Blazer drops; unmarked Oversized Linen Blazer survives unknown + neutral score", () => {
    const brief = mensBlazerBrief();
    const womensTitle = product("w1", { title: "Women's Linen Blazer" });
    const unmarked = product("u1", { title: "Oversized Linen Blazer" });
    const result = applyHardDrops({
      slot: { slot_id: "blazer", garment: "blazer" },
      products: [womensTitle, unmarked],
      recipientFacts: [],
      brief,
    });
    assert.equal(result.dropped.length, 1);
    assert.equal(result.dropped[0]?.rule, "department_mismatch");
    assert.equal(result.survivors.length, 1);
    assert.equal(result.survivors[0]?.id, "u1");
    assert.ok(
      result.survivors[0]?.suspicions.some((s) => s.rule === "department_unknown"),
    );
    assert.equal(
      scoreDepartmentConfirmed({ product: unmarked, brief }),
      0,
    );
  });
});

describe("womens_dress_gendered_category", () => {
  it("Dresses taxonomy drops on mens search and survives on womens", () => {
    const dress = product("d1", {
      title: "Linen Midi",
      taxonomy_category: "gid://shopify/TaxonomyCategory/aa-1-4",
    });
    const mensDrop = applyHardDrops({
      slot: { slot_id: "blazer", garment: "blazer" },
      products: [dress],
      recipientFacts: [],
      brief: mensBlazerBrief(),
    });
    assert.equal(mensDrop.dropped[0]?.rule, "department_mismatch");
    assert.match(mensDrop.dropped[0]?.evidence ?? "", /category|taxonomy/i);

    const womensKeep = applyHardDrops({
      slot: { slot_id: "dress", garment: "dress" },
      products: [dress],
      recipientFacts: [],
      brief: womensBrief(),
    });
    assert.equal(womensKeep.survivors.length, 1);
    assert.equal(
      scoreDepartmentConfirmed({ product: dress, brief: womensBrief() }),
      1,
    );
  });
});

describe("kids_hoodie_query_word", () => {
  it("boys variants start with boys; no Target gender filter; adult age group drops", () => {
    const result = validateSlotQueryVariants({
      variants: ["casual cotton hoodie", "soft fleece hoodie"],
      paletteSource: "spread",
      department: "boys",
    });
    for (const v of result.variants) {
      assert.equal(v.split(/\s+/)[0]?.toLowerCase(), "boys");
    }

    const brief = boysHoodieBrief();
    const profile = { countryCode: "US", currency: "USD", positiveSignals: [] };
    const plans = buildVariantFilterPlans({
      garment: "hoodie",
      brief,
      profile,
      queries: ["boys casual hoodie", "boys soft fleece hoodie"],
    });
    for (const plan of plans) {
      assert.equal(plan.filters.attributes, undefined);
    }

    const adult = product("a1", {
      title: "Soft Fleece Hoodie",
      attributes: [{ name: "Age group", value: "Adult" }],
    });
    const drops = applyHardDrops({
      slot: { slot_id: "hoodie", garment: "hoodie" },
      products: [adult],
      recipientFacts: [],
      brief,
    });
    assert.equal(drops.dropped[0]?.rule, "department_mismatch");
    assert.match(drops.dropped[0]?.evidence ?? "", /Age group/i);
  });
});

describe("unisex_both_tokens", () => {
  it("Men Women Cotton Tee is not dropped on mens search (both-token unisex)", () => {
    const tee = product("t1", { title: "Men Women Cotton Tee" });
    const result = applyHardDrops({
      slot: { slot_id: "tee", garment: "tee" },
      products: [tee],
      recipientFacts: [],
      brief: mensBlazerBrief(),
    });
    assert.equal(result.survivors.length, 1);
    assert.equal(result.dropped.length, 0);
    assert.equal(
      scoreDepartmentConfirmed({ product: tee, brief: mensBlazerBrief() }),
      1,
    );
  });
});

describe("intent_dedupe", () => {
  it("dedupeIntentParts collapses overlapping phrases case-insensitively", () => {
    const joined = dedupeIntentParts([
      "elegant, lightweight",
      "Elegant",
      "lightweight, warm weather",
      "warm weather",
    ]);
    assert.equal(joined, "elegant, lightweight, warm weather");
    assert.equal((joined.match(/elegant/gi) ?? []).length, 1);
    assert.equal((joined.match(/lightweight/gi) ?? []).length, 1);
  });

  it("composeSlotIntentString does not repeat overlapping style/nice_to_have phrases", () => {
    const brief = mensBlazerBrief();
    brief.style_direction = "elegant, lightweight";
    brief.nice_to_haves = ["elegant", "lightweight", "warm weather"];
    const intent = composeSlotIntentString({
      slot: {
        ...blazerSlot,
        style_direction: "elegant, lightweight",
        palette_constraint: null,
      },
      brief,
      profile: { countryCode: "US", currency: "USD", positiveSignals: [] },
    });
    assert.equal((intent.match(/\belegant\b/gi) ?? []).length, 1);
    assert.equal((intent.match(/\blightweight\b/gi) ?? []).length, 1);
  });
});

describe("department scoring boost", () => {
  it("confirmed title token boosts; unknown stays 0 without sinking final via department", () => {
    const brief = mensBlazerBrief();
    const confirmed = product("c1", { title: "Mens Linen Blazer" });
    const unknown = product("u1", { title: "Oversized Linen Blazer" });
    assert.equal(scoreDepartmentConfirmed({ product: confirmed, brief }), 1);
    assert.equal(scoreDepartmentConfirmed({ product: unknown, brief }), 0);

    const score = scoreProduct({
      product: {
        ...unknown,
        suspicions: [
          {
            rule: "department_unknown",
            evidence: "no department signal",
            source_field: "department",
          },
        ],
      },
      slot: blazerSlot,
      brief,
      recipientFacts: [],
      bestRank: 0,
    });
    assert.equal(score.components.department_confirmed, 0);
    assert.equal(score.penalties_applied, 0);
  });
});
