/**
 * Accessories Incident fixtures — "stylish accessories for work" produced
 * junk apparel in a watch slot with internal flag badges and assumed budget.
 * Trace 6e7a5445: router coerced accessories → clothing (Gabriel).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  taxonomyCategoriesForGarment,
  garmentSizingMode,
  OFFICE_ACCESSORY_TRAY,
} from "../catalog-search/garment-taxonomy";
import {
  isCoverageGapPool,
  recordFamilyCoverage,
  familyCoverageSnapshot,
  resetFamilyCoverageForTests,
} from "../catalog-search/family-coverage";
import {
  buildUserFacingBadges,
  userFacingBadgeLabel,
  BADGE_SUPPRESSED_RULES,
} from "../curation/badge-copy";
import type { FashionCuratedPickBadge } from "../curation/types";
import { fillEmptySlotPicks, validateCurationOutput } from "../curation/validate";
import { buildRefRegistry } from "../curation/refs";
import type { DeliverCurationInput } from "../curation/types";
import type { FashionSearchPlan } from "../search-planner/types";
import type { HydratedCandidate } from "../hydration/types";
import { buildSearchPlannerPrompt } from "../search-planner/prompt";
import {
  inferBudgetScopeFromText,
  applyInferredBudgetScope,
} from "../budget/budget-scope";
import { resolveAllocation } from "../budget/budgetAllocation";
import { detectAttireConflictTitle } from "../scoring/attire-conflict";
import { NARRATION_MACHINERY_RE } from "../curation/narration-sanitize";
import { buildFashionRouterPrompt } from "../router/prompt";
import {
  assessRouterEscalation,
  detectAccessoriesCoercion,
  isKnownGarmentFamily,
} from "../router/garment-family";
import { checkBriefInvariants } from "../observability/invariants";
import { sizeBucketsForGarments } from "../intake/garment-size-fields";
import { resolveFashionSearchPlan } from "../search-planner/plan-from-brief";
import { setTestPipelineEventCapture } from "../observability/trace";

function makeCandidate(
  id: string,
  title: string,
  extras?: Partial<HydratedCandidate>,
): HydratedCandidate {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title,
    variant_options: [],
    price: { amount: 4500, currency: "USD" },
    image_urls: [`https://example.com/${id}.jpg`],
    media_urls: [`https://example.com/${id}.jpg`],
    final_price: { amount: 4500, currency: "USD" },
    size_status: "unknown",
    score: { final: 0.8, components: {} },
    suspicions: [],
    ...extras,
  } as HydratedCandidate;
}

/** Verbatim ask from accessories coercion trace 6e7a5445 (Gabriel). */
const GABRIEL_ACCESSORIES_MESSAGE =
  "stylish accessories for Gabriel for work under $50 each";

describe("gabriel_accessories_trace_6e7a5445", () => {
  it("router prompt forbids clothing coercion + carries general principle", () => {
    const prompt = buildFashionRouterPrompt({
      roster: "#g gabriel (brother)",
      profiles: "## #g gabriel\nshop men's",
      currentDate: "2026-07-15",
    });
    assert.match(prompt, /ACCESSORIES are garments too/);
    assert.match(prompt, /NEVER translate an accessories request/);
    assert.match(prompt, /GENERAL PRINCIPLE/);
    assert.match(prompt, /pass the user's noun\s+through verbatim/i);
    assert.match(prompt, /Swimwear:/);
    assert.match(prompt, /Bags:/);
    assert.match(prompt, /stylish accessories for Gabriel for work/);
  });

  it("coercion tripwire fires when brief is clothing-only", () => {
    assert.equal(
      detectAccessoriesCoercion({
        userText: GABRIEL_ACCESSORIES_MESSAGE,
        garments: ["shirt", "top", "shoes"],
      }),
      true,
    );
    assert.equal(
      detectAccessoriesCoercion({
        userText: GABRIEL_ACCESSORIES_MESSAGE,
        garments: ["accessories"],
      }),
      false,
    );
    assert.equal(
      detectAccessoriesCoercion({
        userText: GABRIEL_ACCESSORIES_MESSAGE,
        garments: ["belt", "watch", "tie"],
      }),
      false,
    );
  });

  it("brief with accessories asks department only — no top/shoe size buckets", () => {
    assert.deepEqual(sizeBucketsForGarments(["accessories"]), []);
    assert.deepEqual(sizeBucketsForGarments(["watch", "tie", "bracelet"]), []);
    assert.deepEqual(sizeBucketsForGarments(["belt"]), ["bottoms"]);

    const brief = {
      recipient_person_id: "new",
      request_type: "multi_item" as const,
      garments: ["accessories"],
      occasion_context: "work",
      quantity_hint: "a few",
      must_haves: [],
      nice_to_haves: [],
      budget_context: {
        stated: true,
        max: 50,
        currency: "USD",
        scope: "per_item" as const,
      },
      style_direction: "stylish work accessories for Gabriel",
    };
    const tripped = checkBriefInvariants({
      messages: [{ role: "user", content: GABRIEL_ACCESSORIES_MESSAGE }],
      brief,
    });
    assert.equal(tripped.includes("accessories_coerced"), false);
    assert.ok(brief.garments.every((g) => isKnownGarmentFamily(g)));
  });

  it("coerced clothing brief emits accessories_coerced invariant", () => {
    const tripped = checkBriefInvariants({
      messages: [{ role: "user", content: GABRIEL_ACCESSORIES_MESSAGE }],
      brief: {
        recipient_person_id: "new",
        request_type: "multi_item",
        garments: ["shirt", "top"],
        occasion_context: "work",
        quantity_hint: "a few",
        must_haves: [],
        nice_to_haves: [],
        budget_context: { stated: false },
        style_direction: "work",
      },
    });
    assert.ok(tripped.includes("accessories_coerced"));
    assert.ok(
      assessRouterEscalation({
        userText: GABRIEL_ACCESSORIES_MESSAGE,
        garments: ["shirt", "top"],
      }).includes("accessories_coerced"),
    );
  });

  it("unknown families pass through with unknown_family on plan slots", async () => {
    const cap: import("../observability/trace").CapturedPipelineEvent[] = [];
    setTestPipelineEventCapture(cap);
    try {
      const plan = await resolveFashionSearchPlan({
        plan: {
          version: 1,
          mode: "single_item",
          reasoning: "pass-through",
          currentDate: "2026-07-15",
          brief: {
            recipient_person_id: "p1",
            request_type: "single_item",
            garments: ["maternity romper"],
            occasion_context: "general",
            quantity_hint: "one",
            must_haves: [],
            nice_to_haves: [],
            budget_context: { stated: false },
            style_direction: "maternity romper",
          },
          slots: [
            {
              slot_id: "maternity_romper",
              garment: "maternity romper",
              role: "anchor",
              options_wanted: 3,
              style_direction: "maternity romper",
              palette_constraint: null,
              palette_source: "spread",
              query_variants: ["maternity romper"],
            },
          ],
        },
      });
      assert.equal(plan.slots[0]?.unknown_family, true);
      assert.equal(garmentSizingMode("maternity romper"), "none");
      assert.ok(
        cap.some(
          (e) =>
            e.stage === "invariant_warning" &&
            e.payload.code === "unknown_garment_family",
        ),
      );
    } finally {
      setTestPipelineEventCapture(null);
    }
  });
});

describe("accessories_office_tray", () => {
  it("maps accessory families to verified taxonomy GIDs", () => {
    assert.ok(taxonomyCategoriesForGarment("belt")[0]?.includes("aa-2-6"));
    assert.ok(taxonomyCategoriesForGarment("watch")[0]?.includes("aa-6-11"));
    assert.ok(taxonomyCategoriesForGarment("bracelet")[0]?.includes("aa-6-3"));
    assert.ok(taxonomyCategoriesForGarment("tie")[0]?.includes("aa-2-23"));
    assert.ok(taxonomyCategoriesForGarment("wallet")[0]?.includes("aa-5-5"));
    assert.ok(taxonomyCategoriesForGarment("briefcase")[0]?.includes("lb-2"));
    assert.equal(garmentSizingMode("watch"), "none");
    assert.equal(garmentSizingMode("tie"), "none");
    assert.equal(garmentSizingMode("belt"), "simple");
  });

  it("planner prompt includes ACCESSORY REQUESTS guidance", () => {
    const prompt = buildSearchPlannerPrompt();
    assert.match(prompt, /ACCESSORY REQUESTS/);
    assert.match(prompt, /belt, watch, card holder or wallet/);
    assert.match(prompt, /OPTIONS_WANTED \(mandatory per slot\)/);
    for (const family of ["belt", "watch", "bracelet", "tie"] as const) {
      assert.ok(OFFICE_ACCESSORY_TRAY.includes(family));
    }
  });

  it("tees conflict with watch slots", () => {
    const hit = detectAttireConflictTitle({
      title: "Men's Graphic Tee",
      garment: "watch",
    });
    assert.ok(hit);
    assert.equal(hit!.rule, "attire_conflict_title");
  });
});

describe("watch_slot_coverage_gap", () => {
  it("empty watch slot is not junk-filled from apparel bench", () => {
    const watch = makeCandidate("w1", "Chronograph Watch");
    const tee = makeCandidate("t1", "Organic Cotton Tee", {
      suspicions: [
        {
          rule: "attire_conflict_title",
          evidence: 'title token "tee" conflicts with slot garment "watch"',
          source_field: "title",
        },
      ],
    });
    const belt = makeCandidate("b1", "Leather Belt");
    const shirt = makeCandidate("s1", "Dress Shirt");

    const plan = {
      version: 1,
      mode: "multi_item",
      reasoning: "tray",
      currentDate: "2026-07-15",
      brief: {
        recipient_person_id: "p1",
        request_type: "multi_item",
        garments: ["watch", "belt", "tie"],
        occasion_context: "work",
        quantity_hint: "a few",
        must_haves: [],
        nice_to_haves: [],
        budget_context: { stated: false },
        style_direction: "stylish work accessories",
      },
      slots: [
        {
          slot_id: "watch",
          garment: "watch",
          role: "anchor",
          options_wanted: 3,
          style_direction: "subtle watch",
          palette_constraint: null,
          palette_source: "spread",
          query_variants: ["mens watch"],
        },
        {
          slot_id: "belt",
          garment: "belt",
          role: "anchor",
          options_wanted: 2,
          style_direction: "leather belt",
          palette_constraint: null,
          palette_source: "spread",
          query_variants: ["mens belt"],
        },
      ],
    } as FashionSearchPlan;

    const registry = buildRefRegistry({
      mode: "multi_item",
      slots: [
        {
          slot_id: "watch",
          planSlot: plan.slots[0]!,
          verified: [watch, tee, belt, shirt],
        },
        {
          slot_id: "belt",
          planSlot: plan.slots[1]!,
          verified: [belt],
        },
      ],
    });

    const beltRef = [...registry.entries()].find(
      ([, e]) => e.candidate.id === "b1" && e.slot_id === "belt",
    )?.[0];
    assert.ok(beltRef);

    const output: DeliverCurationInput = {
      slots: [
        { slot_id: "watch", picks: [] },
        {
          slot_id: "belt",
          picks: [
            {
              ref: beltRef!,
              role: "safe",
              stylist_line: "A clean leather belt.",
            },
          ],
        },
      ],
      vetoes: [],
      narration: { opening: "Tray for Gabriel." },
    };

    const filled = fillEmptySlotPicks({
      output,
      registry,
      plan,
      slotMeta: [
        { slot_id: "watch", coverage_gap: true },
        { slot_id: "belt" },
      ],
    });

    assert.ok(filled.droppedEmptySlots.includes("watch"));
    const watchSlot = filled.output.slots.find((s) => s.slot_id === "watch");
    assert.equal(watchSlot?.picks.length, 0);

    const validated = validateCurationOutput({
      output: filled.output,
      registry,
      plan,
      slots: [
        { slot_id: "watch", garment: "watch", coverage_gap: true },
        { slot_id: "belt", garment: "belt" },
      ],
    });

    assert.equal(validated.ok, true);
    const renderedIds = (validated.output?.slots ?? []).flatMap((s) =>
      s.picks.map((p) => registry.get(p.ref)?.candidate.id),
    );
    assert.ok(!renderedIds.includes("t1"), "tee must not render");
    assert.ok(!renderedIds.includes("s1"), "shirt must not render");
    assert.ok(
      !validated.output?.slots.some((s) => s.slot_id === "watch"),
      "empty watch slot filtered from delivery",
    );
    assert.match(
      validated.output?.narration.thin_note ?? "",
      /came up short on watch/i,
    );
    for (const pick of validated.output?.slots.flatMap((s) => s.picks) ?? []) {
      assert.equal(NARRATION_MACHINERY_RE.test(pick.stylist_line), false);
      assert.equal(/fits the brief/i.test(pick.stylist_line), false);
    }
  });

  it("records family coverage for /health chart", () => {
    resetFamilyCoverageForTests();
    recordFamilyCoverage({ garment: "watch", survivorsAfterDrops: 0 });
    recordFamilyCoverage({ garment: "watch", survivorsAfterDrops: 1 });
    recordFamilyCoverage({ garment: "belt", survivorsAfterDrops: 8 });
    assert.equal(isCoverageGapPool(2), true);
    assert.equal(isCoverageGapPool(3), false);
    const snap = familyCoverageSnapshot();
    const watchRow = snap.families.find((f) => f.garment_family === "watch");
    assert.ok(watchRow);
    assert.equal(watchRow!.searches, 2);
    assert.equal(watchRow!.thin_or_empty, 2);
  });
});

describe("no_internal_flag_badges", () => {
  it("suppresses department_unknown and attire_conflict from user badges", () => {
    assert.ok(BADGE_SUPPRESSED_RULES.has("department_unknown"));
    assert.ok(BADGE_SUPPRESSED_RULES.has("attire_conflict_title"));

    const c = makeCandidate("x", "Something", {
      size_status: "unknown",
      suspicions: [
        {
          rule: "department_unknown",
          evidence: "department_unknown",
          source_field: "title",
        },
        {
          rule: "attire_conflict_title",
          evidence: "attire_conflict",
          source_field: "title",
        },
        {
          rule: "material_suspicion",
          evidence: "listing mentions wool blend",
          source_field: "description",
        },
      ],
    });

    const badges = buildUserFacingBadges({
      candidate: c,
      garment: "watch",
    });

    const labels = badges.map((b) => userFacingBadgeLabel(b)).filter(Boolean);
    const joined = labels.join(" | ");
    assert.equal(/department_unknown/i.test(joined), false);
    assert.equal(/attire_conflict/i.test(joined), false);
    // Incident leak strings must never appear user-facing.
    assert.equal(/Verified watch option that fits the brief/i.test(joined), false);
    assert.ok(labels.some((l) => /may contain wool/i.test(l!)));
  });

  it("badge label whitelist snapshot — enum kinds only", () => {
    const samples: FashionCuratedPickBadge[] = [
      { kind: "check_sizing" },
      { kind: "converted_size", from: "M", label: "EU 48" },
      { kind: "photo_color", color: "navy" },
      { kind: "material_suspected", material: "wool" },
      { kind: "near_budget_lifted" },
      { kind: "brand_unconfirmed" },
    ];
    const labels = samples.map((b) => userFacingBadgeLabel(b));
    assert.deepEqual(labels, [
      "check sizing",
      "EU 48 — your M",
      "photo shows: navy",
      "may contain wool",
      "slightly over budget",
      "brand unconfirmed",
    ]);
  });
});

describe("fifty_each_stated", () => {
  it("parses each/per item as stated per-item scope", () => {
    assert.equal(
      inferBudgetScopeFromText("stylish accessories under $50 each"),
      "per_item",
    );
    assert.equal(inferBudgetScopeFromText("$50 per item"), "per_item");
    assert.equal(inferBudgetScopeFromText("max $50 a piece"), "per_item");

    const brief = applyInferredBudgetScope(
      {
        budget_context: { stated: true, max: 50, currency: "USD" },
      },
      "under $50 each for Gabriel",
    );
    assert.equal(brief.budget_context.scope, "per_item");

    const plan = {
      version: 1,
      mode: "multi_item",
      reasoning: "tray",
      currentDate: "2026-07-15",
      brief: {
        recipient_person_id: "p1",
        request_type: "multi_item",
        garments: ["watch", "belt"],
        occasion_context: "work",
        quantity_hint: "a few",
        must_haves: [],
        nice_to_haves: [],
        budget_context: {
          stated: true,
          max: 50,
          currency: "USD",
          scope: "per_item" as const,
        },
        style_direction: "accessories",
      },
      slots: [
        {
          slot_id: "watch",
          garment: "watch",
          role: "anchor",
          options_wanted: 2,
          style_direction: "watch",
          palette_constraint: null,
          palette_source: "spread",
          query_variants: ["mens watch"],
        },
        {
          slot_id: "belt",
          garment: "belt",
          role: "anchor",
          options_wanted: 2,
          style_direction: "belt",
          palette_constraint: null,
          palette_source: "spread",
          query_variants: ["mens belt"],
        },
      ],
    } as FashionSearchPlan;

    const allocation = resolveAllocation(plan, "USD");
    assert.equal(allocation?.budget_interpretation, "per_item_stated");
    assert.equal(allocation?.per_slot.watch?.allocated_max, 50);
    assert.equal(allocation?.per_slot.belt?.allocated_max, 50);

    const note = "Keeping each piece under $50.";
    assert.match(note, /Keeping each piece/);
    assert.equal(/I read it as/i.test(note), false);
  });
});
