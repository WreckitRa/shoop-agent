import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { profileSettingsAccess } from "./profile-settings-access";

describe("profileSettingsAccess", () => {
  it("hides account-only actions for guests", () => {
    const access = profileSettingsAccess("guest");
    assert.equal(access.isGuest, true);
    assert.equal(access.hasAccount, false);
    assert.equal(access.showDeleteAccount, false);
    assert.equal(access.showEraseContent, false);
    assert.equal(access.showDataExport, false);
    assert.equal(access.showArbitrationOptOut, false);
    assert.equal(access.showClearGuestVisit, true);
    assert.equal(access.showSignUp, true);
    assert.equal(access.showTwinSettings, true);
    assert.equal(access.canFetchProfile, true);
  });

  it("shows account-only actions when signed in", () => {
    const access = profileSettingsAccess("authenticated");
    assert.equal(access.isGuest, false);
    assert.equal(access.hasAccount, true);
    assert.equal(access.showDeleteAccount, true);
    assert.equal(access.showEraseContent, true);
    assert.equal(access.showDataExport, true);
    assert.equal(access.showArbitrationOptOut, true);
    assert.equal(access.showClearGuestVisit, false);
    assert.equal(access.showSignUp, false);
    assert.equal(access.showTwinSettings, true);
  });

  it("does not treat anonymous as an account", () => {
    const access = profileSettingsAccess("anonymous");
    assert.equal(access.showDeleteAccount, false);
    assert.equal(access.showTwinSettings, false);
    assert.equal(access.canFetchProfile, false);
  });
});
