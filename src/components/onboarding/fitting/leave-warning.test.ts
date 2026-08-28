import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guestNeedsOnboardingLeaveWarning } from "./leave-warning";

describe("guestNeedsOnboardingLeaveWarning", () => {
  it("warns a guest who still has The Fitting open", () => {
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "guest",
        columnOpen: false,
        onboardingActive: true,
      }),
      true,
    );
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "loading",
        columnOpen: true,
        onboardingActive: true,
      }),
      true,
    );
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "anonymous",
        columnOpen: true,
        onboardingActive: false,
      }),
      true,
    );
  });

  it("does not warn once they have an account, or if Fitting is not open", () => {
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "authenticated",
        columnOpen: true,
        onboardingActive: true,
      }),
      false,
    );
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "local",
        columnOpen: true,
        onboardingActive: true,
      }),
      false,
    );
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "guest",
        columnOpen: false,
        onboardingActive: false,
      }),
      false,
    );
  });
});
