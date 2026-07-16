import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary, GetProductResult } from "@/lib/shopify/catalog";
import type { FashionSearchBrief } from "../router/types";
import type { FashionFactRow, FashionFactSizeValue } from "../types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import { buildSizeSelection } from "./build-size-selection";
import { hydrationTargetCount } from "./config";
import { hydrateCandidate } from "./hydrate-candidate";
import { createSlotPool } from "./pool";
import type { HydratedCandidate } from "./types";

const brief: FashionSearchBrief = {
  recipient_person_id: "p1",
  request_type: "single_item",
  garments: ["shirt"],
  occasion_context: "general",
  quantity_hint: "one",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "casual",
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shirt"],
    sizes_unconfirmed: [],
  },
};

function product(
  id: string,
  overrides: Partial<FashionSlotCatalogProduct> = {},
): FashionSlotCatalogProduct {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title: `Product ${id}`,
    variant_options: overrides.variant_options ?? [],
    image_urls: overrides.image_urls ?? [`https://cdn.example/${id}.jpg`],
    raw: { id, title: `Product ${id}` } as CatalogProductSummary,
    price: overrides.price ?? { amount: 5000, currency: "USD" },
    normalized: overrides.normalized,
    score: overrides.score ?? {
      final: 0.5,
      components: {
        shopify_rank: 0.5,
        corroboration: 0.5,
        size_confirmed: 0,
        rating: 0.5,
        palette: 0.5,
        department_confirmed: 0,
      },
      active_components: ["shopify_rank"],
      penalties_applied: 0,
      weights_version: "test",
    },
  };
}

const planSlot: FashionSearchPlanSlot = {
  slot_id: "shirt",
  garment: "shirt",
  role: "anchor",
  style_direction: "casual",
  palette_constraint: null,
  palette_source: "spread",
  options_wanted: 4,
  query_variants: ["mens shirt"],
};

const sizeFact: FashionFactRow = {
  id: "f1",
  user_id: "u1",
  person_id: "p1",
  fact_type: "size",
  garment_type: "tops",
  value: { system: "alpha", value: "M" },
  source_quote: null,
  status: "active",
  superseded_by: null,
  created_at: "",
  updated_at: "",
};

function verified(id: string): HydratedCandidate {
  return {
    ...product(id),
    size_status: "confirmed",
    media_urls: [],
  };
}

const sizedProduct = product("p1", {
  normalized: {
    colors: { buckets: [], status: "unknown" },
    sizes: [{ raw: "Medium", size: { alpha: "M" }, status: "resolved" }],
  },
});

describe("buildSizeSelection", () => {
  it("user M + labels Small/Medium/Large selects Medium", () => {
    const p = product("p1", {
      variant_options: [{ name: "Size", value: "Medium" }],
      normalized: {
        colors: { buckets: [], status: "unknown" },
        sizes: [
          { raw: "Small", size: { alpha: "S" }, status: "resolved" },
          { raw: "Medium", size: { alpha: "M" }, status: "resolved" },
          { raw: "Large", size: { alpha: "L" }, status: "resolved" },
        ],
      },
    });
    const sel = buildSizeSelection({
      product: p,
      garment: "shirt",
      brief,
      recipientSize: sizeFact.value as FashionFactSizeValue,
    });
    assert.equal(sel.hadSizeSelection, true);
    assert.deepEqual(sel.selected, [{ name: "Size", label: "Medium" }]);
  });

  it("user M + EU 46/48 mens tops selects EU 48 as converted", () => {
    const p = product("p1", {
      normalized: {
        colors: { buckets: [], status: "unknown" },
        sizes: [
          { raw: "EU 46", size: { numeric: 46, numeric_system: "eu" }, status: "resolved" },
          { raw: "EU 48", size: { numeric: 48, numeric_system: "eu" }, status: "resolved" },
        ],
      },
    });
    const sel = buildSizeSelection({
      product: p,
      garment: "shirt",
      brief,
      recipientSize: sizeFact.value as FashionFactSizeValue,
    });
    assert.equal(sel.hadSizeSelection, true);
    assert.equal(sel.selected[0]?.label, "EU 48");
    assert.equal(sel.convertedFrom, "M");
  });

  it("user M + only ambiguous labels → no selection", () => {
    const p = product("p1", {
      normalized: {
        colors: { buckets: [], status: "unknown" },
        sizes: [{ raw: "8", size: { numeric: 8, numeric_system: "ambiguous" }, status: "resolved" }],
      },
    });
    const sel = buildSizeSelection({
      product: p,
      garment: "dress",
      brief: {
        ...brief,
        knowledge_state: { department: "womens", sizes_confirmed: ["dress"], sizes_unconfirmed: [] },
      },
      recipientSize: sizeFact.value as FashionFactSizeValue,
    });
    assert.equal(sel.hadSizeSelection, false);
    assert.deepEqual(sel.selected, []);
  });

  it("user size unknown → no selection", () => {
    const p = product("p1", {
      normalized: {
        colors: { buckets: [], status: "unknown" },
        sizes: [{ raw: "M", size: { alpha: "M" }, status: "resolved" }],
      },
    });
    const sel = buildSizeSelection({
      product: p,
      garment: "shirt",
      brief,
      recipientSize: null,
    });
    assert.equal(sel.hadSizeSelection, false);
  });
});

describe("hydrateCandidate response handling", () => {
  async function mockGet(
    impl: () => Promise<GetProductResult>,
  ): Promise<ReturnType<typeof hydrateCandidate>> {
    return hydrateCandidate({
      slot: planSlot,
      product: sizedProduct,
      brief,
      recipientFacts: [sizeFact],
      accessToken: "token",
      getProductFn: async () => impl(),
      timeoutMs: 50,
    });
  }

  it("match+available → confirmed", async () => {
    const result = await mockGet(async () => ({
      product: {
        id: "p1",
        title: "Shirt",
        selected: [{ name: "Size", label: "Medium" }],
        options: [
          {
            name: "Size",
            values: [{ label: "Medium", available: true, exists: true }],
          },
        ],
        variants: [
          { id: "v1", checkout_url: "https://buy/1", price: { amount: 5000, currency: "USD" } },
        ],
      },
    }));
    assert.equal(result.outcome, "verified");
    if (result.outcome === "verified") {
      assert.equal(result.candidate.size_status, "confirmed");
      assert.deepEqual(result.candidate.resolved_options, [
        { name: "Size", label: "Medium" },
      ]);
      assert.equal(result.candidate.selected_variant_id, "v1");
      assert.equal(result.candidate.size_selection?.merchant_label, "Medium");
    }
  });

  it("match+unavailable → dead size_out_of_stock", async () => {
    const result = await mockGet(async () => ({
      product: {
        id: "p1",
        title: "Shirt",
        selected: [{ name: "Size", label: "Medium" }],
        options: [
          {
            name: "Size",
            values: [{ label: "Medium", available: false, exists: true }],
          },
        ],
        variants: [{ id: "v1", price: { amount: 5000, currency: "USD" } }],
      },
    }));
    assert.equal(result.outcome, "death");
    if (result.outcome === "death") assert.equal(result.death.cause, "size_out_of_stock");
  });

  it("detail Target gender Female on mens search → dead department_mismatch", async () => {
    const result = await hydrateCandidate({
      slot: planSlot,
      product: sizedProduct,
      brief,
      recipientFacts: [sizeFact],
      accessToken: "tok",
      getProductFn: async () =>
        ({
          product: {
            id: "p1",
            title: "Linen Blazer",
            metadata: {
              attributes: [{ name: "Target gender", value: "Female" }],
            },
            selected: [{ name: "Size", label: "Medium" }],
            options: [
              {
                name: "Size",
                values: [{ label: "Medium", available: true, exists: true }],
              },
            ],
            variants: [
              {
                id: "v1",
                checkout_url: "https://buy/1",
                price: { amount: 5000, currency: "USD" },
              },
            ],
          },
        }) as GetProductResult,
    });
    assert.equal(result.outcome, "death");
    if (result.outcome === "death") {
      assert.equal(result.death.cause, "department_mismatch");
    }
  });

  it("fallback with offered sizes excluding recipient → dead size_not_offered", async () => {
    const p = product("p1", {
      normalized: {
        colors: { buckets: [], status: "unknown" },
        sizes: [
          { raw: "Small", size: { alpha: "S" }, status: "resolved" },
          { raw: "Medium", size: { alpha: "M" }, status: "resolved" },
          { raw: "Large", size: { alpha: "L" }, status: "resolved" },
        ],
      },
    });
    const result = await hydrateCandidate({
      slot: planSlot,
      product: p,
      brief,
      recipientFacts: [sizeFact],
      accessToken: "token",
      getProductFn: async () => ({
        product: {
          id: "p1",
          title: "Shirt",
          selected: [{ name: "Size", label: "Small" }],
          options: [
            {
              name: "Size",
              values: [
                { label: "Small", available: true, exists: true },
                { label: "Medium", available: false, exists: false },
                { label: "Large", available: true, exists: true },
              ],
            },
          ],
          variants: [{ id: "v1", checkout_url: "https://buy/1" }],
        },
      }),
    });
    assert.equal(result.outcome, "death");
    if (result.outcome === "death") assert.equal(result.death.cause, "size_not_offered");
  });

  it("fallback with unknowns → unknown survives", async () => {
    const p = product("p1", {
      normalized: {
        colors: { buckets: [], status: "unknown" },
        sizes: [
          { raw: "Small", size: { alpha: "S" }, status: "resolved" },
          { raw: "Mystery", size: null, status: "unknown" },
        ],
      },
    });
    const result = await hydrateCandidate({
      slot: planSlot,
      product: p,
      brief,
      recipientFacts: [sizeFact],
      accessToken: "token",
      getProductFn: async () => ({
        product: {
          id: "p1",
          title: "Shirt",
          selected: [{ name: "Size", label: "Small" }],
          options: [{ name: "Size", values: [{ label: "Small", available: true }] }],
          variants: [{ id: "v1", checkout_url: "https://buy/1" }],
        },
      }),
    });
    assert.equal(result.outcome, "verified");
    if (result.outcome === "verified") assert.equal(result.candidate.size_status, "unknown");
  });

  it("404 → dead gone", async () => {
    const result = await hydrateCandidate({
      slot: planSlot,
      product: product("gone"),
      brief,
      recipientFacts: [],
      accessToken: "token",
      getProductFn: async () => ({}),
    });
    assert.equal(result.outcome, "death");
    if (result.outcome === "death") assert.equal(result.death.cause, "gone");
  });

  it("timeout → death hydration_failed (never verified)", async () => {
    const result = await hydrateCandidate({
      slot: planSlot,
      product: product("slow"),
      brief,
      recipientFacts: [],
      accessToken: "token",
      getProductFn: () => new Promise(() => {}),
      timeoutMs: 20,
    });
    assert.equal(result.outcome, "death");
    if (result.outcome === "death") {
      assert.equal(result.death.cause, "hydration_failed");
    }
  });

  it("native_checkout=false → alive with flag", async () => {
    const result = await hydrateCandidate({
      slot: planSlot,
      product: product("p1", { native_checkout: false }),
      brief,
      recipientFacts: [],
      accessToken: "token",
      getProductFn: async () => ({
        product: {
          id: "p1",
          title: "Shirt",
          url: "https://shop.example/p1",
          variants: [{ id: "v1", price: { amount: 5000, currency: "USD" } }],
        },
      }),
    });
    assert.equal(result.outcome, "verified");
    if (result.outcome === "verified") {
      assert.equal(result.candidate.native_checkout, false);
    }
  });
});

describe("SlotPool", () => {
  it("fillToTarget reaches target when reserve suffices", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const pool = createSlotPool({
      slot: { ...planSlot, options_wanted: 4 },
      scoredProducts: ids.map((id) => product(id)),
      brief,
      recipientFacts: [],
      accessToken: "tok",
      hydrateFn: async ({ product: p }) => ({
        outcome: "verified",
        candidate: verified(p.id),
      }),
    });
    await pool.fillToTarget();
    assert.equal(pool.verified.length, hydrationTargetCount(4));
    assert.equal(pool.thin, false);
  });

  it("reportDeath restores target while reserve exists", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    let calls = 0;
    const pool = createSlotPool({
      slot: { ...planSlot, options_wanted: 2 },
      scoredProducts: ids.map((id) => product(id)),
      brief,
      recipientFacts: [],
      accessToken: "tok",
      hydrateFn: async ({ product: p }) => {
        calls += 1;
        return { outcome: "verified", candidate: verified(p.id) };
      },
    });
    await pool.fillToTarget();
    const before = pool.verified.length;
    await pool.reportDeath(pool.verified[0]!.id, "size_out_of_stock", "test");
    assert.equal(pool.verified.length, before);
    assert.ok(calls > hydrationTargetCount(2));
  });

  it("no product hydrated twice under concurrent deaths", async () => {
    const hydrated = new Set<string>();
    const pool = createSlotPool({
      slot: { ...planSlot, options_wanted: 2 },
      scoredProducts: ["a", "b", "c", "d", "e", "f"].map((id) => product(id)),
      brief,
      recipientFacts: [],
      accessToken: "tok",
      hydrateFn: async ({ product: p }) => {
        assert.ok(!hydrated.has(p.id), `double hydrate ${p.id}`);
        hydrated.add(p.id);
        await new Promise((r) => setTimeout(r, 5));
        return { outcome: "verified", candidate: verified(p.id) };
      },
    });
    await pool.fillToTarget();
    await Promise.all([
      pool.reportDeath(pool.verified[0]!.id, "gone", "a"),
      pool.reportDeath(pool.verified[1]!.id, "gone", "b"),
    ]);
    assert.equal(new Set(hydrated).size, hydrated.size);
  });

  it("thin flag when reserve exhausts before target", async () => {
    const pool = createSlotPool({
      slot: { ...planSlot, options_wanted: 4 },
      scoredProducts: [product("only")],
      brief,
      recipientFacts: [],
      accessToken: "tok",
      hydrateFn: async ({ product: p }) => ({
        outcome: "verified",
        candidate: verified(p.id),
      }),
    });
    await pool.fillToTarget();
    assert.equal(pool.thin, true);
    assert.equal(pool.verified.length, 1);
  });

  it("keeps hydrating through reserve until target or exhaustion", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `p${i}`);
    let verifiedCount = 0;
    const pool = createSlotPool({
      slot: { ...planSlot, options_wanted: 4 },
      scoredProducts: ids.map((id) => product(id)),
      brief,
      recipientFacts: [],
      accessToken: "tok",
      hydrateFn: async ({ product: p }) => {
        verifiedCount += 1;
        if (Number(p.id.slice(1)) % 3 === 0) {
          return {
            outcome: "dead",
            death: {
              product_id: p.id,
              cause: "size_out_of_stock",
              evidence: "test",
              stage: "hydrate",
            },
          };
        }
        return { outcome: "verified", candidate: verified(p.id) };
      },
    });
    await pool.fillToTarget();
    assert.equal(pool.verified.length, hydrationTargetCount(4));
    assert.equal(pool.thin, false);
    assert.ok(verifiedCount >= hydrationTargetCount(4));
  });

  it("getOverflow returns not_verified tail", async () => {
    const ids = Array.from({ length: 15 }, (_, i) => `p${i}`);
    const pool = createSlotPool({
      slot: planSlot,
      scoredProducts: ids.map((id) => product(id)),
      brief,
      recipientFacts: [sizeFact],
      accessToken: "tok",
      hydrateFn: async ({ product: p }) => ({
        outcome: "verified",
        candidate: verified(p.id),
      }),
    });
    await pool.fillToTarget();
    const overflow = pool.getOverflow(10);
    assert.ok(overflow.length > 0);
    assert.ok(overflow.every((o) => o.verification === "not_verified"));
    assert.ok(overflow.every((o) => o.size_note === "size availability not checked"));
  });

  it("overflow graduates when reportDeath drafts from reserve", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
    const pool = createSlotPool({
      slot: { ...planSlot, options_wanted: 2 },
      scoredProducts: ids.map((id) => product(id)),
      brief,
      recipientFacts: [],
      accessToken: "tok",
      hydrateFn: async ({ product: p }) => ({
        outcome: "verified",
        candidate: verified(p.id),
      }),
    });
    await pool.fillToTarget();
    const overflowBefore = pool.getOverflow(10).map((o) => o.product_id);
    const firstOverflow = overflowBefore[0];
    assert.ok(firstOverflow);
    await pool.reportDeath(pool.verified[0]!.id, "gone", "curation");
    const overflowAfter = pool.getOverflow(10).map((o) => o.product_id);
    assert.ok(
      pool.verified.some((v) => v.id === firstOverflow) ||
        !overflowAfter.includes(firstOverflow),
    );
  });
});

describe("createConcurrencyGate", () => {
  it("never runs more than limit at once", async () => {
    const { createConcurrencyGate } = await import("./concurrency-gate");
    const gate = createConcurrencyGate(2);
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        gate.run(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 15));
          inFlight -= 1;
        }),
      ),
    );
    assert.equal(peak, 2);
  });
});

describe("hydrateCandidate transient retry", () => {
  it("retries fetch failed then verifies", async () => {
    let calls = 0;
    const result = await hydrateCandidate({
      slot: planSlot,
      product: product("retry-me"),
      brief,
      recipientFacts: [],
      accessToken: "token",
      timeoutMs: null,
      getProductFn: async () => {
        calls += 1;
        if (calls === 1) throw new Error("fetch failed");
        return {
          product: {
            id: "retry-me",
            title: "Shirt",
            url: "https://shop.example/p",
            variants: [{ id: "v1", price: { amount: 5000, currency: "USD" } }],
          },
        };
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.outcome, "verified");
  });
});
