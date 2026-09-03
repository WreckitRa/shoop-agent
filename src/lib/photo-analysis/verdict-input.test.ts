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
    assert.equal(identity.style_era, "30s");
    assert.equal(lifestyle.week_is, "working_mixed");
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
});
