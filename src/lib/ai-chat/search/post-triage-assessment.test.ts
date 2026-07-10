import assert from "node:assert/strict";
import test from "node:test";
import { assessPostTriagePool } from "./post-triage-assessment";
import { buildSearchBrief } from "./archetype";
import type { VerifiedCandidate } from "./verify";

function vc(id: string, title: string): VerifiedCandidate {
  return {
    upid: id,
    detail: { id, title },
    product: { id, title },
    score: 0.8,
    breakdown: { total: 0.8 } as VerifiedCandidate["breakdown"],
    availability: { status: "in_stock" },
    resolvedPriceCents: 9900,
    nativeCheckoutUrl: "https://example.com",
    resolvedOptions: [],
    exactMatch: true,
  } as VerifiedCandidate;
}

test("assessPostTriagePool flags thin pool with no anchors", () => {
  const brief = buildSearchBrief({
    query: "black slim fit blazer men's work professional",
    fields: { category: "blazers" },
  });
  const verified = [vc("gid://shopify/Product/1", "Generic slim blazer")];
  const assessment = assessPostTriagePool({
    verified,
    triage: [
      {
        productId: "gid://shopify/Product/1",
        verdict: "advance",
        note: "Only option",
      },
    ],
    preJudgeDrops: [
      {
        productId: "gid://shopify/Product/2",
        title: "Wrong color",
        reason: "Color mismatch",
        gate: "must_have_color",
      },
      {
        productId: "gid://shopify/Product/3",
        title: "Wrong fit",
        reason: "Too relaxed",
        gate: "constraint",
      },
    ],
    brief,
  });

  assert.equal(assessment.needsRetry, true);
  assert.match(assessment.summary, /1 valid candidate/i);
  assert.match(assessment.summary, /no anchors/i);
  assert.match(assessment.summary, /2 constraint violation/i);
});

test("assessPostTriagePool skips retry when pool is healthy", () => {
  const brief = buildSearchBrief({
    query: "wireless earbuds noise cancelling",
    fields: { category: "electronics" },
  });
  const verified = Array.from({ length: 8 }, (_, i) =>
    vc(`gid://shopify/Product/${i + 1}`, `Earbuds model ${i + 1}`),
  );
  const triage = verified.map((v) => ({
    productId: v.detail.id,
    verdict: "advance" as const,
    note: "Solid fit",
  }));

  const assessment = assessPostTriagePool({
    verified,
    triage,
    preJudgeDrops: [],
    brief,
  });

  assert.equal(assessment.needsRetry, false);
});
