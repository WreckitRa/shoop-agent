import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  clearGuestPhotoLive,
  markGuestPhotoLive,
  setGuestClaimInFlight,
  shouldPurgeGuestPhotoOnUnload,
} from "./guest-photo-abandon";

class MemoryStorage {
  #map = new Map<string, string>();
  getItem(key: string) {
    return this.#map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.#map.set(key, String(value));
  }
  removeItem(key: string) {
    this.#map.delete(key);
  }
}

beforeEach(() => {
  const sessionStorage = new MemoryStorage();
  Object.assign(globalThis, {
    window: { sessionStorage },
    sessionStorage,
  });
  setGuestClaimInFlight(false);
  clearGuestPhotoLive();
});

afterEach(() => {
  setGuestClaimInFlight(false);
  clearGuestPhotoLive();
});

describe("shouldPurgeGuestPhotoOnUnload", () => {
  it("does not purge an in-progress Fitting (reload)", () => {
    markGuestPhotoLive();
    assert.equal(
      shouldPurgeGuestPhotoOnUnload({
        persisted: false,
        hasUiSession: true,
        sessionDismissed: false,
      }),
      false,
    );
  });

  it("purges after they dismissed without signing up", () => {
    markGuestPhotoLive();
    assert.equal(
      shouldPurgeGuestPhotoOnUnload({
        persisted: false,
        hasUiSession: true,
        sessionDismissed: true,
      }),
      true,
    );
  });

  it("does not purge bfcache or a claim in flight", () => {
    markGuestPhotoLive();
    assert.equal(
      shouldPurgeGuestPhotoOnUnload({
        persisted: true,
        hasUiSession: false,
        sessionDismissed: undefined,
      }),
      false,
    );
    setGuestClaimInFlight(true);
    assert.equal(
      shouldPurgeGuestPhotoOnUnload({
        persisted: false,
        hasUiSession: false,
        sessionDismissed: undefined,
      }),
      false,
    );
  });
});
