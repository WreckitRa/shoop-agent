import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRefRegistry } from "./refs";
import { dropRedundantLooks, validateCurationOutput } from "./validate";
import {
  buildDeterministicFallback,
  validateAndRepairFallback,
  synthesizeOutfitLooks,
} from "./fallback";
import { buildPresentationContract } from "./presentation";
import { buildCurationSystemPrompt } from "./prompt";
import { curationPickCap } from "./deliverables";
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
  it("keeps closest look when all exceed ceiling (tight budget salvage)", () => {
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
        constraint_type: "per_look",
        per_slot_allocated: {},
      },
    });

    assert.equal(validated.ok, true);
    assert.ok(validated.issues.some((i) => i.code === "look_over_budget"));
    assert.ok(validated.issues.some((i) => i.code === "look_over_budget_kept"));
    assert.equal(validated.output?.looks?.length, 1);
    assert.ok(validated.output?.narration.budget_note?.trim());
  });
});

describe("underfilled_slot_padded", () => {
  it("pads under-filled slots from pool and keeps live curation", () => {
    const pool = Array.from({ length: 6 }, (_, i) =>
      candidate(`p${i}`, "shirt", 40 + i),
    );
    const registry = registryFor(pool);
    const refs = [...registry.keys()];
    const output: DeliverCurationInput = {
      slots: [
        {
          slot_id: "shirt",
          picks: [
            { ref: refs[0]!, role: "safe", stylist_line: "Opus pick." },
          ],
        },
      ],
      vetoes: [],
      narration: { opening: "Partial rack." },
    };

    const validated = validateCurationOutput({
      output,
      registry,
      plan: {
        ...plan,
        slots: [{ ...plan.slots[0]!, options_wanted: 3 }],
      },
      slots: [{ slot_id: "shirt", garment: "shirt" }],
    });

    assert.equal(validated.ok, true);
    assert.ok(
      validated.issues.some((i) => i.code === "underfilled_slot_padded"),
    );
    assert.equal(validated.output?.slots[0]?.picks.length, 3);
    assert.equal(
      validated.issues.some((i) => i.code === "underfilled_slot"),
      false,
    );
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
      /\b(funnel|fit score|pipeline|curation|fallback)\b/i.test(
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
    // Live rack never includes unverified overflow (availability invariant).
    assert.equal(presentation.tiers.unverified.length, 0);
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
      depth: { picks: 4, looks: 1 },
    });
    assert.match(prompt, /You are Shoop's head stylist/);
    assert.match(prompt, /Call deliver_curation exactly once/);
    assert.match(prompt, /MODE: SINGLE ITEM/);
  });

  it("tells the curator not to pad outfit looks with clones", () => {
    const prompt = buildCurationSystemPrompt({
      mode: "outfit",
      department: "mens",
      occasion_context: "beach sunset",
      style_direction: "relaxed",
      depth: { picks: 3, looks: 3 },
    });
    assert.match(prompt, /never\s+repeat a combo/i);
    assert.doesNotMatch(prompt, /exactly 3 named looks/);
  });

  it("binds agreed depth into the mode section", () => {
    const prompt = buildCurationSystemPrompt({
      mode: "single_item",
      department: "mens",
      occasion_context: "office",
      style_direction: "minimal",
      depth: { picks: 5, looks: 1 },
    });
    assert.match(prompt, /exactly 5/);
    assert.equal(curationPickCap({
      mode: "single_item",
      brief: {
        recipient_person_id: "x",
        request_type: "single_item",
        garments: ["shirt"],
        occasion_context: "office",
        quantity_hint: "",
        must_haves: [],
        nice_to_haves: [],
        budget_context: { stated: false },
        style_direction: "minimal",
        depth: { options_per_item: 5, source: "stated" },
      },
    }), 5);
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
      /\b(funnel|fit score|verified options|pipeline|curation|fallback)\b/i;
    assert.equal(machinery.test(fallback.narration.opening), false);
    if (fallback.narration.thin_note) {
      assert.equal(machinery.test(fallback.narration.thin_note), false);
    }
  });
});

describe("fallback_validate_repairs_missing_budget_note", () => {
  it("repairs mandatory budget_note instead of shipping note-less output", () => {
    const registry = registryFor([
      candidate("p1", "shirt", 80),
      candidate("p2", "shirt", 70),
      candidate("p3", "shirt", 60),
      candidate("p4", "shirt", 50),
    ]);
    const raw = buildDeterministicFallback({
      plan,
      registry,
      thinSlots: [],
      // Intentionally omit budgetNote — validator requires it for per_item_assumed.
    });
    assert.equal(raw.narration.budget_note, undefined);

    const repaired = validateAndRepairFallback({
      output: raw,
      registry,
      plan,
      slots: [{ slot_id: "shirt", garment: "shirt" }],
      budget_interpretation: "per_item_assumed",
      budgetNote:
        "I'm treating your budget as a per-item ceiling unless you meant a total.",
    });

    assert.equal(repaired.degraded, false);
    assert.ok(
      repaired.output.narration.budget_note?.trim(),
      "budget_note must be present after repair",
    );
    assert.match(
      repaired.output.narration.budget_note!,
      /per-item ceiling/i,
    );
  });
});

describe("capsule_set_total_enforced", () => {
  it("swaps expensive picks deterministically and never rejects per-outfit combos", () => {
    const capsulePlan: FashionSearchPlan = {
      ...plan,
      mode: "capsule",
      brief: {
        ...plan.brief,
        request_type: "capsule",
        budget_context: { stated: true, max: 300, currency: "USD" },
      },
      slots: [
        {
          ...plan.slots[0]!,
          slot_id: "tops",
          garment: "shirt",
          options_wanted: 2,
        },
        {
          ...plan.slots[0]!,
          slot_id: "bottoms",
          garment: "trousers",
          options_wanted: 1,
        },
        {
          ...plan.slots[0]!,
          slot_id: "shoes",
          garment: "shoes",
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
          verified: [
            candidate("t1", "tops", 120),
            candidate("t2", "tops", 90),
            candidate("t3", "tops", 55),
          ],
        },
        {
          slot_id: "bottoms",
          planSlot: capsulePlan.slots[1]!,
          verified: [
            candidate("b1", "bottoms", 100),
            candidate("b2", "bottoms", 70),
          ],
        },
        {
          slot_id: "shoes",
          planSlot: capsulePlan.slots[2]!,
          verified: [
            candidate("s1", "shoes", 92),
            candidate("s2", "shoes", 60),
          ],
        },
      ],
    });

    const ref = (prefix: string) =>
      [...registry.keys()].find((r) => r.startsWith(prefix))!;

    const output: DeliverCurationInput = {
      slots: [
        {
          slot_id: "tops",
          picks: [
            { ref: ref("tops_1"), role: "anchor", stylist_line: "Top 1." },
            { ref: ref("tops_2"), role: "safe", stylist_line: "Top 2." },
          ],
        },
        {
          slot_id: "bottoms",
          picks: [{ ref: ref("bottoms_1"), role: "support", stylist_line: "Bottom." }],
        },
        {
          slot_id: "shoes",
          picks: [{ ref: ref("shoes_1"), role: "support", stylist_line: "Shoes." }],
        },
      ],
      capsule_outfits: [
        {
          item_refs: [ref("tops_1"), ref("bottoms_1"), ref("shoes_1")],
          label: "Look A",
        },
        {
          item_refs: [ref("tops_2"), ref("bottoms_1"), ref("shoes_1")],
          label: "Look B",
        },
      ],
      vetoes: [],
      narration: { opening: "Capsule set." },
    };

    const budgetAssembly = {
      total_max: 300,
      currency: "USD",
      tolerance: 0.1,
      constraint_type: "set_total" as const,
      per_slot_allocated: {},
    };

    const firstPass = validateCurationOutput({
      output,
      registry,
      plan: capsulePlan,
      slots: [
        { slot_id: "tops", garment: "shirt" },
        { slot_id: "bottoms", garment: "trousers" },
        { slot_id: "shoes", garment: "shoes" },
      ],
      budget_assembly: budgetAssembly,
    });
    assert.equal(firstPass.ok, false);
    assert.ok(firstPass.issues.some((i) => i.code === "set_over_budget"));

    const swapped = validateCurationOutput({
      output,
      registry,
      plan: capsulePlan,
      slots: [
        { slot_id: "tops", garment: "shirt" },
        { slot_id: "bottoms", garment: "trousers" },
        { slot_id: "shoes", garment: "shoes" },
      ],
      budget_assembly: budgetAssembly,
      deterministicBudgetSwap: true,
    });
    assert.equal(swapped.ok, true);
    assert.ok(
      swapped.issues.some((i) => i.code === "set_budget_swapped") ||
        recomputeSetTotal(swapped.output!, registry) <= 330,
    );
    assert.equal(
      swapped.issues.some((i) => i.code === "look_over_budget"),
      false,
    );
    assert.ok(recomputeSetTotal(swapped.output!, registry) <= 330);
    assert.equal(swapped.output?.capsule_outfits?.length, 2);
  });
});

describe("capsule_interpretation_narrated", () => {
  it("requires budget_note when set_total_assumed and validates narration clause", () => {
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
      narration: {
        opening: "Here is your capsule — $300 across all six pieces.",
        budget_note: "$300 covers the full set.",
      },
    };

    const capsulePlan: FashionSearchPlan = {
      ...plan,
      mode: "capsule",
      brief: {
        ...plan.brief,
        request_type: "capsule",
        budget_context: { stated: true, max: 300, currency: "USD" },
      },
    };

    const validated = validateCurationOutput({
      output,
      registry,
      plan: capsulePlan,
      slots: [{ slot_id: "shirt", garment: "shirt" }],
      budget_interpretation: "set_total_assumed",
      budget_tension: { severity: "none" },
    });
    assert.equal(validated.ok, true);
    assert.match(
      validated.output!.narration.opening,
      /\$300 across all six pieces/i,
    );
  });
});

function recomputeSetTotal(
  output: DeliverCurationInput,
  registry: ReturnType<typeof buildRefRegistry>,
): number {
  let total = 0;
  for (const slot of output.slots) {
    for (const pick of slot.picks) {
      const entry = registry.get(pick.ref);
      if (entry) {
        const price = entry.candidate.final_price ?? entry.candidate.price;
        total += (price?.amount ?? 0) / 100;
      }
    }
  }
  return Math.round(total * 100) / 100;
}

describe("outfit_looks_synthesized_when_stage_a_omits", () => {
  it("builds named looks from picks across slots (trace 2ace97ce shape)", () => {
    const outfitPlan: FashionSearchPlan = {
      ...plan,
      mode: "outfit",
      brief: {
        ...plan.brief,
        request_type: "outfit",
        garments: ["linen blazer", "dress pants", "shirt", "shoes"],
        occasion_context: "beach wedding",
      },
      slots: [
        {
          ...plan.slots[0]!,
          slot_id: "linen_blazer",
          garment: "linen blazer",
          role: "anchor",
          options_wanted: 3,
        },
        {
          ...plan.slots[0]!,
          slot_id: "dress_pants",
          garment: "dress pants",
          role: "support",
          options_wanted: 3,
        },
        {
          ...plan.slots[0]!,
          slot_id: "shirt",
          garment: "shirt",
          role: "support",
          options_wanted: 2,
        },
        {
          ...plan.slots[0]!,
          slot_id: "shoes",
          garment: "shoes",
          role: "support",
          options_wanted: 2,
        },
      ],
    };

    const registry = buildRefRegistry({
      mode: "outfit",
      slots: [
        {
          slot_id: "linen_blazer",
          planSlot: outfitPlan.slots[0]!,
          verified: [
            candidate("lb1", "linen_blazer", 120),
            candidate("lb2", "linen_blazer", 140),
            candidate("lb3", "linen_blazer", 100),
          ],
        },
        {
          slot_id: "dress_pants",
          planSlot: outfitPlan.slots[1]!,
          verified: [
            candidate("dp1", "dress_pants", 80),
            candidate("dp2", "dress_pants", 90),
            candidate("dp3", "dress_pants", 70),
          ],
        },
        {
          slot_id: "shirt",
          planSlot: outfitPlan.slots[2]!,
          verified: [
            candidate("sh1", "shirt", 50),
            candidate("sh2", "shirt", 55),
          ],
        },
        {
          slot_id: "shoes",
          planSlot: outfitPlan.slots[3]!,
          verified: [
            candidate("shoe1", "shoes", 100),
            candidate("shoe2", "shoes", 110),
          ],
        },
      ],
    });

    const bySlot = (slotId: string) =>
      [...registry.entries()]
        .filter(([, e]) => e.slot_id === slotId)
        .map(([ref]) => ref);

    const lb = bySlot("linen_blazer");
    const dp = bySlot("dress_pants");
    const sh = bySlot("shirt");
    const shoe = bySlot("shoes");

    // Stage A returned slots but no looks — same as 2ace97ce.
    const stageA: DeliverCurationInput = {
      slots: [
        {
          slot_id: "linen_blazer",
          picks: lb.slice(0, 3).map((ref, i) => ({
            ref,
            role: i === 0 ? "anchor" : "safe",
            stylist_line: "See card.",
          })),
        },
        {
          slot_id: "dress_pants",
          picks: dp.slice(0, 3).map((ref) => ({
            ref,
            role: "support",
            stylist_line: "See card.",
          })),
        },
        {
          slot_id: "shirt",
          picks: sh.slice(0, 2).map((ref) => ({
            ref,
            role: "support",
            stylist_line: "See card.",
          })),
        },
        {
          slot_id: "shoes",
          picks: shoe.slice(0, 2).map((ref) => ({
            ref,
            role: "support",
            stylist_line: "See card.",
          })),
        },
      ],
      vetoes: [],
      narration: { opening: "Fitting room ready." },
    };

    assert.equal(stageA.looks?.length ?? 0, 0);

    const looks = synthesizeOutfitLooks({
      slots: stageA.slots,
      registry,
    });
    assert.ok(looks.length >= 2, `expected ≥2 looks, got ${looks.length}`);
    for (const look of looks) {
      assert.ok(look.item_refs.length >= 2);
      assert.ok(look.total > 0);
      assert.match(look.name, /^Look \d+$/);
    }

    const presentation = buildPresentationContract({
      output: { ...stageA, looks },
      registry,
      plan: outfitPlan,
      slots: outfitPlan.slots.map((s) => ({
        slot_id: s.slot_id,
        garment: s.garment,
      })),
      vetoedRefs: new Set(),
      lookMembership: new Map(
        looks.flatMap((l) =>
          l.item_refs.map((ref) => [ref, [l.name]] as [string, string[]]),
        ),
      ),
      fallback: false,
    });

    assert.equal(presentation.looks?.length, looks.length);
    assert.ok((presentation.looks?.length ?? 0) > 0);
  });
});

describe("outfit_looks_drop_duplicates", () => {
  it("drops clone + subset looks (cmsriozum0017k4xg4g6nm2h9)", () => {
    const outfitPlan: FashionSearchPlan = {
      ...plan,
      mode: "outfit",
      brief: {
        ...plan.brief,
        request_type: "outfit",
        garments: ["top", "bottom", "shoes"],
        quantity_hint: "one outfit",
      },
      slots: [
        { ...plan.slots[0]!, slot_id: "top", garment: "top", role: "anchor" },
        {
          ...plan.slots[0]!,
          slot_id: "bottom",
          garment: "bottom",
          role: "support",
        },
        {
          ...plan.slots[0]!,
          slot_id: "shoes",
          garment: "shoes",
          role: "support",
        },
      ],
    };
    const registry = buildRefRegistry({
      mode: "outfit",
      slots: [
        {
          slot_id: "top",
          planSlot: outfitPlan.slots[0]!,
          verified: [candidate("t1", "top", 80)],
        },
        {
          slot_id: "bottom",
          planSlot: outfitPlan.slots[1]!,
          verified: [candidate("b1", "bottom", 90)],
        },
        {
          slot_id: "shoes",
          planSlot: outfitPlan.slots[2]!,
          verified: [candidate("s1", "shoes", 70)],
        },
      ],
    });
    const top = [...registry.keys()].find((r) => r.startsWith("top"))!;
    const bottom = [...registry.keys()].find((r) => r.startsWith("bottom"))!;
    const shoe = [...registry.keys()].find((r) => r.startsWith("shoes"))!;

    const looks = dropRedundantLooks([
      { name: "Golden Hour Set", item_refs: [top, bottom, shoe], total: 240 },
      { name: "Quiet Coastal", item_refs: [top, bottom], total: 170 },
      { name: "Minimal Spread", item_refs: [top, bottom, shoe], total: 240 },
    ]);
    assert.equal(looks.length, 1);
    assert.equal(looks[0]?.name, "Golden Hour Set");

    const validated = validateCurationOutput({
      output: {
        slots: [
          {
            slot_id: "top",
            picks: [{ ref: top, role: "anchor", stylist_line: "Top." }],
          },
          {
            slot_id: "bottom",
            picks: [{ ref: bottom, role: "support", stylist_line: "Bottom." }],
          },
          {
            slot_id: "shoes",
            picks: [{ ref: shoe, role: "support", stylist_line: "Shoe." }],
          },
        ],
        looks: [
          { name: "Golden Hour Set", item_refs: [top, bottom, shoe], total: 240 },
          { name: "Quiet Coastal", item_refs: [top, bottom], total: 170 },
          { name: "Minimal Spread", item_refs: [top, bottom, shoe], total: 240 },
        ],
        vetoes: [],
        narration: { opening: "Three looks." },
      },
      registry,
      plan: outfitPlan,
      slots: [
        { slot_id: "top", garment: "top" },
        { slot_id: "bottom", garment: "bottom" },
        { slot_id: "shoes", garment: "shoes" },
      ],
    });
    assert.equal(validated.ok, true);
    assert.equal(validated.output?.looks?.length, 1);
    assert.ok(
      validated.issues.some((i) => i.code === "looks_redundant_dropped"),
    );
    assert.ok(validated.issues.some((i) => i.code === "looks_short"));
  });
});
