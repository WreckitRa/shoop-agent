import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFittingVerdictBrief, faceFactsLines } from "./fitting-verdict-brief";

describe("fitting verdict brief", () => {
  it("writes a prose brief from quiz answers, not a JSON dump", () => {
    const brief = buildFittingVerdictBrief({
      hasPhoto: true,
      questionnaireAnswers: {
        identity: {
          preferred_name: "Maya",
          gender_presentation: "womenswear",
          age_range: "25-34",
          style_era: "30s",
          style_era_label: "30s · Prime era",
        },
        goal: "work_polish",
        lifestyle: {
          week_is: "working_mixed,studying",
          weekends_are: "friends,nightlife",
        },
        climate: "hot_humid",
        budget: { philosophy: "premium,best_value" },
        taste: {
          honesty: "3",
          honest_corner: {
            friction: "I look like a student in everything",
            become: "someone who's obviously good at her job",
          },
        },
      },
      measurements: {
        body: { height_cm: 165, weight_kg: 60, body_type: "average" },
      },
      wardrobeInventory: {
        worn: ["relaxed jeans"],
        style_vetoes: [{ value: "crop tops", note: "style" }],
        comfort: [{ value: "no heels", note: "comfort" }],
      },
      userReview: {
        confirmed_paths: ["visible_profile.color.skin_depth"],
        corrections: [],
        rejected_paths: [],
        notes: [],
        submitted_at: new Date().toISOString(),
      },
      photoAnalysis: {
        visible_profile: {
          color: {
            skin_depth: { value: "medium" },
            undertone_hypothesis: { value: "warm" },
            facial_contrast: { value: "medium" },
            eye_color: { value: "dark brown" },
            hair_color: { value: "dark brown" },
          },
        },
      },
    });
    assert.match(brief, /Maya/);
    assert.match(brief, /Womenswear/);
    assert.match(brief, /Look put together at work/);
    assert.match(brief, /I look like a student/);
    assert.match(brief, /Confirmed face facts/);
    assert.match(brief, /What she wears now: relaxed jeans/);
    assert.doesNotMatch(brief, /data_manifest/);
    assert.doesNotMatch(brief, /capture_quality/);
  });

  it("flags unconfirmed face facts when scan-check was skipped", () => {
    const { confirmed, lines } = faceFactsLines(
      {
        visible_profile: {
          color: { skin_depth: { value: "medium" } },
        },
      },
      null,
    );
    assert.equal(confirmed, false);
    assert.ok(lines.some((l) => l.includes("medium")));
  });
});
