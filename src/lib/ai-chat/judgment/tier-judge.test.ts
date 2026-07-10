import assert from "node:assert/strict";
import test from "node:test";
import {
  enforceListingQualityOnPlacements,
  headToHeadLoserReasons,
  parseBuyingRules,
  parseHeadToHeadComparisons,
  parseJudgeOmissions,
  parseListingAssessments,
  parseTierJudgePlacementRows,
  parseTierJudgePlacements,
  parseTriageVerdicts,
  resolveJudgeOmissions,
  selectFinalistsForCompare,
  synthesizeTriageVerdicts,
} from "./tier-judge";
import type { VerifiedCandidate } from "../search/verify";

const validIds = new Set(["gid://shopify/Product/1", "gid://shopify/Product/2"]);

test("parseTierJudgePlacements accepts string tiers and productId alias", () => {
  const raw = JSON.stringify({
    placements: [
      {
        productId: "gid://shopify/Product/1",
        tier: "1",
        reason: "Leather lug sole fits streetwear boot request",
        confidence: "strong",
      },
      {
        product_id: "gid://shopify/Product/2",
        tier: 2,
        reason: "Canvas slip-on is a different direction",
        confidence: "moderate",
      },
    ],
  });

  const placements = parseTierJudgePlacements(raw, validIds);
  assert.equal(placements.length, 2);
  assert.equal(placements[0]?.tier, 1);
  assert.equal(placements[1]?.productId, "gid://shopify/Product/2");
});

test("parseTierJudgePlacements drops unknown ids but keeps valid rows", () => {
  const raw = JSON.stringify({
    placements: [
      {
        product_id: "gid://shopify/Product/999",
        tier: 1,
        reason: "Should be dropped — unknown id",
        confidence: "strong",
      },
      {
        product_id: "gid://shopify/Product/1",
        tier: 1,
        reason: "Rubber sole running shoe matches cushioned request",
        confidence: "strong",
      },
    ],
  });

  const placements = parseTierJudgePlacements(raw, validIds);
  assert.equal(placements.length, 1);
  assert.equal(placements[0]?.productId, "gid://shopify/Product/1");
});

test("parseTierJudgePlacementRows resolves numeric product id suffixes", () => {
  const rows = [
    {
      product_id: "1",
      tier: 1,
      reason: "Leather lug sole fits streetwear boot request",
      confidence: "strong",
    },
  ];
  const placements = parseTierJudgePlacementRows({ placements: rows }, validIds);
  assert.equal(placements.length, 1);
  assert.equal(placements[0]?.productId, "gid://shopify/Product/1");
});

test("parseTierJudgePlacements parses fenced JSON", () => {
  const raw = [
    "```json",
    JSON.stringify({
      placements: [
        {
          product_id: "gid://shopify/Product/2",
          tier: 3,
          reason: "Patent loafer — formal lane, not streetwear",
          confidence: "limited",
        },
      ],
    }),
    "```",
  ].join("\n");

  const placements = parseTierJudgePlacements(raw, validIds);
  assert.equal(placements.length, 1);
  assert.equal(placements[0]?.tier, 3);
});

test("parseBuyingRules reads buying_rules from tool output", () => {
  const rules = parseBuyingRules({
    buying_rules: [
      "Rule 1: Black only — no charcoal",
      "Rule 2: Slim not skinny",
      "Rule 3: Structured wool or knit",
      "Rule 4: Office formality without costume",
    ],
    placements: [],
  });
  assert.equal(rules?.length, 4);
  assert.match(rules![0]!, /Black only/i);
});

test("parseTriageVerdicts reads advance/drop verdicts", () => {
  const triage = parseTriageVerdicts(
    {
      triage: [
        {
          product_id: "gid://shopify/Product/1",
          verdict: "advance",
          note: "Slim black blazer lane",
        },
        {
          product_id: "gid://shopify/Product/2",
          verdict: "drop",
          note: "Novelty print — wrong category",
        },
      ],
    },
    validIds,
  );
  assert.equal(triage.length, 2);
  assert.equal(triage[0]?.verdict, "advance");
  assert.equal(triage[1]?.verdict, "drop");
});

test("parseHeadToHeadComparisons reads forced comparisons", () => {
  const comparisons = parseHeadToHeadComparisons(
    {
      head_to_head: [
        {
          product_ids: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
          winner_id: "gid://shopify/Product/1",
          tradeoff:
            "Ponte vs wool-blend for 4hr on feet: ponte wins stretch recovery, wool wins drape — pick ponte.",
        },
      ],
    },
    validIds,
  );
  assert.equal(comparisons.length, 1);
  assert.equal(comparisons[0]?.winnerId, "gid://shopify/Product/1");
  assert.match(comparisons[0]?.tradeoff ?? "", /Ponte vs wool-blend/i);
});

test("selectFinalistsForCompare pads from score order when triage is sparse", () => {
  const verified = [
    { detail: { id: "gid://shopify/Product/1", title: "A" } },
    { detail: { id: "gid://shopify/Product/2", title: "B" } },
    { detail: { id: "gid://shopify/Product/3", title: "C" } },
    { detail: { id: "gid://shopify/Product/4", title: "D" } },
  ] as VerifiedCandidate[];
  const triage = parseTriageVerdicts(
    {
      triage: [
        {
          product_id: "gid://shopify/Product/2",
          verdict: "advance",
          note: "Only explicit advance",
        },
      ],
    },
    new Set(verified.map((v) => v.detail.id)),
  );
  const finalists = selectFinalistsForCompare(verified, triage, 4);
  assert.equal(finalists.length, 4);
  assert.ok(finalists.some((f) => f.detail.id === "gid://shopify/Product/2"));
});

test("parseListingAssessments reads listing_quality, flags, brand_tier", () => {
  const parsed = parseListingAssessments(
    {
      listing_assessments: [
        {
          product_id: "gid://shopify/Product/1",
          listing_quality: "junk",
          flags: ["sku_title", "single_size_clearance"],
          brand_tier: "unknown",
        },
      ],
    },
    validIds,
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.listingQuality, "junk");
  assert.deepEqual(parsed[0]!.flags, ["sku_title", "single_size_clearance"]);
  assert.equal(parsed[0]!.brandTier, "unknown");
});

test("enforceListingQualityOnPlacements demotes tier 1 junk listings", () => {
  const { placements, drops } = enforceListingQualityOnPlacements(
    [
      {
        productId: "gid://shopify/Product/1",
        tier: 1,
        reason: "Looks fine",
        confidence: "strong",
      },
    ],
    [
      {
        productId: "gid://shopify/Product/1",
        listingQuality: "junk",
        flags: ["sku_title"],
        brandTier: "unknown",
      },
    ],
  );
  assert.equal(placements[0]!.tier, 2);
  assert.equal(drops.length, 1);
});

test("parseTriageVerdicts accepts triage_verdicts alias and keep/reject verdicts", () => {
  const triage = parseTriageVerdicts(
    {
      triage_verdicts: [
        {
          product_id: "gid://shopify/Product/1",
          verdict: "keep",
          reason: "Black wool blazer lane",
        },
        {
          product_id: "gid://shopify/Product/2",
          verdict: "reject",
          rationale: "Leather jacket — wrong category",
        },
      ],
    },
    validIds,
  );
  assert.equal(triage.length, 2);
  assert.equal(triage[0]?.verdict, "advance");
  assert.equal(triage[1]?.verdict, "drop");
});

test("synthesizeTriageVerdicts advances every verified candidate", () => {
  const verified = [
    { detail: { id: "gid://shopify/Product/1", title: "A" } },
    { detail: { id: "gid://shopify/Product/2", title: "B" } },
  ] as VerifiedCandidate[];
  const triage = synthesizeTriageVerdicts(verified);
  assert.equal(triage.length, 2);
  assert.ok(triage.every((t) => t.verdict === "advance"));
});

test("parseJudgeOmissions reads explicit omission reasons", () => {
  const omissions = parseJudgeOmissions(
    {
      omissions: [
        {
          product_id: "gid://shopify/Product/2",
          reason: "Canvas upper — wrong lane vs leather boot brief",
        },
      ],
    },
    validIds,
  );
  assert.equal(omissions.length, 1);
  assert.equal(omissions[0]?.productId, "gid://shopify/Product/2");
  assert.match(omissions[0]?.reason ?? "", /Canvas upper/);
});

test("headToHeadLoserReasons maps losers to tradeoff copy", () => {
  const losers = headToHeadLoserReasons([
    {
      productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
      winnerId: "gid://shopify/Product/1",
      tradeoff: "Product 1 has lug sole structure; Product 2 is a slip-on.",
    },
  ]);
  assert.equal(
    losers.get("gid://shopify/Product/2"),
    "Product 1 has lug sole structure; Product 2 is a slip-on.",
  );
  assert.equal(losers.has("gid://shopify/Product/1"), false);
});

test("resolveJudgeOmissions prefers llm reason then head-to-head loser", () => {
  const verified = [
    { detail: { id: "gid://shopify/Product/1", title: "Winner" } },
    { detail: { id: "gid://shopify/Product/2", title: "Loser" } },
    { detail: { id: "gid://shopify/Product/3", title: "Cut" } },
  ] as VerifiedCandidate[];
  const placements = [
    {
      productId: "gid://shopify/Product/1",
      tier: 1 as const,
      reason: "Best boot match",
      confidence: "strong" as const,
    },
  ];

  const withLlm = resolveJudgeOmissions(verified, placements, {
    llmOmissions: [
      {
        productId: "gid://shopify/Product/2",
        reason: "Slim sole — not streetwear enough for this brief",
      },
    ],
    headToHead: [
      {
        productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
        winnerId: "gid://shopify/Product/1",
        tradeoff: "Winner has lug sole.",
      },
    ],
    finalistIds: new Set([
      "gid://shopify/Product/1",
      "gid://shopify/Product/2",
    ]),
    triage: [
      {
        productId: "gid://shopify/Product/3",
        verdict: "advance",
        note: "Decent price but silhouette is off-brief",
      },
    ],
  });

  const loser = withLlm.find((o) => o.productId === "gid://shopify/Product/2");
  assert.match(loser?.reason ?? "", /Slim sole/);

  const cut = withLlm.find((o) => o.productId === "gid://shopify/Product/3");
  assert.match(cut?.reason ?? "", /Not selected for deep compare/);
  assert.match(cut?.reason ?? "", /silhouette is off-brief/);

  const withH2hOnly = resolveJudgeOmissions(verified, placements, {
    headToHead: [
      {
        productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
        winnerId: "gid://shopify/Product/1",
        tradeoff: "Winner has lug sole.",
      },
    ],
    finalistIds: new Set([
      "gid://shopify/Product/1",
      "gid://shopify/Product/2",
    ]),
  });
  const h2hLoser = withH2hOnly.find(
    (o) => o.productId === "gid://shopify/Product/2",
  );
  assert.match(h2hLoser?.reason ?? "", /Lost head-to-head/);
  assert.match(h2hLoser?.reason ?? "", /lug sole/);
});
