import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampFashionSearchPlan } from "./clamps";
import {
  buildDeterministicQueryVariants,
  allowedColorWordsFromBrief,
  extractStyleDescriptors,
} from "./deterministic-builder";
import {
  buildFallbackPlan,
  selectGarmentsForPlan,
} from "./fallback-plan";
import { PLANNER_RAW_DE4048B3 } from "../fixtures/planner-invalidity-de4048b3";
import { resolveFashionSearchPlan } from "./plan-from-brief";
import { repairSlotQueryVariants } from "./query-builder";
import { buildSearchPlannerPrompt } from "./prompt";
import { parsePlanSearchInput } from "./tool-schema";
import type { FashionSearchPlan } from "./types";
import {
  assertVariantShape,
  containsBannedToken,
  stripBannedTokens,
  tokenOverlapRatio,
  validateSlotQueryVariants,
} from "./validator";

const sampleBrief = {
  recipient_person_id: "abcd",
  request_type: "single_item" as const,
  garments: ["shirt"],
  occasion_context: "work_consultant",
  quantity_hint: "one",
  must_haves: ["linen", "black"],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "Minimal smart-casual office shirts.",
  color_direction: { source: "stated" as const, stated_colors: ["black"] },
  knowledge_state: {
    department: "mens" as const,
    sizes_confirmed: ["shirt"],
    sizes_unconfirmed: [] as string[],
  },
};

describe("buildSearchPlannerPrompt", () => {
  it("includes verbatim planner instructions", () => {
    const prompt = buildSearchPlannerPrompt();
    assert.match(prompt, /You are the search planner for Shoop/);
    assert.match(prompt, /Call plan_search exactly once/);
    assert.match(prompt, /BANNED from every query string/);
    assert.match(prompt, /department word MUST be[\s\S]*FIRST token/i);
    assert.match(prompt, /OPTIONS_WANTED \(mandatory per slot\)/);
    assert.match(prompt, /Look counts are NOT per-slot/);
    assert.match(prompt, /4–5 variants ordered BEST/);
  });
});

describe("query variant validator", () => {
  it("strips banned size and occasion tokens", () => {
    const result = validateSlotQueryVariants({
      variants: [
        "medium oxford shirt for work",
        "slim cotton shirt",
        "minimal formal shirt",
        "premium poplin shirt",
      ],
      allowedColorWords: [],
    });
    assert.equal(result.ok, true);
    assert.equal(result.variants.some((v) => v.includes("medium")), false);
    assert.equal(result.variants.some((v) => v.includes("work")), false);
  });

  it("rejects outfit and quantity words", () => {
    assert.equal(containsBannedToken("work outfit shirt"), true);
    assert.equal(containsBannedToken("two shirts slim"), true);
    const stripped = stripBannedTokens("two slim shirts for work outfit");
    assert.equal(stripped.includes("outfit"), false);
    assert.equal(stripped.includes("two"), false);
  });

  it("rejects variant sets with >60% token overlap", () => {
    assert.ok(
      tokenOverlapRatio("slim oxford shirt", "slim oxford cotton shirt") > 0.6,
    );
    const result = validateSlotQueryVariants({
      variants: ["slim oxford shirt", "slim oxford cotton shirt"],
      allowedColorWords: [],
    });
    assert.equal(result.ok, false);
  });

  it("allows color in at most one variant", () => {
    const result = validateSlotQueryVariants({
      variants: [
        "black linen shirt",
        "slim cotton shirt",
        "minimal formal shirt",
        "premium poplin shirt",
      ],
      paletteSource: "stated",
      allowedColorWords: ["black"],
    });
    assert.equal(result.ok, true);
    assert.equal(
      result.variants.filter((v) => colorWords(v).length > 0).length,
      1,
    );
  });

  it("strips color from all variants when every variant is color-heavy", () => {
    const result = validateSlotQueryVariants({
      variants: [
        "black linen shirt",
        "navy cotton shirt",
        "slim formal shirt",
        "premium poplin shirt",
      ],
      paletteSource: "stated",
      allowedColorWords: ["black", "navy"],
    });
    assert.equal(result.ok, true);
    assert.equal(
      result.variants.filter((v) => colorWords(v).length > 0).length,
      1,
    );
  });
});

function colorWords(query: string): string[] {
  return query
    .split(/\s+/)
    .filter((t) =>
      ["black", "white", "navy", "blue", "red", "green"].includes(t.toLowerCase()),
    );
}

describe("deterministic fallback builder", () => {
  it("emits four or five diverse fallback variants", () => {
    const descriptors = extractStyleDescriptors(
      "slim minimalist oxford shirts, plain texture",
      2,
    );
    assert.equal(descriptors.length, 2);

    const variants = buildDeterministicQueryVariants({
      garment: "shirt",
      styleDirection: "slim minimalist oxford shirts, plain texture",
      mustHaves: ["linen"],
      includeColor: false,
    });

    assert.ok(variants.length >= 4);
    assert.match(variants[0]!, /shirt$/);
    assert.match(variants[0]!, /slim/);
    assert.ok(variants.some((v) => /linen shirt/.test(v)));
  });

  it("puts color in at most one fallback variant", () => {
    const variants = buildDeterministicQueryVariants({
      garment: "shirt",
      styleDirection: sampleBrief.style_direction,
      mustHaves: sampleBrief.must_haves,
      includeColor: true,
    });
    assert.equal(
      variants.filter((v) => v.includes("black")).length,
      1,
    );
  });

  it("extracts allowed colors from brief must_haves", () => {
    assert.deepEqual(allowedColorWordsFromBrief(sampleBrief), ["black"]);
  });
});

describe("repairSlotQueryVariants", () => {
  it("replaces invalid planner output with deterministic fallback", () => {
    const plan: FashionSearchPlan = {
      version: 1,
      mode: "single_item",
      reasoning: "test",
      brief: sampleBrief,
      currentDate: "2026-07-08",
      slots: [],
    };
    const { slot: repaired } = repairSlotQueryVariants(
      {
        slot_id: "shirt",
        garment: "shirt",
        role: "anchor",
        style_direction: "slim minimalist oxford shirts",
        palette_constraint: "neutrals",
        palette_source: "stated" as const,
        options_wanted: 4,
        query_variants: [
          "medium shirt for work outfit",
          "slim shirt for work outfit",
        ],
      },
      plan,
    );
    assert.ok(repaired.query_variants.length >= 4);
    assert.ok(
      repaired.query_variants.every((v) => !containsBannedToken(v)),
    );
  });
});

describe("plan clamps", () => {
  it("enforces slot cap, options range, and variant count", () => {
    const raw: FashionSearchPlan = {
      version: 1,
      mode: "outfit",
      reasoning: "test",
      brief: sampleBrief,
      currentDate: "2026-07-08",
      slots: [
        {
          slot_id: "shirt",
          garment: "shirt",
          role: "support",
          style_direction: "slim shirts",
          palette_constraint: "neutrals",
          palette_source: "stated" as const,
          options_wanted: 12,
          query_variants: [
            "slim oxford shirt",
            "minimal cotton shirt",
            "formal poplin shirt",
            "classic dress shirt",
          ],
        },
        {
          slot_id: "trousers",
          garment: "trousers",
          role: "support",
          style_direction: "tailored trousers",
          palette_constraint: "neutrals",
          palette_source: "stated" as const,
          options_wanted: 3,
          query_variants: [
            "tailored wool trousers",
            "classic dress trousers",
            "formal flat front pants",
            "premium business trousers",
          ],
        },
      ],
    };

    const clamped = clampFashionSearchPlan(raw).plan;
    assert.ok(clamped.slots.length <= 12);
    assert.ok(clamped.slots.every((s) => s.options_wanted <= 8));
    assert.equal(
      clamped.slots.filter((s) => s.role === "anchor").length,
      1,
    );
    assert.ok(clamped.slots.every((s) => s.query_variants.length >= 4));
  });

  it("does not treat one outfit as options_wanted 1; drops shoe/shoes clone slots", () => {
    const raw: FashionSearchPlan = {
      version: 1,
      mode: "outfit",
      reasoning: "test",
      brief: {
        ...sampleBrief,
        request_type: "outfit",
        garments: ["top", "bottom", "shoe", "shoes"],
        quantity_hint: "one outfit",
        occasion_context: "beach sunset",
      },
      currentDate: "2026-08-17",
      slots: [
        {
          slot_id: "top",
          garment: "top",
          role: "anchor",
          style_direction: "relaxed top",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 1,
          query_variants: [
            "mens relaxed linen top",
            "mens cotton camp shirt",
            "mens open collar shirt",
            "mens breathable summer top",
          ],
        },
        {
          slot_id: "bottom",
          garment: "bottom",
          role: "support",
          style_direction: "easy pant",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 1,
          query_variants: [
            "mens relaxed linen pant",
            "mens cotton easy pant",
            "mens drawstring trouser",
            "mens summer chino",
          ],
        },
        {
          slot_id: "shoe",
          garment: "shoe",
          role: "support",
          style_direction: "trail sandal",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 1,
          query_variants: [
            "mens trail sandal",
            "mens leather sandal",
            "mens summer sandal",
            "mens casual slide",
          ],
        },
        {
          slot_id: "shoes",
          garment: "shoes",
          role: "support",
          style_direction: "trail sandal",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 1,
          query_variants: [
            "mens trail sandal",
            "mens leather sandal",
            "mens summer sandal",
            "mens casual slide",
          ],
        },
      ],
    };

    const clamped = clampFashionSearchPlan(raw).plan;
    assert.equal(clamped.slots.length, 3);
    assert.ok(!clamped.slots.some((s) => s.garment === "shoes"));
    assert.ok(clamped.slots.every((s) => s.options_wanted === 4));
  });
});

describe("plan_search tool schema", () => {
  it("parses planner tool output", () => {
    const parsed = parsePlanSearchInput({
      mode: "single_item",
      reasoning: "One shirt slot.",
      slots: [
        {
          slot_id: "shirt",
          garment: "shirt",
          role: "anchor",
          style_direction: "minimal oxford shirts",
          palette_constraint: "neutrals",
          palette_source: "stated" as const,
          options_wanted: 4,
          query_variants: [
            "slim oxford shirt",
            "minimal cotton shirt",
            "formal poplin shirt",
            "classic dress shirt",
          ],
        },
      ],
    });
    assert.equal(parsed?.mode, "single_item");
    assert.equal(parsed?.slots.length, 1);
  });
});

describe("fallback_decomposes_all_garments", () => {
  it("builds one slot per brief garment (not garments[0] only)", () => {
    const brief = {
      ...sampleBrief,
      request_type: "outfit" as const,
      garments: [
        "dress shirt",
        "blazer",
        "dress pants",
        "dress shoes",
        "tie",
      ],
      quantity_hint: "full formal outfit",
      style_direction:
        "Full formal business outfit with refined, polished pieces.",
      budget_context: { stated: true, max: 100, currency: "USD" },
      knowledge_state: {
        department: "mens" as const,
        sizes_confirmed: [] as string[],
        sizes_unconfirmed: [] as string[],
      },
    };
    const plan = buildFallbackPlan({
      brief,
      currentDate: "2026-07-10",
    });
    assert.equal(plan.mode, "outfit");
    assert.equal(plan.plan_source, "fallback");
    assert.equal(plan.slots.length, 5);
    assert.deepEqual(
      plan.slots.map((s) => s.garment),
      brief.garments,
    );
    assert.equal(plan.slots.filter((s) => s.role === "anchor").length, 1);
    assert.ok(plan.slots.every((s) => s.budget_fraction != null));
  });

  it("keeps shirt/trousers/shoes over tie when brief exceeds max 5", () => {
    const brief = {
      ...sampleBrief,
      request_type: "outfit" as const,
      garments: [
        "dress shirt",
        "blazer",
        "dress pants",
        "dress shoes",
        "tie",
        "belt",
      ],
      occasion_context: "business event",
    };
    const selected = selectGarmentsForPlan(brief.garments, 5);
    assert.equal(selected.length, 5);
    assert.ok(!selected.includes("tie") || !selected.includes("belt"));
    assert.ok(selected.some((g) => /shirt/i.test(g)));
    assert.ok(selected.some((g) => /pant|trouser/i.test(g)));
    assert.ok(selected.some((g) => /shoe/i.test(g)));
  });

  it("one outfit is not 1 option per slot; 6 shirts still is", () => {
    const outfit = buildFallbackPlan({
      brief: {
        ...sampleBrief,
        request_type: "outfit",
        garments: ["top", "bottom", "shoes"],
        quantity_hint: "one outfit",
        must_haves: [],
        occasion_context: "beach sunset",
      },
      currentDate: "2026-08-17",
    });
    assert.ok(outfit.slots.every((s) => s.options_wanted === 4));

    const sixShirts = buildFallbackPlan({
      brief: {
        ...sampleBrief,
        request_type: "single_item",
        garments: ["shirt"],
        quantity_hint: "show me 6 shirts",
        must_haves: ["6 shirts"],
      },
      currentDate: "2026-08-17",
    });
    assert.equal(sixShirts.slots[0]?.options_wanted, 6);

    const oneItem = buildFallbackPlan({
      brief: {
        ...sampleBrief,
        request_type: "single_item",
        garments: ["shirt"],
        quantity_hint: "one",
        must_haves: [],
      },
      currentDate: "2026-08-17",
    });
    assert.equal(oneItem.slots[0]?.options_wanted, 1);
  });
});

describe("invariants_fire_on_fallback_path", () => {
  it("expands mode outfit + 1 slot from any path to ≥2 slots", async () => {
    const brief = {
      ...sampleBrief,
      request_type: "outfit" as const,
      garments: ["dress shirt", "dress pants", "dress shoes"],
      occasion_context: "business event",
      style_direction: "Formal business outfit.",
      knowledge_state: {
        department: "mens" as const,
        sizes_confirmed: [] as string[],
        sizes_unconfirmed: [] as string[],
      },
    };
    const oneSlot: FashionSearchPlan = {
      version: 1,
      mode: "outfit",
      reasoning: "Collapsed.",
      brief,
      currentDate: "2026-07-10",
      plan_source: "fallback",
      slots: [
        {
          slot_id: "dress_shirt",
          garment: "dress shirt",
          role: "anchor",
          style_direction: brief.style_direction,
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 3,
          query_variants: [
            "mens formal dress shirt",
            "mens cotton dress shirt",
          ],
        },
      ],
    };

    const resolved = await resolveFashionSearchPlan({
      plan: oneSlot,
      planSource: "fallback",
    });
    assert.ok(resolved.slots.length >= 2);
    assert.equal(resolved.mode, "outfit");
    assert.equal(resolved.plan_source, "fallback");
  });
});

describe("full_token_banned", () => {
  it("strips full/outfit/look/capsule from deterministic variants", () => {
    assert.equal(containsBannedToken("full formal shirt"), true, "full");
    assert.equal(containsBannedToken("capsule shirt"), true, "capsule");
    assert.equal(containsBannedToken("head to toe shirt"), true, "head-to-toe");
    assert.equal(containsBannedToken("complete look shirt"), true, "complete look");
    assert.equal(
      containsBannedToken("mens formal business dress shirt"),
      false,
      "clean query",
    );
    const brief = {
      ...sampleBrief,
      request_type: "outfit" as const,
      garments: ["dress shirt", "dress pants", "dress shoes"],
      quantity_hint: "full formal outfit for a business event",
      style_direction:
        "Full formal business outfit with refined, polished pieces suitable for a professional event.",
      knowledge_state: {
        department: "mens" as const,
        sizes_confirmed: [] as string[],
        sizes_unconfirmed: [] as string[],
      },
    };
    const plan = buildFallbackPlan({ brief, currentDate: "2026-07-10" });
    for (const slot of plan.slots) {
      for (const variant of slot.query_variants) {
        assert.equal(
          /\bfull\b/i.test(variant),
          false,
          `variant leaked full: ${variant}`,
        );
        assert.equal(/\boutfit\b/i.test(variant), false);
        assert.equal(/\blook\b/i.test(variant), false);
      }
    }
  });
});

describe("planner_invalidity_regression", () => {
  it("accepts the de4048b3 planner output that max(500) previously rejected", () => {
    assert.equal(PLANNER_RAW_DE4048B3.reasoning.length, 501);
    const parsed = parsePlanSearchInput(PLANNER_RAW_DE4048B3);
    assert.ok(parsed, "valid 5-slot plan must parse");
    assert.equal(parsed!.mode, "outfit");
    assert.equal(parsed!.slots.length, 5);
    assert.ok(parsed!.slots.every((s) => s.budget_fraction != null));
  });
});

describe("variant_shape_assertion", () => {
  it("rejects garbled tokens and rebuilds via repair", () => {
    assert.equal(
      assertVariantShape({
        query: ",em cotto dress hirt",
        garment: "dress shirt",
        department: "mens",
      }).ok,
      false,
    );
    assert.equal(
      assertVariantShape({
        query: "mens cotton dress shirt",
        garment: "dress shirt",
        department: "mens",
      }).ok,
      true,
    );

    const result = validateSlotQueryVariants({
      variants: [",em cotto dress hirt", "mens formal dress shirt"],
      garment: "dress shirt",
      department: "mens",
      paletteSource: "spread",
    });
    assert.ok(result.shapeRejected?.length);
    assert.ok(
      result.variants.every((v) => !v.includes(",em")),
    );
  });
});
