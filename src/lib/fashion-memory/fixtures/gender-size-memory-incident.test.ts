/**
 * Regression: cmsod35ly003810egqcy8ici8
 * — Man got mixed mens/womens finds (LLM brief department_scope=mixed +
 *   Lane A omitting Target gender).
 * — Shoe size re-asked across chats (size answers collapsed / mis-bucketed).
 * Live trace follow-up:
 * — Prior chat stated shoes:"<UNKNOWN>" → gate skipped ask.
 * — Meshki / VICI / Farm Rio women's shops survived mens hard-drops.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import { applyDurableDepartmentScope } from "../intake/durable-department";
import { mergeFashionFacts, fashionFactMergeKey } from "../intake/merge-facts";
import { normalizeSizeQuestionFields } from "../intake/normalize-size-questions";
import { flattenClarificationAnswers } from "../intake/apply-intake-reply";
import {
  hasSizeForBucket,
  missingSizeBucketsForGarments,
} from "../intake/identity-gate";
import {
  isUsableStatedSizeValue,
  sanitizeStatedSizes,
} from "../intake/usable-stated-size";
import { answeredGapsFromStatedFacts } from "../intake/clarification-dedup";
import { preferDepartmentKnownWhenGendered } from "../curation/department-rank";
import { applyHardDrops } from "../hard-drops/apply-hard-drops";
import { resetShopDepartmentCacheForTests } from "../shop-departments";
import type { FashionFactRow } from "../types";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";

function sizeFact(
  garment: string,
  label: string,
  id = garment,
): FashionFactRow {
  const now = new Date().toISOString();
  return {
    id,
    user_id: "u1",
    person_id: "self",
    fact_type: "size",
    garment_type: garment,
    value: { value: label, system: "alpha" },
    source_quote: null,
    status: "active",
    created_at: now,
    updated_at: now,
    superseded_by: null,
  };
}

function genderFact(presentation: "mens" | "womens"): FashionFactRow {
  const now = new Date().toISOString();
  return {
    id: "g1",
    user_id: "u1",
    person_id: "self",
    fact_type: "gender_presentation",
    garment_type: null,
    value: { presentation },
    source_quote: null,
    status: "active",
    created_at: now,
    updated_at: now,
    superseded_by: null,
  };
}

function brief(dept: FashionSearchBrief["department_scope"]): FashionSearchBrief {
  return {
    recipient_person_id: "self",
    request_type: "single_item",
    garments: ["sneakers"],
    occasion_context: "general",
    quantity_hint: "one",
    must_haves: [],
    nice_to_haves: [],
    budget_context: { stated: false },
    style_direction: "casual sneakers",
    department_scope: dept,
    knowledge_state: {
      department: dept ?? "mixed",
      sizes_confirmed: [],
      sizes_unconfirmed: ["sneakers"],
    },
  };
}

describe("gender-size-memory incident cmsod35ly003810egqcy8ici8", () => {
  it("mergeFashionFacts keeps shoes and tops as separate size facts", () => {
    const tops = sizeFact("tops", "L");
    const shoes = sizeFact("shoes", "10");
    const merged = mergeFashionFacts([tops], [shoes]);
    assert.equal(merged.length, 2);
    assert.equal(fashionFactMergeKey(tops), "size:tops");
    assert.equal(fashionFactMergeKey(shoes), "size:shoes");
    assert.ok(hasSizeForBucket(merged, "shoes"));
    assert.ok(hasSizeForBucket(merged, "tops"));
  });

  it("durable department overrides LLM mixed when self is mens", () => {
    const out = applyDurableDepartmentScope({
      brief: brief("mixed"),
      facts: [genderFact("mens")],
      person: { relation: "self" },
      profileHints: null,
      stated: null,
    });
    assert.equal(out.department_scope, "mens");
  });

  it("durable department overrides wrong womens when facts say mens", () => {
    const out = applyDurableDepartmentScope({
      brief: brief("womens"),
      facts: [genderFact("mens")],
      person: { relation: "self" },
      profileHints: {
        genderPresentation: "mens",
        sizeBuckets: new Set(),
        preferredName: null,
        sizeLines: [],
      },
      stated: null,
    });
    assert.equal(out.department_scope, "mens");
  });

  it("explicit this-turn Mix it keeps mixed", () => {
    const out = applyDurableDepartmentScope({
      brief: brief("mens"),
      facts: [genderFact("mens")],
      person: { relation: "self" },
      stated: { person_ref: "self", department: "mixed" },
    });
    assert.equal(out.department_scope, "mixed");
  });

  it("normalize shoe size questions onto size_shoes", () => {
    const q = normalizeSizeQuestionFields({
      text: "What's your shoe size?",
      gap: "size",
      field: "size",
    });
    assert.equal(q.field, "size_shoes");
    assert.equal(q.garment_type, "shoes");
  });

  it("flatten shoe size answers under size_shoes (not bare size)", () => {
    const flat = flattenClarificationAnswers(
      { "What's your shoe size?": { selected: ["10"] } },
      [
        {
          text: "What's your shoe size?",
          gap: "size",
          field: "size",
          quick_options: [{ id: "10", label: "10" }],
        },
      ],
    );
    assert.equal(flat.size_shoes, "10");
    assert.equal(flat["What's your shoe size?"], "10");
  });

  it("rejects shoes:<UNKNOWN> as stated size (prior investor chat)", () => {
    assert.equal(isUsableStatedSizeValue("<UNKNOWN>"), false);
    assert.equal(isUsableStatedSizeValue("UNKNOWN"), false);
    assert.equal(isUsableStatedSizeValue("11"), true);
    const sizes = sanitizeStatedSizes({
      tops: "XL",
      bottoms: "34",
      shoes: "<UNKNOWN>",
    });
    assert.deepEqual(sizes, { tops: "XL", bottoms: "34" });
    const answered = answeredGapsFromStatedFacts({
      person_ref: "#94cf",
      department: "mens",
      sizes: { tops: "XL", bottoms: "34", shoes: "<UNKNOWN>" },
    });
    assert.ok(
      answered.some((g) => g.gap === "size" && g.garment_type === "tops"),
    );
    assert.ok(
      !answered.some((g) => g.gap === "size" && g.garment_type === "shoes"),
    );
    const missing = missingSizeBucketsForGarments(
      [],
      ["shirt", "pants", "shoes"],
      null,
      "mens",
      {
        person_ref: "#94cf",
        sizes: { tops: "XL", bottoms: "34", shoes: "<UNKNOWN>" },
      },
    );
    assert.deepEqual(missing, ["shoes"]);
  });

  it("fallback ranking prefers known department over department_unknown", () => {
    const ranked = preferDepartmentKnownWhenGendered({
      brief: {
        ...brief("mens"),
        garments: ["blazer"],
      },
      candidates: [
        {
          id: "meshki",
          score: { final: 0.95 },
          suspicions: [
            {
              rule: "department_unknown",
              evidence: "no department signal",
              source_field: "department",
            },
          ],
        },
        {
          id: "bonobos",
          score: { final: 0.8 },
          suspicions: [],
        },
      ],
    });
    assert.equal(ranked[0]!.id, "bonobos");
    assert.equal(ranked[1]!.id, "meshki");
  });
});

describe("cmsod35 womens boutique shop map", () => {
  beforeEach(() => {
    resetShopDepartmentCacheForTests();
  });

  const mensBlazerBrief: FashionSearchBrief = {
    recipient_person_id: "self",
    request_type: "single_item",
    garments: ["blazer"],
    occasion_context: "business",
    quantity_hint: "one",
    must_haves: [],
    nice_to_haves: [],
    budget_context: { stated: false },
    style_direction: "blazer",
    department_scope: "mens",
    knowledge_state: {
      department: "mens",
      sizes_confirmed: [],
      sizes_unconfirmed: [],
    },
  };

  const slot: FashionSearchPlanSlot = {
    slot_id: "blazer",
    garment: "blazer",
    role: "anchor",
    style_direction: "blazer",
    palette_constraint: null,
    palette_source: "spread",
    options_wanted: 4,
    query_variants: ["mens blazer"],
  };

  function product(
    id: string,
    title: string,
    shop_domain: string,
  ): FashionSlotCatalogProduct {
    return {
      id,
      upid: id,
      matched_by: [0],
      matched_by_color_variant: false,
      title,
      variant_options: [],
      image_urls: [],
      shop_domain,
      raw: { id, title } as CatalogProductSummary,
    };
  }

  it("hard-drops Meshki / VICI / Farm Rio on mens search", () => {
    const result = applyHardDrops({
      slot,
      brief: mensBlazerBrief,
      recipientFacts: [],
      products: [
        product("1", "Asia Mixed Button Blazer - Ivory", "meshki.us"),
        product("2", "Bloom Story Floral Tapestry Blazer", "vicicollection.com"),
        product("3", "Sand Mystical Notched Lapel Blazer", "farmrio.com"),
        product("4", "Standards Pocketed Blazer", "bonobos.com"),
      ],
      mode: "single_item",
    });
    assert.equal(result.survivors.length, 1);
    assert.equal(result.survivors[0]!.id, "4");
    assert.equal(
      result.dropped.filter((d) => d.rule === "department_mismatch").length,
      3,
    );
  });
});
