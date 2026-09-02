import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { useCartStore } from "@/components/cart/cart-store";
import { useChatStore } from "@/components/chat/chat-store";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import {
  GUEST_DATA_KEY,
  GUEST_SESSION_KEY,
} from "@/lib/client/guest-storage";
import {
  clearIdentityScopedBrowserStorage,
  prepareClientForSignedOut,
  resetUserScopedClientState,
  shouldWipeClientIdentity,
} from "@/lib/client/identity-sync";
import {
  getPendingFittingPhoto,
  setPendingFittingPhoto,
} from "@/components/onboarding/fitting/pending-photo";
import { useInlineFittingStore } from "@/components/onboarding/inline-fitting-store";

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
  clear() {
    this.#map.clear();
  }
  key(index: number) {
    return [...this.#map.keys()][index] ?? null;
  }
  get length() {
    return this.#map.size;
  }
}

function installBrowserStorage() {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const windowLike = {
    localStorage,
    sessionStorage,
    location: { pathname: "/", replace: () => {} },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.assign(globalThis, {
    window: windowLike,
    localStorage,
    sessionStorage,
  });
  return { localStorage, sessionStorage };
}

beforeEach(() => {
  installBrowserStorage();
  resetUserScopedClientState();
});

describe("identity reset", () => {
  it("drops chats, twin, and looks so the next identity starts empty", () => {
    useChatStore.setState({
      conversations: [
        {
          id: "conv_prev",
          title: "Previous chat",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          archived: false,
          deletedAt: null,
          pinned: false,
          model: "test",
          responseStyle: "default",
          temperature: 0.7,
          maxTokens: 1024,
          systemPrompt: null,
        },
      ],
      messages: [
        {
          id: "msg_prev",
          conversationId: "conv_prev",
          role: "user",
          content: "keep me?",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      activeConversationId: "conv_prev",
    });
    useSelfAvatarStore.setState({
      status: "ready",
      personId: "person_prev",
      avatarUrl: "https://cdn.example/twin.jpg",
    });
    useTryOnDrawerStore.setState({
      rackIds: ["look_1"],
      activeIds: ["look_1"],
      resultUrl: "https://cdn.example/look.jpg",
    });
    useCartStore.getState().resetForIdentityChange();

    resetUserScopedClientState();

    const chat = useChatStore.getState();
    assert.equal(chat.conversations.length, 0);
    assert.equal(chat.messages.length, 0);
    assert.equal(chat.activeConversationId, null);
    assert.equal(useSelfAvatarStore.getState().avatarUrl, null);
    assert.equal(useSelfAvatarStore.getState().status, "unknown");
    assert.deepEqual(useTryOnDrawerStore.getState().rackIds, []);
    assert.equal(useTryOnDrawerStore.getState().resultUrl, null);
  });

  it("clears onboarding resume and guest bag on sign-out", async () => {
    const { localStorage, sessionStorage } = installBrowserStorage();
    sessionStorage.setItem(
      "shoop.onboarding.ui.v4",
      JSON.stringify({ step: "verdict" }),
    );
    localStorage.setItem(
      "shoop.onboarding.ui.v4",
      JSON.stringify({ step: "verdict" }),
    );
    localStorage.setItem("shoop.share-likeness-consent", "1");
    localStorage.setItem(
      GUEST_SESSION_KEY,
      JSON.stringify({ guestId: "guest-old", createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    localStorage.setItem(
      GUEST_DATA_KEY,
      JSON.stringify({ guestId: "guest-old", conversations: [{ id: "c1" }] }),
    );

    clearIdentityScopedBrowserStorage();
    assert.equal(sessionStorage.getItem("shoop.onboarding.ui.v4"), null);
    assert.equal(localStorage.getItem("shoop.onboarding.ui.v4"), null);
    assert.equal(localStorage.getItem("shoop.share-likeness-consent"), null);

    await prepareClientForSignedOut();
    assert.equal(localStorage.getItem(GUEST_SESSION_KEY), null);
    assert.equal(localStorage.getItem(GUEST_DATA_KEY), null);
  });

  it("preserves Fitting column and resume key across guest→user signup", () => {
    const { sessionStorage } = installBrowserStorage();
    sessionStorage.setItem(
      "shoop.onboarding.ui.v4",
      JSON.stringify({ step: "photo" }),
    );
    useInlineFittingStore.setState({
      columnOpen: true,
      onboardingActive: true,
      columnDismissed: false,
      replayFitting: true,
    });

    resetUserScopedClientState({ preserveOnboarding: true });

    assert.equal(
      sessionStorage.getItem("shoop.onboarding.ui.v4"),
      JSON.stringify({ step: "photo" }),
    );
    const fitting = useInlineFittingStore.getState();
    assert.equal(fitting.columnOpen, true);
    assert.equal(fitting.onboardingActive, true);
    assert.equal(fitting.columnDismissed, false);
    assert.equal(fitting.stageLocked, false);
  });

  it("keeps Fitting fullscreen across guest→user signup on the mint", () => {
    const { sessionStorage } = installBrowserStorage();
    sessionStorage.setItem(
      "shoop.onboarding.ui.v4",
      JSON.stringify({ step: "verdict", finale: "scan", locked: true }),
    );
    useInlineFittingStore.setState({
      columnOpen: true,
      onboardingActive: true,
      stageLocked: true,
      columnDismissed: false,
      replayFitting: true,
    });

    resetUserScopedClientState({ preserveOnboarding: true });

    const fitting = useInlineFittingStore.getState();
    assert.equal(fitting.columnOpen, true);
    assert.equal(fitting.stageLocked, true);
    assert.equal(
      sessionStorage.getItem("shoop.onboarding.ui.v4"),
      JSON.stringify({ step: "verdict", finale: "scan", locked: true }),
    );
  });

  it("keeps a held fitting photo across guest→user signup, and drops it otherwise", () => {
    const file = new File(["x"], "face.jpg", { type: "image/jpeg" });
    setPendingFittingPhoto(file);
    resetUserScopedClientState({ preserveOnboarding: true });
    assert.equal(getPendingFittingPhoto(), file);

    resetUserScopedClientState();
    assert.equal(getPendingFittingPhoto(), null);
  });
});

describe("shouldWipeClientIdentity", () => {
  it("does not wipe on first hydration or the same guest", () => {
    assert.equal(
      shouldWipeClientIdentity({
        previousScopeKey: null,
        scopeKey: "guest:abc",
      }),
      false,
    );
    assert.equal(
      shouldWipeClientIdentity({
        previousScopeKey: "guest:abc",
        scopeKey: "guest:abc",
      }),
      false,
    );
  });

  it("wipes only when the person actually changed", () => {
    assert.equal(
      shouldWipeClientIdentity({
        previousScopeKey: "guest:abc",
        scopeKey: "user:1",
      }),
      true,
    );
    assert.equal(
      shouldWipeClientIdentity({
        previousScopeKey: "__signed_out__",
        scopeKey: "guest:abc",
      }),
      true,
    );
  });
});
