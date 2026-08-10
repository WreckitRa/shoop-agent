import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTryonPersonUuid,
  tryonUserFacingError,
} from "./resolve-person";
import { TryonCapError } from "./generations";

describe("isTryonPersonUuid", () => {
  it("accepts real uuids", () => {
    assert.equal(
      isTryonPersonUuid("6ceb40fe-6257-4cea-af96-03dd8221b858"),
      true,
    );
  });

  it("rejects roster short ids", () => {
    assert.equal(isTryonPersonUuid("#abcd"), false);
    assert.equal(isTryonPersonUuid("abcd"), false);
  });
});

describe("tryonUserFacingError", () => {
  it("maps avatar required to a shopper line", () => {
    const out = tryonUserFacingError(new Error("Avatar required"));
    assert.match(out.message, /Shoop card/i);
    assert.equal(out.status, 400);
  });

  it("never leaks Prisma uuid / Turbopack noise", () => {
    const out = tryonUserFacingError(
      new Error(
        'Invalid `prisma.tryonGeneration.create()` invocation in /Users/…/.next/dev/server/chunks/[root-of-the-server]__0omgl3f._.js:868:178 Inconsistent column data: Error creating UUID, invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `#` at 1',
      ),
    );
    assert.equal(out.message, "Couldn't dress this one — try another piece.");
    assert.doesNotMatch(out.message, /prisma|uuid|#|turbopack/i);
    assert.equal(out.status, 500);
  });

  it("preserves cap errors", () => {
    const out = tryonUserFacingError(new TryonCapError("Daily try-on limit reached."));
    assert.match(out.message, /limit/i);
    assert.equal(out.status, 429);
  });
});
