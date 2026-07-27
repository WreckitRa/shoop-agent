import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ageYearsFromBirthDate,
  formatBottomSizeLabel,
  formatShoeSizeLabel,
  formatTopSizeLabel,
  styleEraFromAge,
  styleEraToAgeRange,
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
});

describe("styleEraFromAge", () => {
  it("guesses an era from birthday age", () => {
    assert.equal(styleEraFromAge(16), "15_17");
    assert.equal(styleEraFromAge(28), "23_29");
    assert.equal(styleEraFromAge(33), "30s");
    assert.equal(styleEraFromAge(70), "65_plus");
  });
});

describe("ageYearsFromBirthDate", () => {
  it("computes age from ISO date", () => {
    const age = ageYearsFromBirthDate("1990-01-15");
    assert.ok(age != null && age >= 30);
  });
});

describe("clothing-tag size labels", () => {
  it("formats shoe sizes across US / EU / UK", () => {
    assert.equal(formatShoeSizeLabel("43"), "US - 10, EU - 43, UK - 9");
  });

  it("formats bottom sizes across US / EU / MX", () => {
    assert.equal(formatBottomSizeLabel("31"), "US - 31, EU - 47, MX - 39");
    assert.equal(formatBottomSizeLabel("32x30"), "US - 32×30, EU - 48, MX - 40");
  });

  it("formats top sizes across US / EU / FR", () => {
    assert.equal(formatTopSizeLabel("M"), "US - M, EU - 50, FR - 40");
  });
});
