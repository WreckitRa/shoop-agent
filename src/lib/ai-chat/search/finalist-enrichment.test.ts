import assert from "node:assert/strict";
import test from "node:test";
import { formatVerifiedCandidatesForJudgment } from "../judgment/attributes-prompt";
import {
  extractProductDescription,
  formatMaterialsLine,
  formatResolvedOptionsLine,
  formatReviewSnippets,
  formatRichJudgmentCandidateBlock,
  formatVariantMatrixLine,
} from "../judgment/rich-candidate-prompt";
import type { CatalogProductDetail } from "@/lib/shopify/catalog";
import type { VerifiedCandidate } from "./verify";

const blazerDetail = {
  id: "gid://shopify/Product/valid-black",
  title: "Men's Black Wool Blend Tailored Blazer",
  brand: "Bar III",
  description: {
    plain:
      "Structured single-button blazer in wool blend. Notch lapel, flap pockets, fully lined. Work-to-event versatile.",
  },
  options: [
    {
      name: "Color",
      values: [
        { label: "Black", available: true, exists: true },
        { label: "Navy", available: true, exists: true },
      ],
    },
    {
      name: "Size",
      values: [
        { label: "S", available: true, exists: true },
        { label: "M", available: true, exists: true },
        { label: "L", available: false, exists: true },
      ],
    },
  ],
  metadata: {
    tech_specs: "Material: 65% wool, 35% polyester\nLining: polyester\nClosure: single button",
    top_features: "Notch lapel; flap pockets; fully lined",
  },
  variants: [
    {
      id: "gid://shopify/ProductVariant/1",
      price: { amount: 18_000, currency: "USD" },
      availability: { available: true },
      options: [
        { name: "Color", label: "Black" },
        { name: "Size", label: "M" },
      ],
      seller: {
        name: "Macy's",
        domain: "macys.com",
        links: [{ type: "shipping_policy", url: "https://example.com/shipping" }],
      },
      requires: { shipping: true },
    },
    {
      id: "gid://shopify/ProductVariant/2",
      price: { amount: 18_000, currency: "USD" },
      availability: { available: false },
      options: [
        { name: "Color", label: "Black" },
        { name: "Size", label: "L" },
      ],
    },
  ],
  rating: { value: 4.4, scale_max: 5, count: 128 },
  reviews: [
    { body: "Sharp enough for the office without feeling stiff.", rating: 5 },
    { body: "Runs slightly slim in the shoulders.", rating: 4 },
  ],
  size_chart: "Chest S 36-38, M 38-40, L 40-42 (inches)",
} as unknown as CatalogProductDetail;

test("rich candidate block includes description, materials, variants, and reviews", () => {
  const block = formatRichJudgmentCandidateBlock({
    id: blazerDetail.id,
    title: blazerDetail.title,
    priceLabel: "180.00 USD",
    detail: blazerDetail,
    availabilityLine: "in stock; buyer size available",
    ratingLine: "4.4/5 (128 reviews)",
    imageRef: "candidate-0",
  });

  assert.match(block, /description: Structured single-button blazer/);
  assert.match(block, /materials: Material: 65% wool/);
  assert.match(block, /options: Color: Black \(avail\)/);
  assert.match(block, /variants: Black \/ M · 180\.00 USD · in/);
  assert.match(block, /size_chart: Chest S 36-38/);
  assert.match(block, /review_snippets:/);
  assert.match(block, /shipping: requires shipping/);
});

test("formatVerifiedCandidatesForJudgment prefers judgeDetail over verify detail", () => {
  const verified = [
    {
      upid: "valid-black",
      product: { id: blazerDetail.id, title: "Short title from search" },
      detail: {
        id: blazerDetail.id,
        title: "Short title from verify",
        options: [{ name: "Color", values: [{ label: "Black" }] }],
      },
      judgeDetail: blazerDetail,
      availability: {
        status: "in_stock",
        preferredMatched: true,
        purchasable: true,
        shippable: true,
      },
      resolvedPriceCents: 18_000,
      nativeCheckoutUrl: "https://example.com/checkout",
      resolvedOptions: [],
      exactMatch: true,
      score: 1,
      breakdown: { total: 1 } as VerifiedCandidate["breakdown"],
    },
  ] as VerifiedCandidate[];

  const block = formatVerifiedCandidatesForJudgment(verified);
  assert.match(block, /title: Men's Black Wool Blend Tailored Blazer/);
  assert.match(block, /description: Structured single-button blazer/);
  assert.doesNotMatch(block, /title \+ one attribute/i);
});

test("extractProductDescription handles plain and text envelopes", () => {
  assert.equal(
    extractProductDescription({
      id: "x",
      title: "t",
      description: { plain: "Plain body" },
    }),
    "Plain body",
  );
  assert.equal(
    extractProductDescription({
      id: "x",
      title: "t",
      description: { text: "Text body" },
    }),
    "Text body",
  );
});

test("formatMaterialsLine falls back to inferred Material attributes", () => {
  const line = formatMaterialsLine({
    id: "x",
    title: "t",
    metadata: {
      attributes: [{ name: "Material", value: "cotton twill" }],
    },
  });
  assert.match(line ?? "", /Material: cotton twill/);
});

test("formatVariantMatrixLine summarizes SKU availability", () => {
  const line = formatVariantMatrixLine(blazerDetail);
  assert.match(line ?? "", /Black \/ L · 180\.00 USD · out/);
});

test("formatReviewSnippets caps snippet count", () => {
  const line = formatReviewSnippets({
    id: "x",
    title: "t",
    reviews: [
      { body: "One" },
      { body: "Two" },
      { body: "Three" },
      { body: "Four" },
    ],
  });
  assert.match(line ?? "", /One/);
  assert.doesNotMatch(line ?? "", /Four/);
});

test("formatResolvedOptionsLine marks unavailable sizes", () => {
  const line = formatResolvedOptionsLine(blazerDetail);
  assert.match(line ?? "", /L \(unavail\)/);
});
