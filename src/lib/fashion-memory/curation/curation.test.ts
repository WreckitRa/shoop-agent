import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRefRegistry } from "./refs";
import { validateCurationOutput } from "./validate";
import { buildDeterministicFallback } from "./fallback";
import { buildPresentationContract } from "./presentation";
import { buildCurationSystemPrompt } from "./prompt";
import { promotePick, rejectPick } from "./picks-actions";
import type { DeliverCurationInput } from "./types";
import type { HydratedCandidate } from "../hydration/types";
import type { FashionSearchPlan } from "../search-planner/types";

function candidate(
  id: string,
  slot: string,
  price: number,
  overrides: Partial<HydratedCandidate> = {},
): HydratedCandidate {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title: `${slot} product ${id}`,
    variant_options: [],
    price: { amount: price * 100, currency: "USD" },
    image_urls: [`https://example.com/${id}.jpg`],
    media_urls: [`https://example.com/${id}.jpg`],
    final_price: { amount: price * 100, currency: "USD" },
    size_status: "confirmed",
    score: { final: 0.9, components: {} as HydratedCandidate["score"] extends infer S ? S extends { components: infer C } ? C : never : never },
    ...overrides,
  } as HydratedCandidate;
}

const plan: FashionSearchPlan = {
  version: 1,
  mode: "single_item",
  reasoning: "test",
  currentDate: "2026-07-10",
  brief: {
    recipient_person_id: "p1",
    request_type: "single_item",
    garments: ["shirt"],
    occasion_context: "office",
    quantity_hint: "one",
    must_haves: [],
    nice_to_haves: [],
    budget_context: { stated: false },
    style_direction: "Minimal office shirts.",
  },
  slots: [
    {
      slot_id: "shirt",
      garment: "shirt",
      role: "anchor",
      style_direction: "slim oxford",
      palette_constraint: null,
      palette_source: "spread",
      options_wanted: 4,
      query_variants: ["mens oxford", "mens cotton shirt"],
    },
  ],
};

function registryFor(candidates: HydratedCandidate[]) {
  return buildRefRegistry({
    mode: "single_item",
    slots: [
      {
        slot_id: "shirt",
        planSlot: plan.slots[0]!,
        verified: candidates,
      },
    ],
  });
}

describe("veto_flow", () => {
  it("removes vetoed refs from presentation tiers", () => {
    const pool = [
      candidate("p1", "shirt", 80),
      candidate("p2", "shirt", 90),
      candidate("p3", "shirt", 70),
    ];
    const registry = registryFor(pool);
    const refs = [...registry.keys()];
    const output: DeliverCurationInput = {
      slots: [
        {
          slot_id: "shirt",
          picks: [{ ref: refs[0]!, role: "safe", stylist_line: "Clean oxford." }],
        },
      ],
      vetoes: [
        {
          ref: refs[1]!,
          reason: "wrong_item_type",
          evidence: "Image shows a dress not a shirt",
        },
      ],
      narration: { opening: "Here are your shirts." },
    };

    const validated = validateCurationOutput({
      output,
      registry,
      plan,
      slots: [{ slot_id: "shirt", garment: "shirt" }],
    });
    assert.equal(validated.ok, true);

    const vetoed = new Set([refs[1]!]);
    const presentation = buildPresentationContract({
      output: validated.output!,
      registry,
      plan,
      slots: [{ slot_id: "shirt", garment: "shirt" }],
      vetoedRefs: vetoed,
      lookMembership: new Map(),
      fallback: false,
    });

    assert.ok(presentation.tiers.picks.some((p) => p.ref === refs[0]));
    assert.equal(
      presentation.tiers.verified.some((v) => v.ref === refs[1]),
      false,
    );
    assert.equal(
      presentation.tiers.picks.some((p) => p.ref === refs[1]),
      false,
    );
  });
});

describe("veto_tripwire", () => {
  it("flags excessive veto rate above 20%", () => {
    const pool = Array.from({ length: 12 }, (_, i) =>
      candidate(`p${i}`, "shirt", 50 + i),
    );
    const registry = registryFor(pool);
    const refs = [...registry.keys()];
    const output: DeliverCurationInput = {
      slots: [{ slot_id: "shirt", picks: [] }],
      vetoes: refs.slice(0, 5).map((ref) => ({
        ref,
        reason: "wrong_item_type" as const,
        evidence: "Not a shirt",
      })),
      narration: { opening: "Thin pool after vetoes." },
    };

    const validated = validateCurationOutput({
      output,
      registry,
      plan,
      slots: [{ slot_id: "shirt", garment: "shirt" }],
    });
    assert.ok(
      validated.issues.some((i) => i.code === "veto_rate_excessive"),
    );
  });
});

describe("look_over_budget_dropped", () => {
  it("recomputes totals and drops over-budget looks", () => {
    const outfitPlan: FashionSearchPlan = {
      ...plan,
      mode: "outfit",
      brief: { ...plan.brief, request_type: "outfit" },
      slots: [
        { ...plan.slots[0]!, slot_id: "shirt", role: "support" },
        {
          ...plan.slots[0]!,
          slot_id: "trousers",
          garment: "trousers",
          role: "support",
        },
      ],
    };
    const pool = [
      candidate("s1", "shirt", 120),
      candidate("t1", "trousers", 150),
    ];
    const registry = buildRefRegistry({
      mode: "outfit",
      slots: [
        {
          slot_id: "shirt",
          planSlot: outfitPlan.slots[0]!,
          verified: [pool[0]!],
        },
        {
          slot_id: "trousers",
          planSlot: outfitPlan.slots[1]!,
          verified: [pool[1]!],
        },
      ],
    });
    const sRef = [...registry.keys()].find((r) => r.startsWith("shirt"))!;
    const tRef = [...registry.keys()].find((r) => r.startsWith("trousers"))!;

    const output: DeliverCurationInput = {
      slots: [],
      looks: [
        {
          name: "Office",
          item_refs: [sRef, tRef],
          total: 200,
        },
      ],
      vetoes: [],
      narration: { opening: "Looks" },
    };

    const validated = validateCurationOutput({
      output,
      registry,
      plan: outfitPlan,
      slots: [
        { slot_id: "shirt", garment: "shirt" },
        { slot_id: "trousers", garment: "trousers" },
      ],
      budget_assembly: {
        total_max: 200,
        currency: "USD",
        tolerance: 0.1,
        per_slot_allocated: {},
      },
    });

    assert.ok(validated.issues.some((i) => i.code === "look_over_budget"));
    assert.equal(validated.output?.looks?.length, 0);
  });
});

describe("mandatory_brand_note_missing", () => {
  it("fails validation when brand partial and no brand_note", () => {
    const registry = registryFor([candidate("p1", "shirt", 80)]);
    const ref = [...registry.keys()][0]!;
    const output: DeliverCurationInput = {
      slots: [
        {
          slot_id: "shirt",
          picks: [{ ref, role: "safe", stylist_line: "Good shirt." }],
        },
      ],
      vetoes: [],
      narration: { opening: "Shirts." },
    };

    const validated = validateCurationOutput({
      output,
      registry,
      plan,
      slots: [{ slot_id: "shirt", garment: "shirt", brand_status: "partial" }],
    });
    assert.equal(validated.ok, false);
    assert.ok(validated.issues.some((i) => i.code === "missing_brand_note"));
  });
});

describe("unknown_ref_stripped", () => {
  it("strips refs not in registry", () => {
    const registry = registryFor([candidate("p1", "shirt", 80)]);
    const goodRef = [...registry.keys()][0]!;
    const output: DeliverCurationInput = {
      slots: [
        {
          slot_id: "shirt",
          picks: [
            { ref: goodRef, role: "safe", stylist_line: "Good." },
            { ref: "fake_ref", role: "value", stylist_line: "Bad." },
          ],
        },
      ],
      vetoes: [],
      narration: { opening: "Hi" },
    };

    const validated = validateCurationOutput({
      output,
      registry,
      plan,
      slots: [{ slot_id: "shirt", garment: "shirt", thin_slot: true }],
    });
    assert.equal(validated.output?.slots[0]?.picks.length, 1);
    assert.equal(validated.output?.slots[0]?.picks[0]?.ref, goodRef);
  });
});

describe("fallback_after_two_failures", () => {
  it("deterministic fallback produces picks without throwing", () => {
    const registry = registryFor([
      candidate("p1", "shirt", 80),
      candidate("p2", "shirt", 90),
    ]);
    const fallback = buildDeterministicFallback({
      plan,
      registry,
      thinSlots: [],
    });
    assert.ok(fallback.slots[0]!.picks.length >= 2);
    assert.match(fallback.narration.opening, /strongest verified picks/i);
    assert.equal(
      /\b(funnel|fit score|pipeline|curation|fallback|slot)\b/i.test(
        fallback.narration.opening,
      ),
      false,
    );
  });
});

describe("three_tier_shape", () => {
  it("tiers are disjoint and vetoed absent", () => {
    const pool = [
      candidate("p1", "shirt", 80),
      candidate("p2", "shirt", 90),
      candidate("p3", "shirt", 70),
    ];
    const registry = registryFor(pool);
    const refs = [...registry.keys()];
    const output: DeliverCurationInput = {
      slots: [
        {
          slot_id: "shirt",
          picks: [{ ref: refs[0]!, role: "safe", stylist_line: "Pick one." }],
        },
      ],
      vetoes: [
        { ref: refs[2]!, reason: "quality_visual", evidence: "Poor photo" },
      ],
      narration: { opening: "Three tiers." },
    };

    const validated = validateCurationOutput({
      output,
      registry,
      plan,
      slots: [{ slot_id: "shirt", garment: "shirt" }],
    });

    const presentation = buildPresentationContract({
      output: validated.output!,
      registry,
      plan,
      slots: [
        {
          slot_id: "shirt",
          garment: "shirt",
          overflow_items: [
            {
              product_id: "u1",
              title: "Unverified shirt",
              score_rank: 99,
              score_final: 0.5,
              verification: "not_verified",
            },
          ],
        },
      ],
      vetoedRefs: new Set([refs[2]!]),
      lookMembership: new Map(),
      fallback: false,
    });

    const pickRefs = new Set(presentation.tiers.picks.map((p) => p.ref));
    const verifiedRefs = new Set(presentation.tiers.verified.map((v) => v.ref));
    for (const r of pickRefs) assert.equal(verifiedRefs.has(r), false);
    assert.equal(pickRefs.has(refs[2]!), false);
    assert.equal(verifiedRefs.has(refs[2]!), false);
    assert.ok(presentation.tiers.unverified.length >= 1);
  });
});

describe("promote_swap_signals", () => {
  it("promote moves verified item to picks tier", () => {
    const state = {
      narration: { opening: "Hi" },
      tiers: {
        picks: [
          {
            id: "p1",
            title: "Pick",
            ref: "shirt_1",
            slot_id: "shirt",
            garment: "shirt",
            role: "safe" as const,
            stylist_line: "A",
            badges: [],
            score_rank: 1,
          },
        ],
        verified: [
          {
            id: "p2",
            title: "Verified",
            ref: "shirt_2",
            slot_id: "shirt",
            garment: "shirt",
            score_rank: 2,
          },
        ],
        unverified: [],
      },
      meta: {
        mode: "single_item" as const,
        thin_slots: [],
        brand_status: {},
        fallback: false,
      },
    };

    const next = promotePick({ state, ref: "shirt_2", demotedRef: "shirt_1" });
    assert.ok(next.tiers.picks.some((p) => p.ref === "shirt_2"));
    assert.ok(next.tiers.verified.some((v) => v.ref === "shirt_1"));
  });
});

describe("corrected_color_flow", () => {
  it("presentation carries photo_color badge when corrected", () => {
    const pool = [
      candidate("p1", "shirt", 80, {
        normalized: {
          colors: { buckets: ["navy"], labels: ["navy"], via: "deterministic" },
        },
      }),
    ];
    const registry = registryFor(pool);
    const ref = [...registry.keys()][0]!;
    const output: DeliverCurationInput = {
      slots: [
        {
          slot_id: "shirt",
          picks: [
            {
              ref,
              role: "safe",
              stylist_line: "Soft blue oxford.",
              corrected_color: "light blue",
            },
          ],
        },
      ],
      vetoes: [],
      narration: { opening: "Color fix." },
    };

    const presentation = buildPresentationContract({
      output,
      registry,
      plan,
      slots: [{ slot_id: "shirt", garment: "shirt" }],
      vetoedRefs: new Set(),
      lookMembership: new Map(),
      fallback: false,
    });

    const pick = presentation.tiers.picks[0]!;
    assert.equal(pick.corrected_color, "light blue");
    assert.ok(pick.badges.some((b) => b.kind === "photo_color"));
  });
});

describe("curation prompt", () => {
  it("includes verbatim house rules skeleton", () => {
    const prompt = buildCurationSystemPrompt({
      mode: "single_item",
      department: "mens",
      occasion_context: "office",
      style_direction: "minimal",
      options_wanted: 4,
    });
    assert.match(prompt, /You are Shoop's head stylist/);
    assert.match(prompt, /Call deliver_curation exactly once/);
    assert.match(prompt, /MODE: SINGLE ITEM/);
  });
});

describe("capsule_pairwise_floor", () => {
  it("flags orphan bottom with no outfit pairing", () => {
    const capsulePlan: FashionSearchPlan = {
      ...plan,
      mode: "capsule",
      brief: { ...plan.brief, request_type: "capsule" },
      slots: [
        {
          ...plan.slots[0]!,
          slot_id: "tops",
          garment: "shirt",
          role: "anchor",
          options_wanted: 1,
        },
        {
          ...plan.slots[0]!,
          slot_id: "bottoms",
          garment: "trousers",
          role: "support",
          options_wanted: 1,
        },
      ],
    };
    const registry = buildRefRegistry({
      mode: "capsule",
      slots: [
        {
          slot_id: "tops",
          planSlot: capsulePlan.slots[0]!,
          verified: [candidate("t1", "tops", 60)],
        },
        {
          slot_id: "bottoms",
          planSlot: capsulePlan.slots[1]!,
          verified: [candidate("b1", "bottoms", 80)],
        },
      ],
    });
    const topRef = [...registry.keys()].find((r) => r.startsWith("tops"))!;
    const output: DeliverCurationInput = {
      slots: [
        {
          slot_id: "tops",
          picks: [{ ref: topRef, role: "anchor", stylist_line: "Top." }],
        },
        { slot_id: "bottoms", picks: [] },
      ],
      capsule_outfits: [],
      vetoes: [],
      narration: { opening: "Capsule." },
    };

    const validated = validateCurationOutput({
      output,
      registry,
      plan: capsulePlan,
      slots: [
        { slot_id: "tops", garment: "shirt" },
        { slot_id: "bottoms", garment: "trousers", thin_slot: true },
      ],
    });
    assert.ok(validated.issues.some((i) => i.code === "capsule_orphan"));
  });
});

describe("off_brief_not_picked", () => {
  it("accepts visibly_off_brief vetoes while spread fills from bench", () => {
    const pool = [
      candidate("p1", "shirt", 80),
      candidate("p2", "shirt", 85),
      candidate("p3", "shirt", 90),
    ];
    const registry = registryFor(pool);
    const refs = [...registry.keys()];
    const output: DeliverCurationInput = {
      slots: [
        {
          slot_id: "shirt",
          picks: [
            { ref: refs[0]!, role: "safe", stylist_line: "Office-ready." },
            { ref: refs[1]!, role: "value", stylist_line: "Smart value." },
          ],
        },
      ],
      vetoes: [
        {
          ref: refs[2]!,
          reason: "visibly_off_brief",
          evidence: "Beach print in office search",
        },
      ],
      narration: { opening: "Office shirts." },
    };

    const validated = validateCurationOutput({
      output,
      registry,
      plan,
      slots: [{ slot_id: "shirt", garment: "shirt" }],
    });
    assert.equal(validated.ok, true);
    assert.equal(validated.output?.vetoes.length, 1);
  });
});

describe("reject_pick", () => {
  it("swaps rejected pick with top verified from same slot", () => {
    const state = {
      narration: { opening: "Hi" },
      tiers: {
        picks: [
          {
            id: "p1",
            title: "Pick",
            ref: "shirt_1",
            slot_id: "shirt",
            garment: "shirt",
            role: "safe" as const,
            stylist_line: "A",
            badges: [],
            score_rank: 1,
          },
        ],
        verified: [
          {
            id: "p2",
            title: "Replacement",
            ref: "shirt_2",
            slot_id: "shirt",
            garment: "shirt",
            score_rank: 2,
          },
        ],
        unverified: [],
      },
      meta: {
        mode: "single_item" as const,
        thin_slots: [],
        brand_status: {},
        fallback: false,
      },
    };

    const { state: next, replacement } = rejectPick({
      state,
      ref: "shirt_1",
    });
    assert.equal(replacement?.ref, "shirt_2");
    assert.ok(next.tiers.picks.some((p) => p.ref === "shirt_2"));
    assert.equal(next.tiers.picks.some((p) => p.ref === "shirt_1"), false);
  });
});

describe("degraded_plan_thin_note", () => {
  it("requires thin_note and rejects fitting-room success over degraded outfit", () => {
    const outfitPlan: FashionSearchPlan = {
      ...plan,
      mode: "outfit",
      plan_source: "fallback",
      brief: {
        ...plan.brief,
        request_type: "outfit",
        garments: [
          "dress shirt",
          "blazer",
          "dress pants",
          "dress shoes",
          "tie",
        ],
        quantity_hint: "full formal outfit",
      },
      slots: [
        {
          slot_id: "dress_shirt",
          garment: "dress shirt",
          role: "anchor",
          style_direction: "formal",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 3,
          query_variants: ["mens dress shirt", "mens cotton dress shirt"],
        },
      ],
    };

    const candidates = [
      candidate("p1", "dress_shirt", 40),
      candidate("p2", "dress_shirt", 50),
      candidate("p3", "dress_shirt", 60),
    ];
    const registry = buildRefRegistry({
      mode: "outfit",
      slots: [
        {
          slot_id: "dress_shirt",
          planSlot: outfitPlan.slots[0]!,
          verified: candidates,
        },
      ],
    });
    const refs = [...registry.keys()];

    const bad = validateCurationOutput({
      output: {
        slots: [
          {
            slot_id: "dress_shirt",
            picks: [
              { ref: refs[0]!, role: "anchor", stylist_line: "Solid shirt." },
              { ref: refs[1]!, role: "stretch", stylist_line: "Stretch." },
              { ref: refs[2]!, role: "value", stylist_line: "Value." },
            ],
          },
        ],
        vetoes: [],
        narration: {
          opening:
            "Here's the fitting room — polished shirting for the event.",
        },
      },
      registry,
      plan: outfitPlan,
      slots: [{ slot_id: "dress_shirt", garment: "dress shirt" }],
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.issues.some((i) => i.code === "missing_thin_note"));
    assert.ok(bad.issues.some((i) => i.code === "degraded_success_opening"));

    const good = validateCurationOutput({
      output: {
        slots: [
          {
            slot_id: "dress_shirt",
            picks: [
              { ref: refs[0]!, role: "anchor", stylist_line: "Solid shirt." },
              { ref: refs[1]!, role: "stretch", stylist_line: "Stretch." },
              { ref: refs[2]!, role: "value", stylist_line: "Value." },
            ],
          },
        ],
        vetoes: [],
        narration: {
          opening:
            "I only locked the dress shirt this round — trousers and shoes still need a pass.",
          thin_note:
            "Brief asked for a full outfit; only the shirt slot was retrieved.",
        },
      },
      registry,
      plan: outfitPlan,
      slots: [{ slot_id: "dress_shirt", garment: "dress shirt" }],
    });
    assert.equal(good.ok, true);
  });
});

describe("fallback_respects_failed_attempt_vetoes", () => {
  it("excludes refs vetoed by an invalid Opus attempt from deterministic fallback", () => {
    const pool = [
      candidate("p1", "blazer", 80, { title: "Navy structured blazer" }),
      candidate("p2", "blazer", 70, { title: "Charcoal wool blazer" }),
      candidate("p3", "blazer", 95, {
        title: "BYLT Soft Air V-Neck T-Shirt",
      }),
    ];
    // Rank order in registry follows input order from buildRefRegistry.
    const registry = buildRefRegistry({
      mode: "single_item",
      slots: [
        {
          slot_id: "blazer",
          planSlot: {
            ...plan.slots[0]!,
            slot_id: "blazer",
            garment: "blazer",
            style_direction: "formal blazer",
          },
          verified: pool,
        },
      ],
    });
    const refs = [...registry.keys()];
    const teeRef = [...registry.values()].find((e) =>
      e.candidate.title.includes("T-Shirt"),
    )!.ref;

    // Simulated invalid Opus output: has a trustworthy veto but fails overall
    // (empty picks → would have triggered fallback before FIX 1).
    const invalidAttemptVetoes = [
      {
        ref: teeRef,
        reason: "wrong_item_type" as const,
        evidence:
          "image is a plain black BYLT v-neck t-shirt, not a blazer",
      },
    ];

    const verifiedIds = new Set(
      pool.filter((p) => p.id !== "p3").map((p) => p.id),
    );
    const fakePool = {
      verified: pool.filter((p) => verifiedIds.has(p.id)),
      reserve: [],
      dead: [
        {
          product_id: "p3",
          cause: "curator_veto:wrong_item_type",
          evidence: "Removed at curation",
          stage: "curation",
        },
      ],
      thin: false,
      reportDeath: async () => {},
      getOverflow: () => [],
    };

    const fallback = buildDeterministicFallback({
      plan: {
        ...plan,
        slots: [
          {
            ...plan.slots[0]!,
            slot_id: "blazer",
            garment: "blazer",
            style_direction: "formal blazer",
          },
        ],
      },
      registry,
      pools: new Map([["blazer", fakePool as never]]),
      vetoedRefs: new Set([teeRef]),
      harvestedVetoes: invalidAttemptVetoes,
      thinSlots: [],
    });

    assert.equal(
      fallback.slots[0]!.picks.some((p) => p.ref === teeRef),
      false,
      "vetoed t-shirt must not appear in fallback picks",
    );
    assert.ok(fallback.slots[0]!.picks.length >= 1);
    assert.ok(fallback.vetoes.some((v) => v.ref === teeRef));
    assert.equal(refs.includes(teeRef), true);
  });
});

describe("fallback_narration_no_machinery_words", () => {
  it("keeps fallback opening free of funnel/pipeline vocabulary", () => {
    const registry = registryFor([
      candidate("p1", "shirt", 80),
      candidate("p2", "shirt", 70),
    ]);
    const fallback = buildDeterministicFallback({
      plan,
      registry,
      thinSlots: [],
    });
    const machinery =
      /\b(funnel|fit score|verified options|pipeline|curation|fallback|slot)\b/i;
    assert.equal(machinery.test(fallback.narration.opening), false);
    if (fallback.narration.thin_note) {
      assert.equal(machinery.test(fallback.narration.thin_note), false);
    }
  });
});
