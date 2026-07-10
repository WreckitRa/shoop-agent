import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  observationTargetsBuyer,
  stripChatProtectedIdentityFields,
} from "./observation-scope";

describe("observationTargetsBuyer", () => {
  it("returns false for gift_recipient signals", () => {
    assert.equal(
      observationTargetsBuyer({
        signalType: "gift_recipient",
        scope: "recipient",
        recipientLabel: "friend",
      }),
      false,
    );
  });

  it("returns false when scope is recipient", () => {
    assert.equal(
      observationTargetsBuyer({
        signalType: "size",
        scope: "recipient",
        recipientLabel: undefined,
      }),
      false,
    );
  });

  it("returns false when recipientLabel is set on non-recipient signal", () => {
    assert.equal(
      observationTargetsBuyer({
        signalType: "profile",
        scope: "global",
        recipientLabel: "friend",
      }),
      false,
    );
  });

  it("returns true for buyer-scoped profile observations", () => {
    assert.equal(
      observationTargetsBuyer({
        signalType: "profile",
        scope: "global",
        recipientLabel: undefined,
      }),
      true,
    );
  });
});

describe("stripChatProtectedIdentityFields", () => {
  it("removes identity fields from profile projection data", () => {
    const data = {
      preferredName: "James",
      ageRange: "25-34",
      genderPresentation: "masculine",
      country: "Lebanon",
    };
    stripChatProtectedIdentityFields(data);
    assert.deepEqual(data, { country: "Lebanon" });
  });
});
