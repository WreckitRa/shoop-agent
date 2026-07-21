import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missingRequiredOnboardingFields } from "./status";

describe("missingRequiredOnboardingFields", () => {
  it("requires name, presentation, and age", () => {
    assert.deepEqual(missingRequiredOnboardingFields(null), [
      "preferredName",
      "genderPresentation",
      "ageRange",
    ]);
  });

  it("treats whitespace as missing", () => {
    assert.deepEqual(
      missingRequiredOnboardingFields({
        preferredName: "Raph",
        genderPresentation: " ",
        ageRange: "25_34",
      }),
      ["genderPresentation"],
    );
  });

  it("accepts a complete reviewed profile", () => {
    assert.deepEqual(
      missingRequiredOnboardingFields({
        preferredName: "Raph",
        genderPresentation: "masculine",
        ageRange: "25_34",
      }),
      [],
    );
  });
});
