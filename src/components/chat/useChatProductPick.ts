"use client";

import { useMemo } from "react";
import { useChatMessageProductLink } from "@/components/chat/ChatMessageProductLinkContext";
import { useChatStore } from "@/components/chat/chat-store";
import type { CuratedPick } from "@/lib/ai-chat/types";
import {
  fashionPickToCuratedPick,
  fashionVerifiedToCuratedPick,
} from "@/lib/fashion-memory/curation/from-fashion-pick";

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

    // Fashion curation — hero picks carry stylist voice into the PDP
    const fashion = message?.metadata?.fashionCatalogSearch;
    const curated = fashion?.curation?.tiers.picks.find((p) => p.id === productId);
    if (curated) {
      return { pick: fashionPickToCuratedPick(curated), curationPending: false };
    }

    const renderPick = fashion?.render?.tiers.picks.find((p) => p.id === productId);
    if (renderPick) {
      return { pick: fashionPickToCuratedPick(renderPick), curationPending: false };
    }

    const verified = fashion?.curation?.tiers.verified.find(
      (p) => p.id === productId,
    );
    if (verified) {
      return {
        pick: fashionVerifiedToCuratedPick(verified),
        curationPending: false,
      };
    }

    return { pick: null, curationPending: false };
  }, [messageId, messages, productId]);
}
