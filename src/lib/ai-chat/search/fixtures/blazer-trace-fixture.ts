/**
 * Regression fixture distilled from the black men's blazer trace (Jul 2026).
 * Evidence-anchored cases for constraint-gate + narrator payload tests.
 */
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { SearchBrief } from "../types";

export const blazerTraceBrief: SearchBrief = {
  archetype: "broad",
  query: "black blazer men's tailored work",
  category: "blazer",
  useCase: "work/office",
  mustHaves: ["black", "work/office appropriate", "tailored structure"],
  niceToHaves: ["versatile for events and nightlife too"],
  budget: { amountCents: 25_000, type: "soft", currency: "USD" },
  variantConstraints: { size: "M", color: "black" },
  genderScope: "mens",
  recipient: { kind: "self" },
  rankingProfile: "balanced",
};

const product = (
  id: string,
  title: string,
  extra: Record<string, unknown> = {},
): CatalogProductSummary =>
  ({
    id,
    title,
    variants: [{ price: { amount: 18_000, currency: "USD" }, checkout_url: "https://x.test/v" }],
    ...extra,
  }) as unknown as CatalogProductSummary;

/** Judge-tiered but wrong gender — must never reach narrator. */
export const womensVerityBlazer = product(
  "gid://shopify/Product/verity-womens",
  "VERITY Tailored Blazer — Women's",
  { options: [{ name: "Color", values: [{ label: "Black" }] }] },
);

/** Must-have color violation — beige on black query. */
export const beigeBarBlazer = product(
  "gid://shopify/Product/beige-bar",
  "Beige Bar III Structured Blazer",
  { options: [{ name: "Color", values: [{ label: "Beige" }] }] },
);

/** Navy stripe on black query — attribute gate drop. */
export const navyStripeBlazer = product(
  "gid://shopify/Product/navy-stripe",
  "Performance Blazer // Navy Stripe",
  { options: [{ name: "Color", values: [{ label: "Navy Stripe" }] }] },
);

/** Valid black men's blazer — should pass all gates. */
export const validBlackMensBlazer = product(
  "gid://shopify/Product/valid-black",
  "Men's Black Wool Blend Tailored Blazer",
  {
    options: [
      { name: "Color", values: [{ label: "Black" }] },
      { name: "Size", values: [{ label: "M" }, { label: "L" }] },
    ],
  },
);

export const blazerTraceViolators = [
  womensVerityBlazer,
  beigeBarBlazer,
  navyStripeBlazer,
];
