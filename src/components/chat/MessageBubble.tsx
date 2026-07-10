"use client";

import { memo } from "react";
import { ClarificationControls } from "@/components/chat/ClarificationControls";
import { GiftDirectionChips } from "@/components/chat/GiftDirectionChips";
import { ChatMessageProductLinkProvider } from "@/components/chat/ChatMessageProductLinkContext";
import { ComposerReplyChip } from "@/components/chat/ComposerReplyChip";
import { CurationLoader } from "@/components/chat/CurationLoader";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { ProductSearchResults } from "@/components/chat/ProductSearchResults";
import { FashionCatalogResults } from "@/components/chat/FashionCatalogResults";
import { FashionRouterControls } from "@/components/chat/FashionRouterControls";
import { cn } from "@/lib/ai-chat/cn";
import type {
  ChatMessage,
  MessageProductSearchV1,
} from "@/lib/ai-chat/types";

/** Real product thumbnails streamed in mid-search, to seed the loader rack. */
function collectStreamedImages(
  productSearch: MessageProductSearchV1 | undefined,
): string[] {
  if (!productSearch?.searches.length) return [];
  const seen = new Set<string>();
  const images: string[] = [];
  for (const search of productSearch.searches) {
    for (const product of search.products) {
      const url = product.imageUrl;
      if (url && !seen.has(url)) {
        seen.add(url);
        images.push(url);
        if (images.length >= 5) return images;
      }
    }
  }
  return images;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  assistantLiveText,
}: {
  message: ChatMessage;
  assistantLiveText?: string;
}) {
  const isUser = message.role === "user";

  const assistantPlain =
    assistantLiveText !== undefined ? assistantLiveText : message.content;

  const productSearch = message.metadata?.productSearch;
  const fashionCatalogSearch = message.metadata?.fashionCatalogSearch;
  const fashionRouter = message.metadata?.fashionRouter;
  const clarification = message.metadata?.clarification;
  const giftDirections = message.metadata?.giftDirections;
  const shoppingMode = message.metadata?.shoppingMode;

  return (
    <div
      className={cn(
        "flex w-full flex-col",
        isUser ? "items-end" : "items-stretch",
      )}
    >
      {isUser ? (
        <div className="tp-bubble flex max-w-[min(480px,100%)] flex-col items-end gap-1.5">
          {message.metadata?.composerReply ? (
            <ComposerReplyChip
              context={message.metadata.composerReply}
              readOnly
              className="max-w-full"
            />
          ) : null}
          <div className="rounded-[20px_20px_6px_20px] bg-surface-tint px-4 py-2.5 text-ink">
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
              {message.content}
            </p>
          </div>
        </div>
      ) : (
        <div className="tp-shoop-reply-enter w-full min-w-0">
          <div
            aria-live={message.status === "streaming" ? "polite" : undefined}
            aria-atomic={message.status === "streaming" ? "false" : undefined}
            className="w-full min-w-0 text-ink"
          >
            {message.status === "streaming" && assistantPlain === "" ? (
              <>
                {clarification?.status === "pending" ? (
                  <>
                    <p className="text-sm text-ink-soft">
                      Here are a few quick questions so I can narrow this down.
                    </p>
                    <ClarificationControls
                      messageId={message.id}
                      clarification={clarification}
                    />
                  </>
                ) : giftDirections?.status === "pending" ? (
                  <GiftDirectionChips
                    messageId={message.id}
                    giftDirections={giftDirections}
                  />
                ) : (
                  <CurationLoader
                    hasSearch={Boolean(productSearch?.searches.length)}
                    productImages={collectStreamedImages(productSearch)}
                  />
                )}
                <StatusRibbon message={message} streamPlain="" />
              </>
            ) : message.status === "streaming" ? (
              <>
                {message.content.trim() || assistantPlain.trim() ? (
                  <MarkdownRenderer source={assistantPlain} />
                ) : clarification?.status === "pending" ? (
                  <p className="text-sm text-ink-soft">
                    Here are a few quick questions so I can narrow this down.
                  </p>
                ) : null}
                {clarification?.status === "pending" ? (
                  <ClarificationControls
                    messageId={message.id}
                    clarification={clarification}
                  />
                ) : null}
                {giftDirections?.status === "pending" ? (
                  <GiftDirectionChips
                    messageId={message.id}
                    giftDirections={giftDirections}
                  />
                ) : null}
                <StatusRibbon message={message} streamPlain={assistantPlain} />
              </>
            ) : (
              <>
                {message.content.trim() ? (
                  <MarkdownRenderer source={message.content} />
                ) : productSearch?.searches.length ? null : (
                  <p className="text-sm text-ink-soft">
                    Here are a few quick questions so I can narrow this down.
                  </p>
                )}
                {clarification ? (
                  <ClarificationControls
                    messageId={message.id}
                    clarification={clarification}
                  />
                ) : null}
                {giftDirections ? (
                  <GiftDirectionChips
                    messageId={message.id}
                    giftDirections={giftDirections}
                  />
                ) : null}
                {fashionRouter ? (
                  <FashionRouterControls
                    messageId={message.id}
                    fashionRouter={fashionRouter}
                  />
                ) : null}
                <StatusRibbon message={message} streamPlain="" />
              </>
            )}
          </div>
        </div>
      )}

      {!isUser && productSearch?.searches.length ? (
        <ChatMessageProductLinkProvider messageId={message.id}>
          <div className="mt-4 w-full">
            <ProductSearchResults
              data={productSearch}
              shoppingMode={shoppingMode?.mode}
            />
          </div>
        </ChatMessageProductLinkProvider>
      ) : null}

      {!isUser && fashionCatalogSearch?.slots.length ? (
        <ChatMessageProductLinkProvider messageId={message.id}>
          <div className="mt-4 w-full">
            <FashionCatalogResults data={fashionCatalogSearch} />
          </div>
        </ChatMessageProductLinkProvider>
      ) : null}
    </div>
  );
});

function StatusRibbon({
  message,
  streamPlain,
}: {
  message: ChatMessage;
  streamPlain: string;
}) {
  if (message.role !== "assistant") return null;

  if (message.status === "streaming" && streamPlain !== "") {
    return (
      <div className="mt-2 text-xs text-ink-muted">
        <span className="inline-block h-3 w-0.5 animate-pulse bg-brand motion-reduce:animate-none" />{" "}
        Writing…
      </div>
    );
  }

  if (message.status === "stopped") {
    return (
      <div className="mt-2 text-xs font-medium text-warning-dark">
        Stopped
      </div>
    );
  }

  if (message.status === "failed") {
    return (
      <div className="mt-2 text-xs font-medium text-brand">
        Failed{message.error ? `: ${message.error}` : ""}
      </div>
    );
  }

  return null;
}
