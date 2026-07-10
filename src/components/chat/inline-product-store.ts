"use client";

import { create } from "zustand";
import { useCartStore } from "@/components/cart/cart-store";
import { useChatStore } from "@/components/chat/chat-store";
import type { InlineProductState } from "@/lib/shared/productPanelParams";

type InlineProductStore = {
  expanded: InlineProductState | null;
  expand: (state: InlineProductState) => void;
  collapse: () => void;
};

export const useInlineProductStore = create<InlineProductStore>((set) => ({
  expanded: null,
  expand: (state) => {
    useCartStore.getState().setDrawerOpen(false);
    useChatStore.getState().setSidebarOpen(false);
    set({ expanded: state });
  },
  collapse: () => set({ expanded: null }),
}));

export function isInlineProductExpanded(
  messageId: string | null | undefined,
  productId: string,
): boolean {
  const { expanded } = useInlineProductStore.getState();
  return expanded?.messageId === messageId && expanded?.productId === productId;
}
