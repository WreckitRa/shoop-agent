import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import type { FashionSlotCatalogResult } from "../catalog-search/types";
import {
  applyExploreDiversityPass,
  applyTasteRerankToSlots,
  candidateAttributeCard,
  clearTasteRerankCache,
  hashTasteSignals,
  TASTE_RERANK_PROMPT,
  tasteRerankMaxTokens,
  tasteRerankTopN,
} from "./taste-rerank";
import { scoreProduct } from "./components";
import { SCORING_WEIGHTS, scoringWeightsVersion } from "./weights";

function product(
  id: string,
  opts: { title: string; colors?: string[]; amount?: number } = { title: id },
): FashionSlotCatalogProduct {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title: opts.title,
    variant_options: [],
    image_urls: [],
    price: opts.amount != null ? { amount: opts.amount, currency: "USD" } : undefined,
    raw: { id, title: opts.title } as CatalogProductSummary,
    normalized: {
      colors: {
        buckets: (opts.colors ?? ["unknown"]) as never[],
        status: opts.colors?.length ? "resolved" : "unknown",
      },
      sizes: [],
    },
  };
}

const slot: FashionSearchPlanSlot = {
  slot_id: "s1",
  garment: "blazer",
  role: "anchor",
  style_direction: "work",
  palette_constraint: null,
  palette_source: "spread",
  options_wanted: 3,
  query_variants: ["womens blazer"],
};

const brief: FashionSearchBrief = {
  recipient_person_id: "p1",
  request_type: "single_item",
  garments: ["blazer"],
  occasion_context: "work",
  quantity_hint: "",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "work",
  preference_anchor: "keep",
};

afterEach(() => clearTasteRerankCache());

describe("taste rerank helpers", () => {
  it("attribute cards omit titles", () => {
    const card = candidateAttributeCard(
      product("x", { title: "Secret Title Navy Blazer", colors: ["navy"], amount: 80 }),
      "blazer",
    );
    const blob = JSON.stringify(card);
    assert.equal(blob.includes("Secret"), false);
    assert.equal(blob.includes("Title"), false);
    assert.equal(card.color, "navy");
    assert.equal(card.price_band, "mid");
    assert.equal(card.garment, "blazer");
  });

  it("explore diversity caps a color to ceil(shortlist/3)", () => {
    const products = [
      product("n1", { title: "Navy 1", colors: ["navy"] }),
      product("n2", { title: "Navy 2", colors: ["navy"] }),
      product("n3", { title: "Navy 3", colors: ["navy"] }),
      product("n4", { title: "Navy 4", colors: ["navy"] }),
      product("r1", { title: "Red 1", colors: ["red"] }),
      product("g1", { title: "Green 1", colors: ["green"] }),
      product("b1", { title: "Black 1", colors: ["black"] }),
    ];
    // options_wanted 1 → shortlist ceil(3.5)=4, cap ceil(4/3)=2
    const out = applyExploreDiversityPass(products, 1);
    const navyInShortlist = out
      .slice(0, 4)
      .filter((p) => (p.normalized?.colors.buckets ?? []).includes("navy" as never));
    assert.ok(navyInShortlist.length <= 2);
    assert.equal(out.length, products.length);
  });

  it("taste_fit weight lifts a rated product over shopify rank", () => {
    const buried = product("navy", { title: "Navy tailored blazer", colors: ["navy"] });
    buried.taste_rating = { taste_fit: 1, lane: "usual" };
    const trendy = product("red", { title: "Red party blazer", colors: ["red"] });
    const slotForScore = slot;
    const highTaste = scoreProduct({
      product: buried,
      slot: slotForScore,
      brief,
      recipientFacts: [],
      bestRank: 20,
    });
    const highRank = scoreProduct({
      product: trendy,
      slot: slotForScore,
      brief,
      recipientFacts: [],
      bestRank: 0,
    });
    assert.ok(highTaste.final > highRank.final);
    assert.equal(highTaste.active_components.includes("taste_fit"), true);
    assert.equal(highRank.active_components.includes("taste_fit"), false);
    assert.equal(SCORING_WEIGHTS.taste_fit, 0.3);
    assert.equal(scoringWeightsVersion(), "20260828-v4-taste");
  });

  it("fail-open: invalid tool output leaves prior order", async () => {
    const a = product("a", { title: "Red blazer", colors: ["red"] });
    const b = product("b", { title: "Navy blazer", colors: ["navy"] });
    const slotResult: FashionSlotCatalogResult = {
      slot_id: "s1",
      garment: "blazer",
      products: [a, b],
      query_variants_used: [{ query: "q", category_filtered: true }],
      counts: { unique_products: 2, per_variant: [2], reformulated: false },
      query_logs: [
        {
          slot_id: "s1",
          variant_index: 0,
          query: "q",
          reformulation: false,
          status: "ok",
          raw_count: 2,
          duration_ms: 1,
          products: [{ id: "a" }, { id: "b" }],
        },
      ],
    };
    const { slots, failed } = await applyTasteRerankToSlots({
      slots: [slotResult],
      planSlots: [slot],
      brief,
      recipientFacts: [],
      recipientProfile: "+navy [work, stated]",
      recipientPersonId: "p1",
      signalsHash: hashTasteSignals([
        { signal_type: "color", value: "navy", polarity: 1 },
      ]),
      createMessage: async () =>
        ({
          content: [{ type: "text", text: "no tool" }],
          stop_reason: "end_turn",
        }) as never,
    });
    assert.equal(failed, true);
    assert.equal(slots[0]!.products[0]!.taste_rating, undefined);
    assert.equal(slots[0]!.products[0]!.id, "a");
  });

  it("cache skips a second LLM call for the same product/anchor/signals", async () => {
    let calls = 0;
    const makeMsg = async () => {
      calls += 1;
      return {
        content: [
          {
            type: "tool_use",
            name: "rate_taste_fit",
            id: "t1",
            input: {
              ratings: [
                { ref: "1", score: 9, lane: "usual" },
              ],
            },
          },
        ],
        stop_reason: "tool_use",
      } as never;
    };
    const p = product("navy-1", { title: "Navy blazer", colors: ["navy"] });
    const slotResult = (): FashionSlotCatalogResult => ({
      slot_id: "s1",
      garment: "blazer",
      products: [p],
      query_variants_used: [{ query: "q", category_filtered: true }],
      counts: { unique_products: 1, per_variant: [1], reformulated: false },
      query_logs: [
        {
          slot_id: "s1",
          variant_index: 0,
          query: "q",
          reformulation: false,
          status: "ok",
          raw_count: 1,
          duration_ms: 1,
          products: [{ id: "navy-1" }],
        },
      ],
    });
    const args = {
      planSlots: [slot],
      brief,
      recipientFacts: [] as const,
      recipientProfile: "+navy",
      recipientPersonId: "p1",
      signalsHash: hashTasteSignals([
        { signal_type: "color", value: "navy", polarity: 1 },
      ]),
      createMessage: makeMsg,
    };
    await applyTasteRerankToSlots({ slots: [slotResult()], ...args });
    p.taste_rating = undefined;
    await applyTasteRerankToSlots({ slots: [slotResult()], ...args });
    assert.equal(calls, 1);
    assert.equal(p.taste_rating?.taste_fit, 0.9);
  });

  it("prompt is the S1b contract", () => {
    assert.ok(TASTE_RERANK_PROMPT.includes("dislikes count double"));
    assert.ok(TASTE_RERANK_PROMPT.includes("Call rate_taste_fit once"));
    assert.ok(TASTE_RERANK_PROMPT.includes("integer 0 to 10"));
    assert.ok(
      TASTE_RERANK_PROMPT.includes(
        "scores ≤ 3 unless occasion leaves no alternative",
      ),
    );
    assert.ok(TASTE_RERANK_PROMPT.includes('lane "usual"'));
    assert.ok(TASTE_RERANK_PROMPT.includes("regardless of score"));
    assert.equal(tasteRerankMaxTokens(20), 25 * 20 + 80);
    assert.equal(tasteRerankTopN("anchor"), 40);
    assert.equal(tasteRerankTopN("support"), 20);
  });

  it("partial fail-open: abort of one 20-batch keeps the other half", async () => {
    const products = Array.from({ length: 21 }, (_, i) =>
      product(`p${i}`, { title: `Blazer ${i}`, colors: ["navy"] }),
    );
    let calls = 0;
    const maxTokensSeen: number[] = [];
    const { slots, failed, stats } = await applyTasteRerankToSlots({
      slots: [
        {
          slot_id: "s1",
          garment: "blazer",
          products,
          query_variants_used: [{ query: "q", category_filtered: true }],
          counts: { unique_products: 21, per_variant: [21], reformulated: false },
          query_logs: [
            {
              slot_id: "s1",
              variant_index: 0,
              query: "q",
              reformulation: false,
              status: "ok",
              raw_count: 21,
              duration_ms: 1,
              products: products.map((p) => ({ id: p.id })),
            },
          ],
        },
      ],
      planSlots: [slot],
      brief,
      recipientFacts: [],
      recipientProfile: "+navy [work, stated]",
      recipientPersonId: "p1",
      signalsHash: hashTasteSignals([
        { signal_type: "color", value: "navy", polarity: 1 },
      ]),
      createMessage: async (args) => {
        calls += 1;
        maxTokensSeen.push(args.maxTokens ?? 0);
        if (calls === 1) {
          throw new Error("aborted");
        }
        const n = args.maxTokens === tasteRerankMaxTokens(1) ? 1 : 20;
        return {
          content: [
            {
              type: "tool_use",
              name: "rate_taste_fit",
              id: "t2",
              input: {
                ratings: Array.from({ length: n }, (_, i) => ({
                  ref: String(i + 1),
                  score: 8,
                  lane: "usual",
                })),
              },
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 120, output_tokens: 50 },
        } as never;
      },
    });
    assert.equal(calls, 2);
    assert.equal(failed, true);
    assert.equal(stats.calls, 2);
    assert.equal(stats.aborted, 1);
    assert.ok(stats.rated >= 1);
    const rated = slots[0]!.products.filter((p) => p.taste_rating);
    assert.ok(rated.length >= 1);
    assert.ok(rated.length < 21);
    assert.ok(maxTokensSeen.includes(tasteRerankMaxTokens(20)));
    assert.ok(maxTokensSeen.includes(tasteRerankMaxTokens(1)));
  });
});
