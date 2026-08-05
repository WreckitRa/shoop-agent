import {
  invalidateConversationListFetch,
  useChatStore,
} from "@/components/chat/chat-store";
import { useCartStore } from "@/components/cart/cart-store";
import {
  canFetchUserScopedData,
  resolveAppAccessMode,
  useAppSessionStore,
} from "@/lib/client/app-session";
import { leaveConversationRoute } from "@/lib/client/chat-navigation";
import { getGuestSessionId } from "@/lib/client/guest-storage";
import { useUserProfileStore } from "@/lib/client/user-profile-store";

/** Ensures the next sign-in always re-syncs even after `prepareClientForSignedOut`. */
const SIGNED_OUT_SCOPE_KEY = "__signed_out__";

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
  invalidateConversationListFetch();
  useChatStore.setState({
    conversations: [],
    sidebarNodes: [],
    intentPollSinceByConversation: {},
    messages: [],
    activeConversationId: null,
    conversationMeta: null,
    input: "",
    queuedSendText: null,
    error: null,
    loadingList: false,
    loadingMessages: false,
  });
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

let resyncQueue: Promise<void> = Promise.resolve();
let lastSyncedScopeKey: string | null = null;

/** Serialize identity transitions so fetches never run with stale cookies/mode. */
export function queueClientIdentityResync(
  _reason: "auth" | "guest" = "auth",
  opts?: { force?: boolean },
) {
  resyncQueue = resyncQueue
    .then(() => resyncClientAfterIdentityChange(opts?.force === true))
    .catch(() => {
      /* swallow — individual steps set UI errors when needed */
    });
  return resyncQueue;
}

async function resyncClientAfterIdentityChange(force = false): Promise<void> {
  const previousScopeKey = lastSyncedScopeKey;
  const session = await fetchAuthSession();
  applyAuthSession(session);

  const scopeKey = scopeKeyForSession(session);
  const scopeChanged =
    previousScopeKey !== null && scopeKey !== previousScopeKey;
  // First time we resolve an identity this session: nothing is hydrated yet, so
  // we must do an initial fetch even though the scope hasn't "changed".
  const isFirstHydration = previousScopeKey === null;

  if (!force && !scopeChanged && previousScopeKey === scopeKey) {
    // First attempt may have raced auth (401) and left an empty sidebar — retry.
    const chat = useChatStore.getState();
    const mode = useAppSessionStore.getState().mode;
    if (
      chat.conversations.length > 0 ||
      chat.loadingList ||
      !canFetchUserScopedData(mode)
    ) {
      return;
    }
    await useChatStore.getState().fetchConversations({ background: false });
    return;
  }

  if (scopeChanged || force) {
    resetClientUserPresentation();
    resetChatForNewIdentity();
  }
  if (scopeChanged) {
    leaveConversationRoute();
  }

  lastSyncedScopeKey = scopeKey;

  const mode = useAppSessionStore.getState().mode;
  if (!canFetchUserScopedData(mode)) return;

  if (mode === "authenticated") {
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
  }
}

/** Call right after logout before broadcasting auth change. */
export async function prepareClientForSignedOut() {
  lastSyncedScopeKey = SIGNED_OUT_SCOPE_KEY;
  applyAuthSession({ configured: true, user: null });
  resetClientUserPresentation();
  resetChatForNewIdentity();
  leaveConversationRoute();
}
