import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signGuestSessionId } from "@/lib/auth/guest-session";
import {
  fashionOwnerUserId,
  isFashionMemoryGuestUserId,
  isSupabaseAuthUserId,
} from "./auth";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("fashionOwnerUserId", () => {
  it("passes through an auth uuid", () => {
    assert.equal(isSupabaseAuthUserId(UUID), true);
    assert.equal(fashionOwnerUserId(UUID), UUID);
  });

  it("strips the guest- prefix for uuid columns", () => {
    const guest = `guest-${UUID}`;
    assert.equal(isFashionMemoryGuestUserId(guest), true);
    assert.equal(isSupabaseAuthUserId(guest), false);
    assert.equal(fashionOwnerUserId(guest), UUID);
  });

  it("strips a signed guest token leftover", () => {
    const prev = process.env.GUEST_SESSION_HMAC_SECRET;
    process.env.GUEST_SESSION_HMAC_SECRET = "unit-test-guest-secret";
    try {
      const token = signGuestSessionId(UUID);
      assert.equal(fashionOwnerUserId(`guest-${token}`), UUID);
    } finally {
      if (prev) process.env.GUEST_SESSION_HMAC_SECRET = prev;
      else delete process.env.GUEST_SESSION_HMAC_SECRET;
    }
  });

  it("rejects junk", () => {
    assert.equal(fashionOwnerUserId("guest-nope"), null);
    assert.equal(fashionOwnerUserId("not-a-user"), null);
  });
});
