"use client";

import { useMemo } from "react";
import { useChatMessageProductLink } from "@/components/chat/ChatMessageProductLinkContext";
import { useChatStore } from "@/components/chat/chat-store";
import type { CuratedPick } from "@/lib/ai-chat/types";

export type ChatProductPickResult = {
  pick: CuratedPick | null;
  /**
   * True when the invocation containing this product still has the Opus
   * curator in-flight. The pick exists (heuristic data) but the real
   * insight / reason / verdict have not been finalised yet.
   */
  curationPending: boolean;
};

/** Curated pick for this product from the parent chat message (if any). */
export function useChatProductPick(productId: string): ChatProductPickResult {
  const messageId = useChatMessageProductLink();
  const messages = useChatStore((s) => s.messages);

  return useMemo(() => {
    if (!messageId) return { pick: null, curationPending: false };
    const message = messages.find((m) => m.id === messageId);
    const searches = message?.metadata?.productSearch?.searches ?? [];
    for (const inv of searches) {
      const pick = inv.curatedPicks?.find((p) => p.id === productId);
      if (pick) {
        return { pick, curationPending: inv.curationPending === true };
      }
    }
    return { pick: null, curationPending: false };
  }, [messageId, messages, productId]);
}
