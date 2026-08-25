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
        dressingFor: "with_someone",
        kids: "none",
        climate: "hot_humid",
        city: "Beirut",
        country: "Lebanon",
        valuePhilosophy: "premium",
        honestyPreference: "straight",
        complimentPreferences: ["effortless"],
        styleMix: { axes: [{ label: "Minimal", percent: 40 }] },
      },
      sizing: { heightCm: 179, weightKg: 78, bodyType: "athletic" },
      brands: [{ brand: "COS", sentiment: "love" }],
      hardNegatives: [
        { value: "no tight fits", scope: "fit", note: "comfort" },
        { value: "logos", scope: "style" },
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
    assert.equal(body.height_cm, 180);
    assert.equal(body.weight_kg, 79);
    assert.equal(body.muscularity, "high");
    assert.deepEqual(payload.wardrobeInventory.worn, ["navy knit"]);
    assert.deepEqual(payload.wardrobeInventory.comfort, ["no tight fits"]);
    assert.ok(
      (payload.wardrobeInventory.brands_like as string[]).includes("COS"),
    );
  });
});
