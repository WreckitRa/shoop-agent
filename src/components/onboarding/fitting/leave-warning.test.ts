import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guestNeedsOnboardingLeaveWarning } from "./leave-warning";

describe("guestNeedsOnboardingLeaveWarning", () => {
  it("warns a guest only while The Fitting overlay is on screen", () => {
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "guest",
        columnOpen: false,
      }),
      false,
    );
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "guest",
        columnOpen: false,
        stageLocked: true,
      }),
      true,
    );
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "loading",
        columnOpen: true,
      }),
      true,
    );
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "anonymous",
        columnOpen: true,
      }),
      true,
    );
  });

  it("does not warn once they have an account, or if Fitting is not open", () => {
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "authenticated",
        columnOpen: true,
        stageLocked: true,
      }),
      false,
    );
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "local",
        columnOpen: true,
      }),
      false,
    );
    assert.equal(
      guestNeedsOnboardingLeaveWarning({
        accessMode: "guest",
        columnOpen: false,
        stageLocked: false,
      }),
      false,
    );
  });
});
