import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildVerdictPayload } from "./verdict-input";

describe("buildVerdictPayload", () => {
  it("sends height, weight, era, week, mix, and comfort into the stylist payload", () => {
    const payload = buildVerdictPayload({
      profile: {
        genderPresentation: "masculine",
        ageRange: "25-34",
        styleEra: "30s",
        weekIs: "working_mixed",
        weekendsAre: "friends,nightlife,travel",
        dressingFor: "with_someone",
        kids: "none",
        climate: "hot_humid",
        city: "Beirut",
        country: "Lebanon",
        valuePhilosophy: "premium",
        honestyPreference: "straight",
        styleFriction: "hoodies every day",
        styleBecome: "more put-together",
        complimentPreferences: ["effortless"],
        styleMix: { axes: [{ label: "Minimal", percent: 40 }] },
      },
      sizing: { heightCm: 179, weightKg: 78, bodyType: "athletic" },
      brands: [
        {
          brand: "COS",
          sentiment: "love",
          reasons: ["clean cuts", "quiet colour"],
        },
      ],
      hardNegatives: [
        {
          value: "no tight fits",
          scope: "fit",
          note: "comfort",
          reason: "health",
        },
        {
          value: "logos",
          scope: "style",
          note: "reads cheap on me",
          reason: "taste",
        },
      ],
      tasteTags: [
        { tag: "navy knit", category: "worn" },
        { tag: "tailored", category: "aspirational" },
      ],
      confirmedBody: {
        height_cm: 180,
        weight_kg: 79,
        body_type: "athletic",
        muscularity: "high",
        body_shape: "inverted_triangle",
        bust_fullness: null,
        leg_line: "even",
      },
    });

    const identity = payload.questionnaireAnswers.identity as Record<
      string,
      unknown
    >;
    const lifestyle = payload.questionnaireAnswers.lifestyle as Record<
      string,
      unknown
    >;
    const body = payload.measurements.body as Record<string, unknown>;
    assert.equal(payload.questionnaireAnswers.goal, "with_someone");
    assert.equal(payload.questionnaireAnswers.goal_label, "With someone");
    assert.equal(lifestyle.week_is, "working_mixed");
    assert.equal(lifestyle.week_is_label, "Mix of home and office");
    assert.equal(lifestyle.weekends_are, "friends,nightlife,travel");
    assert.equal(
      lifestyle.weekends_are_label,
      "Out with friends, Nightlife, Traveling",
    );
    assert.equal(body.height_cm, 180);
    assert.equal(body.weight_kg, 79);
    assert.equal(body.muscularity, "high");
    assert.deepEqual(payload.wardrobeInventory.worn, ["navy knit"]);
    assert.deepEqual(payload.wardrobeInventory.comfort, [
      { value: "no tight fits", note: "comfort", reason: "health" },
    ]);
    assert.deepEqual(payload.wardrobeInventory.style_vetoes, [
      { value: "logos", note: "reads cheap on me", reason: "taste" },
    ]);
    const brands = payload.wardrobeInventory.brands as Array<
      Record<string, unknown>
    >;
    assert.deepEqual(brands, [
      {
        brand: "COS",
        sentiment: "love",
        reasons: ["clean cuts", "quiet colour"],
      },
    ]);
    const corner = payload.wardrobeInventory.honest_corner as {
      friction: string;
      become: string;
    };
    assert.equal(corner.friction, "hoodies every day");
    assert.equal(corner.become, "more put-together");
    const taste = payload.questionnaireAnswers.taste as {
      honest_corner: { friction: string; become: string };
    };
    assert.equal(taste.honest_corner.become, "more put-together");
    assert.ok(
      (payload.wardrobeInventory.brands_like as string[]).includes("COS"),
    );
  });

  it("sends only the worn looks they picked, not exploded catalog tags", () => {
    const payload = buildVerdictPayload({
      profile: { genderPresentation: "masculine" },
      sizing: {},
      brands: [],
      hardNegatives: [],
      tasteTags: [
        { tag: "athleisure", category: "worn" },
        { tag: "hoodie", category: "worn" },
        { tag: "knit", category: "worn" },
        { tag: "easy", category: "worn" },
        { tag: "sporty", category: "worn" },
        { tag: "smart casual", category: "worn" },
        { tag: "blazer", category: "worn" },
        { tag: "smart", category: "worn" },
        { tag: "casual", category: "worn" },
        { tag: "clean", category: "worn" },
        { tag: "smart_casual", category: "worn" },
        { tag: "resort and holiday", category: "worn" },
        { tag: "linen", category: "worn" },
        { tag: "resort", category: "worn" },
        { tag: "holiday", category: "worn" },
        { tag: "coastal", category: "worn" },
        { tag: "resort_holiday", category: "worn" },
        { tag: "boho", category: "worn" },
        { tag: "street", category: "worn" },
      ],
    });
    assert.deepEqual(payload.wardrobeInventory.worn, [
      "Athleisure",
      "Smart casual",
      "Resort and holiday",
    ]);
  });

  it("labels multi-select week, climate, and spend CSVs for the model", () => {
    const payload = buildVerdictPayload({
      profile: {
        genderPresentation: "womenswear",
        weekIs: "working_mixed,studying",
        kids: "young,older",
        climate: "hot_humid,four_seasons",
        valuePhilosophy: "premium,best_value",
      },
      sizing: {},
      brands: [],
      hardNegatives: [],
      tasteTags: [],
    });
    const lifestyle = payload.questionnaireAnswers.lifestyle as Record<
      string,
      unknown
    >;
    const budget = payload.questionnaireAnswers.budget as Record<
      string,
      unknown
    >;
    assert.equal(
      lifestyle.week_is_label,
      "Mix of home and office, Studying",
    );
    assert.equal(lifestyle.kids_label, "Young kids, Older kids");
    assert.equal(
      payload.questionnaireAnswers.climate_label,
      "Hot and humid, Four seasons",
    );
    assert.equal(budget.philosophy_label, "Quality first, Smart value");
  });
});
