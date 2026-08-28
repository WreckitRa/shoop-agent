"use client";

import { useEffect, useRef } from "react";
import { ProductPageView } from "@/components/commerce/ProductPageView";
import { useInlineProductStore } from "@/components/chat/inline-product-store";
import { chatProductDomId } from "@/lib/shared/chatFocus";

export function InlineChatProductPanel({ onClose }: { onClose: () => void }) {
  const state = useInlineProductStore((s) => s.expanded);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [state?.productId, state?.messageId]);

  const handleClose = () => {
    const productId = state?.productId;
    onClose();
    if (productId) {
      requestAnimationFrame(() => {
        document
          .getElementById(chatProductDomId(productId))
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  };

  if (!state) return null;

  return (
    <div
      ref={panelRef}
      className="shoop-inline-product-bleed"
      data-testid="inline-chat-product-panel"
    >
      <div className="w-full overflow-visible rounded-2xl border border-hairline bg-white shadow-card">
      <ProductPageView
        onClose={handleClose}
        productId={state.productId}
        featuredVariantId={state.featuredVariantId}
        fallbackTitle={state.fallbackTitle}
        fallbackImageUrl={state.fallbackImageUrl}
        prefilledOptions={state.prefilledOptions}
        chatPriceRange={state.chatPriceRange}
        searchId={state.messageId}
        productRef={state.productId}
      />
      </div>
    </div>
  );
}
