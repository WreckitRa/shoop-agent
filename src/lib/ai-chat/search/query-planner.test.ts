import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSearchBrief } from "./archetype";
import {
  buildGiftShoppingQuestion,
  buildGiftQueryIntent,
  buildPlannerUserPrompt,
} from "./query-planner";
import { portfolioBudget } from "./portfolio-planner-shared";
import {
  dedupeNearSynonyms,
  titleTokenSimilarity,
} from "./query-diversity";
import {
  parseQueryPlannerJson,
  portfolioQueryFromText,
} from "./portfolio-planner-shared";
import { isGiftMerchandiseTitle } from "./gift-merchandise";

describe("gift merchandise detection", () => {
  it("flags gift-box style titles", () => {
    assert.equal(isGiftMerchandiseTitle("Luxury Gift Set for Men"), true);
    assert.equal(isGiftMerchandiseTitle("Wireless Noise Cancelling Headphones"), false);
  });
});

describe("gift shopping question", () => {
  it("frames a recipient + interest + open budget question for the planner", () => {
    const brief = buildSearchBrief({
      query: "holiday gift for friend",
      fields: {
        archetype: "gift_directed",
        direction_label: "Tech & Gadgets",
        use_case: "holidays",
        recipient: {
          kind: "other",
          label: "friend",
          known_interests: ["tech", "gaming"],
        },
        budget_type: "none",
      },
    });
    const q = buildGiftShoppingQuestion({
      ...brief,
      recipient: {
        ...brief.recipient,
        ageRange: "25-34",
      },
    });
    assert.match(q, /products would/i);
    assert.match(q, /enjoy owning/i);
    assert.match(q, /tech/i);
    assert.match(q, /open budget/i);
    assert.match(q, /holidays/i);

    const prompt = JSON.parse(buildPlannerUserPrompt(brief, 5)) as Record<
      string,
      unknown
    >;
    assert.ok(prompt.shopping_context);
    assert.match(String(prompt.shopping_context), /Tech & Gadgets/i);
  });

  it("builds per-query gift intent with product angle", () => {
    const brief = buildSearchBrief({
      query: "gift",
      fields: {
        archetype: "gift_directed",
        recipient: { kind: "other", label: "brother", known_interests: ["tech"] },
      },
    });
    const intent = buildGiftQueryIntent(brief, "mechanical keyboard rgb");
    assert.match(intent, /Gift for brother/i);
    assert.match(intent, /mechanical keyboard/i);
  });
});

describe("query diversity", () => {
  it("dedupes near-synonyms", () => {
    const out = dedupeNearSynonyms([
      "wireless workout earbuds",
      "wireless workout earbuds black",
      "gym duffel bag",
    ]);
    assert.ok(out.length <= 2);
    assert.ok(out.some((t) => t.includes("duffel")));
  });

  it("distinct product types are not near-duplicates", () => {
    const sim = titleTokenSimilarity(
      "wireless workout earbuds",
      "gym duffel bag",
    );
    assert.ok(sim < 0.45);
  });
});

describe("query planner prompt", () => {
  it("includes gift direction, recipient, and budget context", () => {
    const brief = buildSearchBrief({
      query: "gift for hadi birthday",
      fields: {
        direction_label: "Fitness & Sports",
        recipient: { kind: "other", label: "Hadi" },
        budget_type: "soft",
      },
      priceMaxCents: 10_000,
    });
    const prompt = JSON.parse(buildPlannerUserPrompt(brief, 5)) as Record<
      string,
      unknown
    >;
    assert.equal(prompt.direction_label, "Fitness & Sports");
    assert.deepEqual((prompt.recipient as { label: string }).label, "Hadi");
    assert.ok(prompt.budget);
    assert.ok(
      prompt.archetype === "gift_directed" || prompt.archetype === "gift_vague",
    );
  });

  it("scopes planner to within-lane queries when direction is set", () => {
    const brief = buildSearchBrief({
      query: "luxury travel accessories gift",
      fields: {
        archetype: "gift_directed",
        direction_label: "✈️ Luxury Travel Accessories",
        recipient: { kind: "other", label: "wife" },
      },
    });
    const { max } = portfolioBudget(brief.archetype, brief.directionLabel);
    const prompt = JSON.parse(buildPlannerUserPrompt(brief, max)) as Record<
      string,
      unknown
    >;
    assert.equal(prompt.direction_lane, "Luxury Travel Accessories");
    assert.equal(prompt.want_query_count, max);
    assert.match(String(prompt.critical), /WITHIN this single direction/i);
    assert.match(String(prompt.lane_boundary), /Luxury Travel Accessories/i);
    assert.ok(
      (prompt.output_rules as { derive_queries_from?: string })
        .derive_queries_from,
    );
    assert.equal(
      (prompt.output_rules as { good_examples?: string[] }).good_examples,
      undefined,
    );
    assert.match(String(prompt.specialist_role), /Luxury Travel Accessories/i);
  });

  it("culinary travel direction uses LLM-derived queries, not hardcoded examples", () => {
    const brief = buildSearchBrief({
      query: "culinary travel food experience cooking",
      fields: {
        archetype: "gift_directed",
        direction_label: "Culinary Travel & Food Experiences",
        recipient: { kind: "other", label: "wife" },
      },
    });
    const { max } = portfolioBudget(brief.archetype, brief.directionLabel);
    const prompt = JSON.parse(buildPlannerUserPrompt(brief, max)) as Record<
      string,
      unknown
    >;
    assert.match(String(prompt.shopping_context), /Stay strictly inside/i);
    assert.match(
      String(
        (prompt.output_rules as { derive_queries_from?: string })
          .derive_queries_from,
      ),
      /Culinary Travel/i,
    );
    assert.equal(
      (prompt.output_rules as { good_examples?: string[] }).good_examples,
      undefined,
    );
  });

  it("includes broad archetype and gender scope for self-shopping", () => {
    const brief = buildSearchBrief({
      query: "black t-shirt",
      ctx: { buyerGenderScope: "mens" },
    });
    const prompt = JSON.parse(buildPlannerUserPrompt(brief, 5)) as Record<
      string,
      unknown
    >;
    assert.equal(prompt.archetype, "broad");
    assert.equal(prompt.gender_scope, "mens");
    assert.equal(prompt.want_query_count, 5);
  });
});

describe("planner JSON → portfolio rows", () => {
  it("parses LLM output into sanitized catalog queries", () => {
    const brief = buildSearchBrief({
      query: "gift for nephew",
      fields: { direction_label: "Tech" },
    });
    const rows = parseQueryPlannerJson(
      `[{"text":"wireless charging pad gift idea","is_discovery":false},{"text":"mechanical keyboard rgb","is_discovery":true}]`,
    );
    assert.equal(rows.length, 2);
    const q = portfolioQueryFromText(brief, rows[0]!.text, { wave: 2 });
    assert.ok(q);
    assert.equal(q!.text, "wireless charging pad");
    assert.ok(!q!.text.includes("gift"));
  });
});
