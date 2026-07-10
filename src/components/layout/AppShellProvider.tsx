"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  canFetchUserScopedData,
  useAppSessionStore,
} from "@/lib/client/app-session";
import { queueClientIdentityResync } from "@/lib/client/identity-sync";
import { useChatStore } from "@/components/chat/chat-store";

export function AppShellProvider({
  conversationId,
  preserveConversation = false,
  children,
}: {
  conversationId?: string;
  /** Keep chat state when leaving chat routes (e.g. product / profile pages). */
  preserveConversation?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const accessMode = useAppSessionStore((s) => s.mode);
  const setNavigate = useChatStore((s) => s.setNavigate);
  const syncRouteConversationId = useChatStore((s) => s.syncRouteConversationId);

  useEffect(() => {
    setNavigate((path) => {
      router.replace(path);
    });
    return () => setNavigate(null);
  }, [router, setNavigate]);

  useEffect(() => {
    if (!canFetchUserScopedData(accessMode)) return;
    void queueClientIdentityResync("auth");
  }, [accessMode]);

  // Hard-refresh safety net: if identity sync raced auth and left an empty
  // sidebar, kick another resync once the session is definitely ready.
  useEffect(() => {
    if (!canFetchUserScopedData(accessMode)) return;
    const t = window.setTimeout(() => {
      const { conversations, loadingList } = useChatStore.getState();
      if (conversations.length > 0 || loadingList) return;
      void queueClientIdentityResync("auth");
    }, 600);
    return () => window.clearTimeout(t);
  }, [accessMode]);

  useEffect(() => {
    const onAuthChanged = () => {
      void queueClientIdentityResync("auth", { force: true });
    };
    const onGuestChanged = () => {
      void queueClientIdentityResync("guest", { force: true });
    };
    window.addEventListener("shoop-auth-changed", onAuthChanged);
    window.addEventListener("shoop-guest-changed", onGuestChanged);
    return () => {
      window.removeEventListener("shoop-auth-changed", onAuthChanged);
      window.removeEventListener("shoop-guest-changed", onGuestChanged);
    };
  }, []);

  useEffect(() => {
    if (preserveConversation) return;
    if (accessMode === "loading") return;
    syncRouteConversationId(conversationId);
  }, [conversationId, accessMode, preserveConversation, syncRouteConversationId]);

  return <>{children}</>;
}
