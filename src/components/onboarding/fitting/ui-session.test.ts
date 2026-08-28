import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  ONBOARDING_UI_SESSION_KEY,
  clearOnboardingUiSession,
  markOnboardingUiDismissed,
  markOnboardingUiResumed,
  readOnboardingUiSession,
  writeOnboardingUiSession,
} from "./ui-session";

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
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  Object.assign(globalThis, {
    window: { localStorage, sessionStorage },
    localStorage,
    sessionStorage,
  });
});

describe("onboarding ui session", () => {
  it("remembers step, scan finale, and dismissed across writes", () => {
    writeOnboardingUiSession({ step: "verdict", finale: "card" });
    writeOnboardingUiSession({ circleNames: ["Maya"] });
    markOnboardingUiDismissed();
    const session = readOnboardingUiSession();
    assert.equal(session?.step, "verdict");
    assert.equal(session?.finale, "card");
    assert.equal(session?.dismissed, true);
    assert.deepEqual(session?.circleNames, ["Maya", "", ""]);
    markOnboardingUiResumed();
    assert.equal(readOnboardingUiSession()?.dismissed, false);
  });

  it("keeps a leftover verdict session instead of wiping it when Fitting is already complete", () => {
    writeOnboardingUiSession({ step: "verdict", finale: "card" });
    markOnboardingUiResumed();
    assert.equal(readOnboardingUiSession()?.step, "verdict");
    assert.equal(readOnboardingUiSession()?.finale, "card");
    assert.equal(readOnboardingUiSession()?.dismissed, false);
  });

  it("reads a leftover sessionStorage key after local is empty", () => {
    window.sessionStorage.setItem(
      ONBOARDING_UI_SESSION_KEY,
      JSON.stringify({ step: "circle" }),
    );
    assert.equal(readOnboardingUiSession()?.step, "circle");
    clearOnboardingUiSession();
    assert.equal(readOnboardingUiSession(), null);
  });
});
