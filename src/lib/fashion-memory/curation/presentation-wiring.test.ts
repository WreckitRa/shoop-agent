import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSlotPool } from "../hydration/pool";
import {
  clearSearchPoolMemoryStore,
  loadSlotPool,
  saveSlotPool,
  setPoolStoreMode,
} from "../hydration/pool-persistence";
import type { HydratedCandidate } from "../hydration/types";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import { VERIFY_TTL_HOURS } from "../hydration/pool-lifecycle-config";
import { isHydrationStale, reverifyCandidate } from "../hydration/verify-staleness";
import { buildRefRegistry } from "./refs";
import { rankBenchForLook } from "./coherence-rank";
import { filterCapsuleSafeReplacements } from "./capsule-pairwise";
import {
  computeDegradation,
  passesMachineryGuard,
} from "./degradation";
import { buildRenderContract } from "./build-render-contract";
import {
  clearInteractionSignalDedup,
  setTestSignalCapture,
  writeInteractionSignal,
} from "./interaction-signals";
import type { FashionSearchPlan } from "../search-planner/types";
import type { FashionCurationPresentation } from "./types";
import { recomputeLookTotalFromPresentation } from "./search-context";

const USER = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
const SEARCH = "msg_search_1";

const brief: FashionSearchBrief = {
  recipient_person_id: "p1",
  request_type: "outfit",
  garments: ["shirt", "trousers"],
  occasion_context: "office",
  quantity_hint: "one",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "Smart office.",
};

const planSlot = (id: string, garment: string): FashionSearchPlanSlot => ({
  slot_id: id,
  garment,
  role: "anchor",
  style_direction: garment,
  palette_constraint: null,
  palette_source: "spread",
  options_wanted: 3,
  query_variants: [garment],
});

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
    title: `${slot} ${id}`,
    variant_options: [],
    price: { amount: price * 100, currency: "USD" },
    image_urls: [`https://example.com/${id}.jpg`],
    media_urls: [`https://example.com/${id}.jpg`],
    final_price: { amount: price * 100, currency: "USD" },
    size_status: "confirmed",
    hydrated_at: new Date().toISOString(),
    score: {
      final: 0.9,
      components: {} as HydratedCandidate["score"] extends infer S
        ? S extends { components: infer C }
          ? C
          : never
        : never,
    },
    ...overrides,
  } as HydratedCandidate;
}

function poolContext(slot: FashionSearchPlanSlot) {
  return {
    slot,
    brief,
    recipientFacts: [],
    accessToken: "token",
    traceId: "trace1",
  };
}

beforeEach(() => {
  setPoolStoreMode("memory");
  clearSearchPoolMemoryStore();
  clearInteractionSignalDedup();
  setTestSignalCapture(null);
});

describe("pool_survives_restart", () => {
  it("reloads pool from storage and backfills on death", async () => {
    const slot = planSlot("shirt", "shirt");
    const verified = [candidate("p1", "shirt", 80), candidate("p2", "shirt", 85)];
    const reserve = [candidate("p3", "shirt", 70), candidate("p4", "shirt", 75)];

    let hydrateCount = 0;
    const hydrateFn = async () => {
      hydrateCount += 1;
      const id = `p${2 + hydrateCount}`;
      return {
        outcome: "verified" as const,
        candidate: candidate(id, "shirt", 60 + hydrateCount),
      };
    };

    await saveSlotPool({
      searchId: SEARCH,
      slotId: "shirt",
      userId: USER,
      state: {
        verified,
        reserve,
        dead: [],
        vetoed: [],
        thin: false,
        target: 3,
        options_wanted: 3,
        shown_refs: [],
        recurate_count: 0,
        context: poolContext(slot),
      },
    });

    const loaded = await loadSlotPool({
      searchId: SEARCH,
      slotId: "shirt",
      userId: USER,
      hydrateFn,
    });
    assert.ok(loaded);
    assert.equal(loaded.verified.length, 2);

    await loaded.reportDeath("p1", "user_reject", "reject");
    await loaded.persist();

    const reloaded = await loadSlotPool({
      searchId: SEARCH,
      slotId: "shirt",
      userId: USER,
      hydrateFn,
    });
    assert.ok(reloaded);
    assert.equal(reloaded.verified.some((c) => c.id === "p1"), false);
    assert.ok(reloaded.verified.length >= 2);
    assert.ok(hydrateCount >= 1);
  });
});

describe("stale_promote_reverifies", () => {
  it("re-verifies at TTL+1h and offers next on death", async () => {
    const staleAt = new Date(
      Date.now() - (VERIFY_TTL_HOURS + 1) * 60 * 60 * 1000,
    ).toISOString();
    const stale = candidate("p1", "shirt", 80, { hydrated_at: staleAt });
    assert.equal(isHydrationStale(stale), true);

    let calls = 0;
    const result = await reverifyCandidate({
      candidate: stale,
      hydrateParams: {
        slot: planSlot("shirt", "shirt"),
        brief,
        recipientFacts: [],
        accessToken: "token",
      },
      hydrateFn: async () => {
        calls += 1;
        return {
          outcome: "death" as const,
          death: {
            product_id: "p1",
            cause: "size_out_of_stock",
            evidence: "gone",
          },
        };
      },
    });

    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.soldOut, true);
  });
});

describe("look_swap_coherent", () => {
  it("ranks bench against look anchor and recomputes total", () => {
    const shirtAnchor = candidate("s1", "shirt", 80, {
      normalized: { colors: { buckets: ["navy"] }, style_tags: ["classic"] },
    });
    const shirtAlt = candidate("s2", "shirt", 75, {
      normalized: { colors: { buckets: ["navy"] }, style_tags: ["classic"] },
    });
    const shirtOff = candidate("s3", "shirt", 70, {
      normalized: { colors: { buckets: ["red"] }, style_tags: ["sporty"] },
    });
    const trousers = candidate("t1", "trousers", 90, {
      normalized: { colors: { buckets: ["grey"] } },
    });

    const registry = buildRefRegistry({
      mode: "outfit",
      slots: [
        {
          slot_id: "shirt",
          planSlot: planSlot("shirt", "shirt"),
          verified: [shirtAnchor, shirtAlt, shirtOff],
        },
        {
          slot_id: "trousers",
          planSlot: planSlot("trousers", "trousers"),
          verified: [trousers],
        },
      ],
    });

    const refs = [...registry.keys()];
    const shirtRefs = refs.filter((r) => r.startsWith("shirt"));
    const anchorRef = shirtRefs[0]!;

    const ranked = rankBenchForLook({
      registry,
      slotId: "shirt",
      anchorRef,
      excludeRefs: new Set([anchorRef]),
    });

    assert.equal(ranked[0]?.ref, shirtRefs[1]);

    const curation: FashionCurationPresentation = {
      narration: { opening: "Office look." },
      tiers: {
        picks: [
          {
            ref: anchorRef,
            slot_id: "shirt",
            garment: "shirt",
            id: "s1",
            title: "Shirt",
            role: "anchor",
            stylist_line: "Anchor.",
            badges: [],
            score_rank: 1,
            displayPrice: { amount: 8000, currency: "USD" },
          },
          {
            ref: refs.find((r) => r.startsWith("trousers"))!,
            slot_id: "trousers",
            garment: "trousers",
            id: "t1",
            title: "Trousers",
            role: "support",
            stylist_line: "Trousers.",
            badges: [],
            score_rank: 1,
            displayPrice: { amount: 9000, currency: "USD" },
          },
        ],
        verified: [],
        unverified: [],
      },
      looks: [
        {
          name: "Look 1",
          item_refs: [anchorRef, refs.find((r) => r.startsWith("trousers"))!],
          total: 0,
        },
      ],
      meta: {
        mode: "outfit",
        thin_slots: [],
        brand_status: {},
        fallback: false,
      },
    };

    const total = recomputeLookTotalFromPresentation(curation.looks![0]!, {
      ...curation,
      version: 1,
    });
    assert.equal(total, 170);
  });
});

describe("capsule_swap_pairwise", () => {
  it("skips replacement failing pairwise vs remaining top", () => {
    const top1 = candidate("top1", "tops", 50);
    const top2 = candidate("top2", "tops", 55);
    const bottom = candidate("b1", "bottoms", 60);
    const orphanTop = candidate("topX", "tops", 45);

    const registry = buildRefRegistry({
      mode: "capsule",
      slots: [
        {
          slot_id: "tops",
          planSlot: planSlot("tops", "shirt"),
          verified: [top1, top2, orphanTop],
        },
        {
          slot_id: "bottoms",
          planSlot: planSlot("bottoms", "trousers"),
          verified: [bottom],
        },
      ],
    });

    const refs = [...registry.keys()];
    const top1Ref = refs.find((r) => r.startsWith("tops_1"))!;
    const top2Ref = refs.find((r) => r.startsWith("tops_2"))!;
    const orphanRef = refs.find((r) => r.startsWith("tops_3"))!;
    const bottomRef = refs.find((r) => r.startsWith("bottoms"))!;

    const plan: FashionSearchPlan = {
      version: 1,
      mode: "capsule",
      reasoning: "test",
      currentDate: "2026-07-13",
      brief: { ...brief, garments: ["shirt", "trousers"] },
      slots: [planSlot("tops", "shirt"), planSlot("bottoms", "trousers")],
    };

    const remaining = [top2Ref, bottomRef];
    const outfits = [
      { item_refs: [top1Ref, bottomRef] },
      { item_refs: [top2Ref, bottomRef] },
    ];

    const bench = [...registry.values()].filter((e) => e.slot_id === "tops");
    const safe = filterCapsuleSafeReplacements({
      candidates: bench,
      remainingRefs: remaining,
      capsuleOutfits: outfits,
      registry,
      plan,
    });

    assert.ok(!safe.some((e) => e.ref === orphanRef));
    assert.ok(safe.some((e) => e.ref === top1Ref) || safe.some((e) => e.ref === top2Ref));
  });
});

describe("show_more_exhaustion", () => {
  it("returns exhausted affordance without auto-search", async () => {
    const slot = planSlot("shirt", "shirt");
    await saveSlotPool({
      searchId: SEARCH,
      slotId: "shirt",
      userId: USER,
      state: {
        verified: [],
        reserve: [],
        dead: [],
        vetoed: [],
        thin: true,
        target: 3,
        options_wanted: 3,
        shown_refs: [],
        recurate_count: 0,
        context: poolContext(slot),
      },
    });

    const pool = await loadSlotPool({
      searchId: SEARCH,
      slotId: "shirt",
      userId: USER,
    });
    assert.ok(pool);
    assert.equal(pool.getOverflow().length, 0);
    assert.equal(pool.reserve.length, 0);

    const plan: FashionSearchPlan = {
      version: 1,
      mode: "single_item",
      reasoning: "t",
      currentDate: "2026-07-13",
      brief,
      slots: [slot],
    };
    const presentation: FashionCurationPresentation = {
      narration: { opening: "Done." },
      tiers: { picks: [], verified: [], unverified: [] },
      meta: { mode: "single_item", thin_slots: ["shirt"], brand_status: {}, fallback: false },
    };
    const render = buildRenderContract({
      presentation,
      plan,
      exhausted: true,
    });
    assert.equal(render.affordances.exhausted, true);
    assert.equal(render.affordances.suggest_new_search, true);
  });
});

describe("signal_map_complete", () => {
  it("writes mapped signals once; show-more writes none", async () => {
    const capture: Array<{
      interaction: string;
      ref: string;
      polarity: -1 | 1;
      confidence: number;
      source: string;
    }> = [];
    setTestSignalCapture(capture);

    const product = {
      id: "p1",
      title: "Shirt",
      catalogAttributes: [
        { name: "color", value: "navy" },
        { name: "style", value: "classic" },
      ],
    };

    const base = {
      userId: USER,
      searchId: SEARCH,
      ref: "shirt_1",
      product,
      occasionContext: "office",
    };

    await writeInteractionSignal({ ...base, interaction: "tier2_promote" });
    const countAfterFirst = capture.filter(
      (c) => c.interaction === "tier2_promote",
    ).length;
    await writeInteractionSignal({ ...base, interaction: "tier2_promote" });
    const countAfterDuplicate = capture.filter(
      (c) => c.interaction === "tier2_promote",
    ).length;
    assert.equal(countAfterDuplicate, countAfterFirst);

    await writeInteractionSignal({ ...base, interaction: "show_more" });
    await writeInteractionSignal({ ...base, interaction: "outbound_click" });

    const promoteWrites = capture.filter((c) => c.interaction === "tier2_promote");
    assert.ok(promoteWrites.length >= 1);
    assert.equal(promoteWrites[0]?.confidence, 0.4);

    const click = capture.find((c) => c.interaction === "outbound_click");
    assert.equal(click?.confidence, 0.7);

    assert.equal(capture.filter((c) => c.interaction === "show_more").length, 0);
  });
});

describe("degradation_fallback_line_and_recurate", () => {
  it("sets fallback degradation with stylist line; render allows recurate", () => {
    const plan: FashionSearchPlan = {
      version: 1,
      mode: "outfit",
      reasoning: "t",
      currentDate: "2026-07-13",
      brief,
      slots: [planSlot("shirt", "shirt")],
    };
    const presentation: FashionCurationPresentation = {
      narration: { opening: "Here are options." },
      tiers: {
        picks: [
          {
            ref: "shirt_1",
            slot_id: "shirt",
            garment: "shirt",
            id: "p1",
            title: "Shirt",
            role: "safe",
            stylist_line: "Clean.",
            badges: [],
            score_rank: 1,
          },
        ],
        verified: [],
        unverified: [],
      },
      meta: { mode: "outfit", thin_slots: [], brand_status: {}, fallback: true },
    };

    const degradation = computeDegradation({ presentation, plan });
    assert.equal(degradation.kind, "curation_fallback");
    assert.equal(degradation.action, "recurate");
    assert.equal(passesMachineryGuard(degradation.user_line), true);

    const render = buildRenderContract({ presentation, plan });
    assert.equal(render.affordances.can_recurate, true);
    assert.equal(render.narration.degradation.kind, "curation_fallback");

    const afterRecurate = buildRenderContract({
      presentation: { ...presentation, meta: { ...presentation.meta, fallback: false } },
      plan,
      recurateUsed: true,
    });
    assert.equal(afterRecurate.affordances.can_recurate, false);
  });
});

describe("invisible_hiccup_silent", () => {
  it("maps lane failure with full pools to degradation none", () => {
    const plan: FashionSearchPlan = {
      version: 1,
      mode: "outfit",
      reasoning: "t",
      currentDate: "2026-07-13",
      brief,
      slots: [planSlot("shirt", "shirt"), planSlot("trousers", "trousers")],
    };
    const presentation: FashionCurationPresentation = {
      narration: { opening: "Strong set." },
      tiers: {
        picks: [
          {
            ref: "shirt_1",
            slot_id: "shirt",
            garment: "shirt",
            id: "p1",
            title: "Shirt",
            role: "safe",
            stylist_line: "Clean.",
            badges: [],
            score_rank: 1,
          },
        ],
        verified: [],
        unverified: [],
      },
      meta: { mode: "outfit", thin_slots: [], brand_status: {}, fallback: false },
    };

    const degradation = computeDegradation({
      presentation,
      plan,
      invisibleHiccups: true,
    });
    assert.equal(degradation.kind, "none");
    assert.equal(degradation.user_line, "");
  });
});

describe("render_contract_shape", () => {
  it("matches frozen contract snapshot", () => {
    const plan: FashionSearchPlan = {
      version: 1,
      mode: "single_item",
      reasoning: "t",
      currentDate: "2026-07-13",
      brief,
      slots: [planSlot("shirt", "shirt")],
    };
    const presentation: FashionCurationPresentation = {
      narration: { opening: "Clean shirt picks." },
      tiers: {
        picks: [
          {
            ref: "shirt_1",
            slot_id: "shirt",
            garment: "shirt",
            id: "p1",
            title: "Oxford",
            role: "safe",
            stylist_line: "Crisp oxford.",
            badges: [],
            score_rank: 1,
            size_status: "confirmed",
          },
        ],
        verified: [],
        unverified: [
          {
            product_id: "p9",
            slot_id: "shirt",
            garment: "shirt",
            title: "Overflow",
            score_rank: 5,
            score_final: 0.5,
            verification: "not_verified",
          },
        ],
      },
      meta: { mode: "single_item", thin_slots: [], brand_status: {}, fallback: false },
    };

    const render = buildRenderContract({ presentation, plan });
    assert.equal(render.contract_version, 1);
    assert.deepEqual(Object.keys(render).sort(), [
      "affordances",
      "capsule_outfits",
      "contract_version",
      "looks",
      "meta",
      "narration",
      "tiers",
    ]);
    assert.equal(render.tiers.picks[0]?.badges.length, 0);
    assert.equal(render.tiers.unverified[0]?.verification, "not_verified");
    assert.equal(render.narration.degradation.kind, "none");
  });
});
