import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ageYearsFromBirthDate,
  genderPresentationBucket,
  labelsForCsvValues,
  lifestyleTagsFromLife,
  normalizeClimate,
  normalizeHonestyPreference,
  styleEraFromAge,
  styleEraToAgeRange,
  styleErasForAge,
  CLIMATE_OPTIONS,
  WEEK_IS_OPTIONS,
  honestyToneChip,
  whyHereLabel,
} from "./form-options";

describe("styleEraToAgeRange", () => {
  it("maps wireframe eras onto required ageRange values", () => {
    assert.equal(styleEraToAgeRange("13_14"), "13-17");
    assert.equal(styleEraToAgeRange("18_22"), "18-24");
    assert.equal(styleEraToAgeRange("30s"), "25-34");
    assert.equal(styleEraToAgeRange("40s"), "35-44");
    assert.equal(styleEraToAgeRange("65_plus"), "65+");
    assert.equal(styleEraToAgeRange(""), "");
  });

  it("uses the first recognized era in a CSV multi-select", () => {
    assert.equal(styleEraToAgeRange("30s,40s"), "25-34");
  });
});

describe("styleEraFromAge", () => {
  it("guesses an era from birthday age", () => {
    assert.equal(styleEraFromAge(16), "15_17");
    assert.equal(styleEraFromAge(28), "23_29");
    assert.equal(styleEraFromAge(33), "30s");
    assert.equal(styleEraFromAge(70), "65_plus");
  });
});

describe("styleErasForAge", () => {
  it("returns the full list when age is unknown", () => {
    assert.equal(styleErasForAge(null).length, 8);
  });

  it("narrows to a window around the user's age", () => {
    const mid = styleErasForAge(28).map((e) => e.value);
    assert.ok(mid.includes("23_29"));
    assert.ok(mid.includes("30s"));
    assert.ok(!mid.includes("65_plus"));
    assert.ok(mid.length >= 4 && mid.length <= 6);

    const teen = styleErasForAge(16).map((e) => e.value);
    assert.ok(teen.includes("15_17"));
    assert.ok(!teen.includes("50s_60s"));
  });
});

describe("ageYearsFromBirthDate", () => {
  it("computes age from ISO date", () => {
    const age = ageYearsFromBirthDate("1990-01-15");
    assert.ok(age != null && age >= 30);
  });
});

describe("lifestyleTagsFromLife", () => {
  it("maps week + kids onto existing world chips", () => {
    assert.deepEqual(
      lifestyleTagsFromLife({ weekIs: "studying", kids: "none" }),
      ["campus_life"],
    );
    assert.deepEqual(
      lifestyleTagsFromLife({
        weekIs: "working_onsite",
        kids: "young",
      }).sort(),
      ["deep_in_career", "kids_in_the_mix"].sort(),
    );
    assert.deepEqual(
      lifestyleTagsFromLife({ weekIs: "retired", kids: "older" }).sort(),
      ["kids_in_the_mix", "time_is_mine"].sort(),
    );
  });
});

describe("labelsForCsvValues", () => {
  it("maps quiz CSV tokens and other: custom text", () => {
    assert.deepEqual(
      labelsForCsvValues(CLIMATE_OPTIONS, "hot_humid,four_seasons"),
      ["hot and humid", "four seasons"],
    );
    assert.deepEqual(
      labelsForCsvValues(WEEK_IS_OPTIONS, "studying,other:freelance"),
      ["studying", "freelance"],
    );
  });
});

describe("normalizeClimate", () => {
  it("accepts quiz ids and spaced aliases", () => {
    assert.equal(normalizeClimate("hot_humid"), "hot_humid");
    assert.equal(normalizeClimate("hot humid"), "hot_humid");
    assert.equal(normalizeClimate("Four seasons"), "four_seasons");
    assert.equal(normalizeClimate("nope"), "");
  });
});

describe("normalizeHonestyPreference", () => {
  it("maps legacy tones onto the 1–5 scale", () => {
    assert.equal(normalizeHonestyPreference("gentle"), "1");
    assert.equal(normalizeHonestyPreference("straight"), "3");
    assert.equal(normalizeHonestyPreference("no_mercy"), "5");
    assert.equal(normalizeHonestyPreference("1"), "1");
    assert.equal(normalizeHonestyPreference("4"), "4");
    assert.equal(normalizeHonestyPreference(""), "");
  });
});

describe("honestyToneChip", () => {
  it("maps honesty chips onto 1 / 3 / 5 and why-here labels", () => {
    assert.equal(honestyToneChip("gentle"), "1");
    assert.equal(honestyToneChip("2"), "1");
    assert.equal(honestyToneChip("straight"), "3");
    assert.equal(honestyToneChip(""), "3");
    assert.equal(honestyToneChip("5"), "5");
    assert.equal(whyHereLabel("work_polish"), "Look put together at work");
    assert.equal(whyHereLabel("find_style"), "Figure out my style");
    assert.equal(whyHereLabel("other:look sharper"), "look sharper");
    assert.equal(whyHereLabel("dating"), "Dating");
  });
});

describe("genderPresentationBucket", () => {
  it("maps quiz values and legacy aliases onto presentation buckets", () => {
    assert.equal(genderPresentationBucket("menswear"), "masculine");
    assert.equal(genderPresentationBucket("masculine"), "masculine");
    assert.equal(genderPresentationBucket("womenswear"), "feminine");
    assert.equal(genderPresentationBucket("feminine"), "feminine");
    assert.equal(genderPresentationBucket("both"), "androgynous");
    assert.equal(genderPresentationBucket(""), "");
  });
});
