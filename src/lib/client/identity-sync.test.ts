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
} from "@/lib/client/identity-sync";

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
    assert.equal(localStorage.getItem("shoop.share-likeness-consent"), null);

    await prepareClientForSignedOut();
    assert.equal(localStorage.getItem(GUEST_SESSION_KEY), null);
    assert.equal(localStorage.getItem(GUEST_DATA_KEY), null);
  });
});
