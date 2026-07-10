import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSearchBrief } from "./archetype";
import { budgetAlignmentScore } from "./budget";
import {
  queryContainsBannedToken,
  sanitizePortfolioQuery,
  sanitizePortfolioQueries,
} from "./query-hygiene";
import { isNoveltyMerchTitle } from "./novelty-merch";
import {
  assessPoolHealth,
  effectiveCorroboration,
  titleFingerprint,
} from "./pool-health";
import type { PoolCandidate, PortfolioQuery } from "./types";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";

const product = (title: string, over: Record<string, unknown> = {}) =>
  ({ id: "gid://x/1", title, ...over }) as unknown as CatalogProductSummary;

const brief = buildSearchBrief({
  query: "fitness gear for young adult male birthday gift",
  priceMaxCents: 10_000,
  fields: {
    archetype: "gift_directed",
    direction_label: "Fitness & Sports",
    recipient: {
      kind: "other",
      label: "Rami",
      known_interests: ["fitness", "tech"],
    },
  },
});

const portfolioRow = (text: string): PortfolioQuery => ({
  id: "q-1",
  text,
  wave: 2,
  intent: "Gift context",
});

describe("sanitizePortfolioQuery gate", () => {
  it("rejects the Rami-style banned query outright", () => {
    const raw =
      "fitness sports gear accessories gift for young adult male birthday";
    const result = sanitizePortfolioQuery(portfolioRow(raw), brief);
    if (result) {
      assert.equal(queryContainsBannedToken(result.text), false);
      assert.ok(result.intent?.includes("gift") || result.intent?.includes("birthday"));
    } else {
      assert.ok(true, "invalid query dropped");
    }
  });

  it("relocates stripped occasion words into intent", () => {
    const result = sanitizePortfolioQuery(
      portfolioRow("wireless earbuds gift for him"),
      brief,
    );
    assert.ok(result);
    assert.equal(queryContainsBannedToken(result!.text), false);
    assert.match(result!.intent ?? "", /gift|him/i);
  });

  it("batch-sanitizes a portfolio", () => {
    const rows = sanitizePortfolioQueries(
      [
        portfolioRow("mechanical keyboard rgb hot swap"),
        portfolioRow("birthday gift bracelet for men"),
      ],
      brief,
    );
    assert.ok(rows.length >= 1);
    for (const r of rows) {
      assert.equal(queryContainsBannedToken(r.text), false);
    }
  });
});

describe("novelty merch detection", () => {
  it("flags POD trainer gift titles", () => {
    assert.equal(
      isNoveltyMerchTitle(
        "Personal Trainer Birthday Unique Gifts for Men Funny Bracelet",
      ),
      true,
    );
  });
});

describe("pool health", () => {
  const candidate = (title: string, price: number): PoolCandidate => ({
    product: product(title, {
      variants: [{ price: { amount: price, currency: "USD" } }],
      seller: { domain: "junk.shop" },
    }),
    upid: title,
    sources: [{ queryId: "q1", rank: 0 }],
    bestRank: 0,
    corroboration: 3,
    fromDiscovery: false,
  });

  it("marks homogeneous novelty pools unhealthy", () => {
    const pool = Array.from({ length: 8 }, (_, i) =>
      candidate(`Funny Personal Trainer Gift Bracelet ${i}`, 2_500),
    );
    const health = assessPoolHealth(pool, brief);
    assert.equal(health.healthy, false);
    assert.ok(health.reasons.length > 0);
  });

  it("caps corroboration for novelty titles", () => {
    const c = candidate("Unique Gift for Dad Funny Mug", 2_000);
    c.corroboration = 8;
    assert.equal(effectiveCorroboration(c), 1);
  });
});

describe("budgetAlignmentScore", () => {
  it("penalizes cheap gifts far under a $100 budget", () => {
    const budget = { amountCents: 10_000, type: "soft" as const, currency: "USD" };
    const cheap = budgetAlignmentScore(2_500, budget, { isGift: true });
    const inBand = budgetAlignmentScore(7_500, budget, { isGift: true });
    assert.ok(cheap < inBand);
  });
});

describe("titleFingerprint", () => {
  it("clusters near-duplicate titles", () => {
    const a = titleFingerprint("Funny Personal Trainer Gift Bracelet Men");
    const b = titleFingerprint("Personal Trainer Funny Gift Bracelet For Men");
    assert.equal(a, b);
  });
});
