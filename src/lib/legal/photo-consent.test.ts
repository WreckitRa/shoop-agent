import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEGAL_DOC_VERSION } from "./constants";
import { guestPhotoConsentSatisfied } from "./photo-consent";

const ok = {
  withdrawnAt: null,
  documentVersion: LEGAL_DOC_VERSION,
  ageAttested: true,
  ownPhotoAttested: true,
  abandonDeleteAck: true,
};

describe("guest photo consent", () => {
  it("requires every fitting tick on the current document", () => {
    assert.equal(guestPhotoConsentSatisfied(ok), true);
    assert.equal(guestPhotoConsentSatisfied(null), false);
    assert.equal(guestPhotoConsentSatisfied({ ...ok, ageAttested: false }), false);
    assert.equal(
      guestPhotoConsentSatisfied({ ...ok, ownPhotoAttested: false }),
      false,
    );
    assert.equal(
      guestPhotoConsentSatisfied({ ...ok, abandonDeleteAck: false }),
      false,
    );
    assert.equal(
      guestPhotoConsentSatisfied({ ...ok, documentVersion: "old" }),
      false,
    );
    assert.equal(
      guestPhotoConsentSatisfied({ ...ok, withdrawnAt: new Date() }),
      false,
    );
  });
});
