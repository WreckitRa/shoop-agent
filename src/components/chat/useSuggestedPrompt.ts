"use client";

import { useEffect, useRef, useState } from "react";
import {
  canFetchUserScopedData,
  useAppSessionStore,
} from "@/lib/client/app-session";
import { useChatStore } from "@/components/chat/chat-store";
import { guestFetch } from "@/lib/client/guest-fetch";
import { getClientIdentityScopeKey } from "@/lib/client/identity-sync";

const DEFAULT_PLACEHOLDER = "What are you shopping for?";
const REFRESH_MS = 120_000;

let suggestedPromptInflight: Promise<string | null> | null = null;
let suggestedPromptCacheKey = "";

async function fetchSuggestedPrompt(
  conversationId: string | null,
): Promise<string | null> {
  const cacheKey = `${getClientIdentityScopeKey()}:${conversationId ?? ""}`;
  if (suggestedPromptInflight && suggestedPromptCacheKey === cacheKey) {
    return suggestedPromptInflight;
  }
  suggestedPromptCacheKey = cacheKey;
  suggestedPromptInflight = (async () => {
    const params = new URLSearchParams();
    if (conversationId) {
      params.set("conversationId", conversationId);
    }
    const qs = params.toString();
    const res = await guestFetch(
      `/api/chat/suggested-prompt${qs ? `?${qs}` : ""}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { prompt?: string };
    return json.prompt?.trim() || null;
  })().finally(() => {
    suggestedPromptInflight = null;
  });
  return suggestedPromptInflight;
}

export function useSuggestedPrompt(): string {
  const accessMode = useAppSessionStore((s) => s.mode);
  const authUserId = useAppSessionStore((s) => s.authUserId);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const messageCount = useChatStore((s) => s.messages.length);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const [placeholder, setPlaceholder] = useState(DEFAULT_PLACEHOLDER);
  const wasStreamingRef = useRef(false);

  useEffect(() => {
    if (!canFetchUserScopedData(accessMode)) return;

    let cancelled = false;

    const load = async () => {
      const prompt = await fetchSuggestedPrompt(activeConversationId);
      if (!cancelled && prompt) {
        setPlaceholder(prompt);
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [accessMode, authUserId, activeConversationId]);

  useEffect(() => {
    if (!canFetchUserScopedData(accessMode)) return;
    if (wasStreamingRef.current && !isStreaming) {
      void fetchSuggestedPrompt(activeConversationId).then((prompt) => {
        if (prompt) setPlaceholder(prompt);
      });
    }
    wasStreamingRef.current = isStreaming;
  }, [accessMode, isStreaming, activeConversationId]);

  useEffect(() => {
    if (messageCount === 0 && !activeConversationId) {
      setPlaceholder(DEFAULT_PLACEHOLDER);
    }
  }, [messageCount, activeConversationId]);

  return placeholder;
}
