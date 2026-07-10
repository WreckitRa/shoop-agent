import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchBrief } from "./archetype";
import {
  deterministicSelfCheck,
  enforceTierOneSelfChecks,
  parseTierOneSelfChecks,
} from "../judgment/tier-one-self-check";
import type { TierPlacement } from "../judgment/tier-judge";
import type { VerifiedCandidate } from "./verify";

const id = "gid://shopify/Product/1";

function vc(title: string, opts?: Partial<VerifiedCandidate>): VerifiedCandidate {
  return {
    upid: id,
    detail: { id, title, options: opts?.detail?.options },
    product: { id, title },
    score: 0.9,
    breakdown: { total: 0.9 } as VerifiedCandidate["breakdown"],
    availability: { status: "in_stock", preferredMatched: true },
    resolvedPriceCents: 12000,
    nativeCheckoutUrl: "https://example.com",
    resolvedOptions: [],
    exactMatch: true,
    ...opts,
  } as VerifiedCandidate;
}

test("enforceTierOneSelfChecks drops beige blazer when brief requires black", () => {
  const brief = buildSearchBrief({
    query: "black slim fit blazer men's work",
    fields: {
      genderScope: "mens",
      must_haves: ["black"],
    },
  });
  const verified = [vc("Women's Beige Slim Blazer")];
  const placements: TierPlacement[] = [
    {
      productId: id,
      tier: 1,
      reason: "Slim cut fits office",
      confidence: "strong",
    },
  ];
  const checks = parseTierOneSelfChecks(
    {
      checks: [
        {
          product_id: id,
          color: {
            required: "black",
            actual: "Beige",
            pass: false,
            note: "Variant colors Beige/Taupe only — brief requires black",
          },
          gender: {
            required: "mens",
            actual: "Women's in title",
            pass: false,
            note: "Title says Women's",
          },
          size_in_stock: {
            required: "none",
            actual: "n/a",
            pass: true,
            note: "No size constraint",
          },
        },
      ],
    },
    new Set([id]),
  );

  const det = deterministicSelfCheck(verified[0]!, brief);
  assert.equal(det.colorPass, false);

  const result = enforceTierOneSelfChecks({
    placements,
    checks,
    verified,
    brief,
  });
  assert.equal(result.placements.length, 1);
  assert.equal(result.placements[0]?.tier, 2);
  assert.equal(result.drops.length, 1);
  assert.match(result.drops[0]!.reason, /Self-check failed/i);
});

test("enforceTierOneSelfChecks keeps tier 1 when checks and code agree", () => {
  const brief = buildSearchBrief({
    query: "black slim fit blazer men's work",
    fields: {
      genderScope: "mens",
      must_haves: ["black"],
    },
  });
  const verified = [
    vc("Men's Black Slim Fit Wool Blazer", {
      detail: {
        id,
        title: "Men's Black Slim Fit Wool Blazer",
        options: [{ name: "Color", values: [{ label: "Black" }] }],
      },
    }),
  ];
  const placements: TierPlacement[] = [
    {
      productId: id,
      tier: 1,
      reason: "Beats navy option on formality",
      confidence: "strong",
    },
  ];
  const checks = parseTierOneSelfChecks(
    {
      checks: [
        {
          product_id: id,
          color: {
            required: "black",
            actual: "Black variant",
            pass: true,
            note: "Color option Black matches brief",
          },
          gender: {
            required: "mens",
            actual: "Men's in title",
            pass: true,
            note: "Men's scope confirmed in title",
          },
          size_in_stock: {
            required: "none",
            actual: "n/a",
            pass: true,
            note: "No size requested",
          },
        },
      ],
    },
    new Set([id]),
  );

  const result = enforceTierOneSelfChecks({
    placements,
    checks,
    verified,
    brief,
  });
  assert.equal(result.placements.length, 1);
  assert.equal(result.placements[0]?.tier, 1);
  assert.ok(result.placements[0]?.selfCheck);
  assert.equal(result.drops.length, 0);
});
