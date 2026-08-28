"use client";

import { useEffect, useState } from "react";
import {
  invalidateConversationListFetch,
  useChatStore,
} from "@/components/chat/chat-store";
import { useCartStore } from "@/components/cart/cart-store";
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import { clearPendingFittingPhoto } from "@/components/onboarding/fitting/pending-photo";
import { useInlineFittingStore } from "@/components/onboarding/inline-fitting-store";
import {
  clearOnboardingUiSession,
  readOnboardingUiSession,
} from "@/components/onboarding/fitting/ui-session";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import {
  canFetchUserScopedData,
  resolveAppAccessMode,
  useAppSessionStore,
} from "@/lib/client/app-session";
import { leaveConversationRoute } from "@/lib/client/chat-navigation";
import { clearGuestSession, getGuestSessionId } from "@/lib/client/guest-storage";
import { clearPendingCheckout } from "@/lib/client/pending-checkout";
import { useUserProfileStore } from "@/lib/client/user-profile-store";
import { clearChatFocusReturn } from "@/lib/shared/chatFocus";

/** Ensures the next sign-in always re-syncs even after `prepareClientForSignedOut`. */
const SIGNED_OUT_SCOPE_KEY = "__signed_out__";

const LIKENESS_CONSENT_KEY = "shoop.share-likeness-consent";

type AuthSessionPayload = {
  configured: boolean;
  user: { id: string; email: string | null } | null;
};

export async function fetchAuthSession(): Promise<AuthSessionPayload> {
  const res = await fetch("/api/auth/session", { cache: "no-store" });
  if (!res.ok) throw new Error("session");
  return (await res.json()) as AuthSessionPayload;
}

export function applyAuthSession(session: AuthSessionPayload) {
  useAppSessionStore.getState().syncFromAuth({
    authConfigured: session.configured,
    user: session.user,
  });
}

/** Drop cached greeting/profile UI tied to the previous user or guest. */
export function resetClientUserPresentation() {
  useUserProfileStore.getState().reset();
}

/** Drop chat lists/messages from the previous identity. */
export function resetChatForNewIdentity() {
  useChatStore.getState().activeStream?.abortController.abort();
  invalidateConversationListFetch();
  useChatStore.setState({
    conversations: [],
    sidebarNodes: [],
    intentPollSinceByConversation: {},
    messages: [],
    activeConversationId: null,
    conversationMeta: null,
    input: "",
    composerReplyContext: null,
    queuedSendText: null,
    isStreaming: false,
    streamingAssistantMessageId: null,
    streamingDraft: "",
    streamingNarration: [],
    streamingFashionPipeline: false,
    streamingFashionPreviewImages: [],
    streamingFashionDroppedImages: [],
    activeStream: null,
    error: null,
    loadingList: false,
    loadingMessages: false,
    pendingFashionClarification: null,
  });
}

export function clearIdentityScopedBrowserStorage() {
  if (typeof window === "undefined") return;
  clearOnboardingUiSession();
  try {
    localStorage.removeItem(LIKENESS_CONSENT_KEY);
  } catch {
    /* ignore */
  }
  clearPendingCheckout();
  clearChatFocusReturn();
}

/**
 * Zero every client store that belongs to a person — chats, twin, looks, cart,
 * onboarding chrome — before hydrating the next identity.
 *
 * `preserveOnboarding`: guest → account during Fitting. Keep the column open
 * and the UI resume key so onboarding continues in place after signup.
 */
export function resetUserScopedClientState(opts?: {
  preserveOnboarding?: boolean;
}) {
  const preserve = opts?.preserveOnboarding === true;
  const fitting = useInlineFittingStore.getState();
  const keepFittingOpen =
    preserve && (fitting.columnOpen || fitting.onboardingActive);

  resetClientUserPresentation();
  resetChatForNewIdentity();
  useCartStore.getState().resetForIdentityChange();
  useSelfAvatarStore.getState().resetForIdentityChange();
  useTryOnDrawerStore.getState().resetForIdentityChange();
  useInlineProductStore.getState().collapse();

  if (preserve) {
    useInlineFittingStore.setState({
      columnOpen: keepFittingOpen,
      onboardingActive: keepFittingOpen,
      columnDismissed: false,
      replayFitting: keepFittingOpen,
      pendingLeave: false,
    });
    clearPendingCheckout();
    clearChatFocusReturn();
    return;
  }

  useInlineFittingStore.setState({
    columnOpen: false,
    onboardingActive: false,
    columnDismissed: false,
    replayFitting: false,
    pendingLeave: false,
  });
  clearIdentityScopedBrowserStorage();
  clearPendingFittingPhoto();
}

function scopeKeyForSession(session: AuthSessionPayload): string {
  const mode = resolveAppAccessMode({
    authConfigured: session.configured,
    user: session.user,
  });
  if (session.user) return `user:${session.user.id}`;
  const guestId = getGuestSessionId();
  if (mode === "guest" && guestId) return `guest:${guestId}`;
  return `mode:${mode}`;
}

/**
 * Stable key for UI that must refetch when the signed-in user or guest session
 * changes (greeting, resume hint, sidebar lists, …).
 */
export function getClientIdentityScopeKey(): string {
  const { mode, authUserId } = useAppSessionStore.getState();
  if (mode === "authenticated" && authUserId) return `user:${authUserId}`;
  const guestId = getGuestSessionId();
  if (mode === "guest" && guestId) return `guest:${guestId}`;
  return `mode:${mode}`;
}

/** Reactive scope key — remount/refetch UI when the signed-in user or guest bag changes. */
export function useClientIdentityScopeKey(): string {
  const mode = useAppSessionStore((s) => s.mode);
  const authUserId = useAppSessionStore((s) => s.authUserId);
  const [guestId, setGuestId] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setGuestId(getGuestSessionId());
    sync();
    window.addEventListener("shoop-guest-changed", sync);
    window.addEventListener("shoop-auth-changed", sync);
    return () => {
      window.removeEventListener("shoop-guest-changed", sync);
      window.removeEventListener("shoop-auth-changed", sync);
    };
  }, [mode, authUserId]);

  if (mode === "authenticated" && authUserId) return `user:${authUserId}`;
  if (mode === "guest" && guestId) return `guest:${guestId}`;
  return `mode:${mode}`;
}

let resyncQueue: Promise<void> = Promise.resolve();
let lastSyncedScopeKey: string | null = null;

/** Wipe live stores only when the person actually changed — never on a same-guest ping. */
export function shouldWipeClientIdentity(opts: {
  previousScopeKey: string | null;
  scopeKey: string;
}): boolean {
  return (
    opts.previousScopeKey !== null && opts.previousScopeKey !== opts.scopeKey
  );
}

/** Serialize identity transitions so fetches never run with stale cookies/mode. */
export function queueClientIdentityResync(
  _reason: "auth" | "guest" = "auth",
  opts?: { force?: boolean; preserveOnboarding?: boolean },
) {
  resyncQueue = resyncQueue
    .then(() =>
      resyncClientAfterIdentityChange(
        opts?.force === true,
        opts?.preserveOnboarding === true,
      ),
    )
    .catch(() => {
      /* swallow — individual steps set UI errors when needed */
    });
  return resyncQueue;
}

async function resyncClientAfterIdentityChange(
  force = false,
  preserveOnboarding = false,
): Promise<void> {
  const previousScopeKey = lastSyncedScopeKey;
  const session = await fetchAuthSession();
  applyAuthSession(session);

  const scopeKey = scopeKeyForSession(session);
  const scopeChanged = shouldWipeClientIdentity({
    previousScopeKey,
    scopeKey,
  });
  const isFirstHydration = previousScopeKey === null;
  const sameIdentity = previousScopeKey === scopeKey;

  if (sameIdentity && previousScopeKey !== null) {
    lastSyncedScopeKey = scopeKey;
    const chat = useChatStore.getState();
    const mode = useAppSessionStore.getState().mode;
    if (!canFetchUserScopedData(mode)) return;
    if (
      !force &&
      (chat.conversations.length > 0 || chat.loadingList)
    ) {
      return;
    }
    await useChatStore.getState().fetchConversations({
      background: !force && chat.conversations.length > 0,
    });
    if (force) {
      void useCartStore.getState().refresh();
      void useSelfAvatarStore.getState().refresh();
    }
    return;
  }

  if (scopeChanged) {
    resetUserScopedClientState({ preserveOnboarding });
  }
  if (scopeChanged && !preserveOnboarding) {
    leaveConversationRoute();
  }
  if (preserveOnboarding) {
    const session = readOnboardingUiSession();
    if (session?.dismissed !== true) {
      const fitting = useInlineFittingStore.getState();
      if (fitting.columnOpen || fitting.onboardingActive) {
        useInlineFittingStore.getState().openColumn();
        useInlineFittingStore.getState().setOnboardingActive(true);
      }
    }
  }

  lastSyncedScopeKey = scopeKey;

  const mode = useAppSessionStore.getState().mode;
  if (!canFetchUserScopedData(mode)) return;

  if (canFetchUserScopedData(mode)) {
    await useUserProfileStore.getState().hydrate({
      force: scopeChanged || force,
    });
  }

  await useChatStore.getState().fetchConversations({
    background:
      !scopeChanged &&
      !force &&
      !isFirstHydration &&
      useChatStore.getState().conversations.length > 0,
  });
  if (scopeChanged || force || isFirstHydration) {
    void useCartStore.getState().refresh();
    void useSelfAvatarStore.getState().refresh();
  }
}

/**
 * Call right after logout before broadcasting auth change.
 * Drops the previous person from memory and does not resume their guest bag.
 */
export async function prepareClientForSignedOut() {
  clearGuestSession();
  lastSyncedScopeKey = SIGNED_OUT_SCOPE_KEY;
  applyAuthSession({ configured: true, user: null });
  resetUserScopedClientState();
  leaveConversationRoute();
}
