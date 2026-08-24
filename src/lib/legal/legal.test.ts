import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideSignupRegion } from "./geo-gate";
import { assertSignupAge, parseIsoBirthDate } from "./age-gate";
import { isShareLive, shareExpiresAt } from "./share-lifetime";
import { SHARE_TTL_MS, MIN_ACCOUNT_AGE } from "./constants";
import { analyticsAllowed, defaultCookiePrefs } from "./cookie-prefs";

describe("signup geo-gate", () => {
  it("allows US and unknown country", () => {
    assert.equal(decideSignupRegion("US").ok, true);
    assert.equal(decideSignupRegion(null).ok, true);
  });

  it("blocks non-US account creation", () => {
    const gb = decideSignupRegion("GB");
    assert.equal(gb.ok, false);
    const de = decideSignupRegion("DE");
    assert.equal(de.ok, false);
  });
});

describe("signup age-gate", () => {
  it("rejects invalid dates", () => {
    assert.equal(parseIsoBirthDate("2026-13-01"), null);
    assert.equal(assertSignupAge("not-a-date").ok, false);
  });

  it("rejects under the configured minimum age", () => {
    const recent = new Date();
    recent.setFullYear(recent.getFullYear() - (MIN_ACCOUNT_AGE - 1));
    const iso = recent.toISOString().slice(0, 10);
    const result = assertSignupAge(iso);
    assert.equal(result.ok, false);
  });

  it("accepts the configured minimum age and above", () => {
    const older = new Date();
    older.setFullYear(older.getFullYear() - 20);
    const iso = older.toISOString().slice(0, 10);
    const result = assertSignupAge(iso);
    assert.equal(result.ok, true);
  });
});

describe("cookie prefs", () => {
  it("does not allow analytics before a choice", () => {
    assert.equal(analyticsAllowed(defaultCookiePrefs()), false);
  });
});

describe("share link lifetime", () => {
  it("expires after 7 days", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const expiresAt = shareExpiresAt(createdAt);
    assert.equal(expiresAt.getTime() - createdAt.getTime(), SHARE_TTL_MS);
    assert.equal(
      isShareLive({ createdAt, expiresAt, revokedAt: null }),
      Date.now() < expiresAt.getTime(),
    );
  });

  it("is dead once revoked", () => {
    const createdAt = new Date();
    assert.equal(
      isShareLive({
        createdAt,
        expiresAt: shareExpiresAt(createdAt),
        revokedAt: new Date(),
      }),
      false,
    );
  });
});
