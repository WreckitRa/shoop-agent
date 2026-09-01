import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signedInPhotoAgeOk } from "./photo-gate";

describe("signedInPhotoAgeOk", () => {
  it("accepts signup age attestation without a birthday", () => {
    assert.equal(
      signedInPhotoAgeOk({
        birthDate: null,
        ageAttestedAt: new Date("2026-01-01"),
      }),
      true,
    );
  });

  it("accepts a stored adult birthday", () => {
    assert.equal(
      signedInPhotoAgeOk({
        birthDate: "1990-01-15",
        ageAttestedAt: null,
      }),
      true,
    );
  });

  it("rejects an underage birthday even if attested", () => {
    const recent = new Date();
    recent.setUTCFullYear(recent.getUTCFullYear() - 10);
    assert.equal(
      signedInPhotoAgeOk({
        birthDate: recent.toISOString().slice(0, 10),
        ageAttestedAt: new Date(),
      }),
      false,
    );
  });

  it("rejects a signed-in account with neither attestation nor birthday", () => {
    assert.equal(
      signedInPhotoAgeOk({ birthDate: null, ageAttestedAt: null }),
      false,
    );
  });
});
