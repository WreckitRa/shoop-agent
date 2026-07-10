import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  genderFromUserProfile,
  intakeHintsForRecipient,
  type IntakeProfileHints,
} from "./account-profile-bridge";

const mensHints: IntakeProfileHints = {
  genderPresentation: "mens",
  sizeBuckets: new Set(["tops", "bottoms"]),
  preferredName: "Raphael",
  sizeLines: ["tops M (account)"],
};

describe("account profile bridge", () => {
  it("maps onboarding gender presentation to department", () => {
    assert.equal(genderFromUserProfile("masculine"), "mens");
    assert.equal(genderFromUserProfile("Women's"), "womens");
  });

  it("applies account hints only when recipient is self", () => {
    assert.equal(
      intakeHintsForRecipient({ relation: "self" }, mensHints),
      mensHints,
    );
    assert.equal(
      intakeHintsForRecipient({ relation: "mother" }, mensHints),
      null,
    );
    assert.equal(intakeHintsForRecipient({ relation: "wife" }, mensHints), null);
    assert.equal(intakeHintsForRecipient(null, mensHints), null);
  });
});
