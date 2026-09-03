import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  ONBOARDING_UI_SESSION_KEY,
  clearOnboardingUiSession,
  isFinishingFitting,
  markOnboardingUiDismissed,
  markOnboardingUiResumed,
  readOnboardingUiSession,
  sessionIsMagicLocked,
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

  it("treats an open verdict session as the save-and-close point", () => {
    writeOnboardingUiSession({ step: "verdict", finale: "card" });
    assert.equal(isFinishingFitting(readOnboardingUiSession()), true);
    writeOnboardingUiSession({ step: "circle" });
    assert.equal(isFinishingFitting(readOnboardingUiSession()), true);
    writeOnboardingUiSession({ step: "verdict" });
    markOnboardingUiDismissed();
    assert.equal(isFinishingFitting(readOnboardingUiSession()), false);
  });

  it("keeps Fitting open when looks are waiting to save after signup", () => {
    writeOnboardingUiSession({
      step: "verdict",
      finale: "card",
      saveLooks: true,
      lookJobIds: ["job-1", "job-2"],
    });
    const session = readOnboardingUiSession();
    assert.equal(session?.saveLooks, true);
    assert.deepEqual(session?.lookJobIds, ["job-1", "job-2"]);
    assert.equal(isFinishingFitting(session), true);
  });

  it("locks scan/verdict/circle as the fullscreen sequence", () => {
    writeOnboardingUiSession({ step: "honesty" });
    assert.equal(sessionIsMagicLocked(readOnboardingUiSession()), false);
    writeOnboardingUiSession({ step: "verdict", finale: "scan", locked: true });
    assert.equal(sessionIsMagicLocked(readOnboardingUiSession()), true);
    writeOnboardingUiSession({ step: "circle" });
    assert.equal(sessionIsMagicLocked(readOnboardingUiSession()), true);
    markOnboardingUiDismissed();
    assert.equal(sessionIsMagicLocked(readOnboardingUiSession()), false);
  });
});
