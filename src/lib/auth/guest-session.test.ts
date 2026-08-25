import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  guestUserIdFromSessionId,
  isValidGuestSessionToken,
  parseGuestSessionId,
  signGuestSessionId,
} from "./guest-session";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("guest session tokens", () => {
  it("accepts a plain UUID when no HMAC secret is configured", () => {
    const prev = process.env.GUEST_SESSION_HMAC_SECRET;
    delete process.env.GUEST_SESSION_HMAC_SECRET;
    try {
      assert.equal(signGuestSessionId(UUID), UUID);
      assert.equal(parseGuestSessionId(UUID), UUID);
      assert.equal(parseGuestSessionId("not-a-uuid"), null);
      assert.equal(isValidGuestSessionToken(UUID), true);
      assert.equal(guestUserIdFromSessionId(UUID).startsWith("guest-"), true);
    } finally {
      if (prev) process.env.GUEST_SESSION_HMAC_SECRET = prev;
      else delete process.env.GUEST_SESSION_HMAC_SECRET;
    }
  });

  it("rejects unsigned and tampered tokens when an HMAC secret is set", () => {
    const prev = process.env.GUEST_SESSION_HMAC_SECRET;
    process.env.GUEST_SESSION_HMAC_SECRET = "unit-test-guest-secret";
    try {
      const token = signGuestSessionId(UUID);
      assert.notEqual(token, UUID);
      assert.equal(parseGuestSessionId(token), UUID);
      assert.equal(parseGuestSessionId(UUID), null);
      assert.equal(parseGuestSessionId(`${token.slice(0, -1)}0`), null);
    } finally {
      if (prev) process.env.GUEST_SESSION_HMAC_SECRET = prev;
      else delete process.env.GUEST_SESSION_HMAC_SECRET;
    }
  });
});
