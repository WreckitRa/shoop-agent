import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isGuestAccess,
  resolveAppAccessMode,
} from "./app-session";
import { GUEST_SESSION_KEY } from "./guest-storage";

describe("app access mode", () => {
  it("treats a signed-in user as authenticated even with a leftover guest bag", () => {
    const localStorage = {
      getItem: (key: string) =>
        key === GUEST_SESSION_KEY
          ? JSON.stringify({
              guestId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
              createdAt: "2026-01-01",
            })
          : null,
    };
    Object.assign(globalThis, {
      window: { localStorage },
      localStorage,
    });

    assert.equal(
      resolveAppAccessMode({
        authConfigured: true,
        user: { id: "user-1" },
      }),
      "authenticated",
    );
    assert.equal(isGuestAccess("authenticated"), false);
    assert.equal(isGuestAccess("guest"), true);
    assert.equal(isGuestAccess("loading"), false);
  });
});
