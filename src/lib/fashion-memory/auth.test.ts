import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

  it("rejects junk", () => {
    assert.equal(fashionOwnerUserId("guest-nope"), null);
    assert.equal(fashionOwnerUserId("not-a-user"), null);
  });
});
