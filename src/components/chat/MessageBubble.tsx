"use client";

import { memo, type ReactNode } from "react";
import { ShoopIcon } from "@/components/brand/ShoopBrand";
import { useChatStore } from "@/components/chat/chat-store";
import { ChatMessageProductLinkProvider } from "@/components/chat/ChatMessageProductLinkContext";
import { ComposerReplyChip } from "@/components/chat/ComposerReplyChip";
import { CurationLoader } from "@/components/chat/CurationLoader";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { FashionCatalogResults } from "@/components/chat/FashionCatalogResults";
import { FashionCurationResults } from "@/components/chat/FashionCurationResults";
import { FashionRouterControls } from "@/components/chat/FashionRouterControls";
import { cn } from "@/lib/ai-chat/cn";
import { hydratedCandidateToProductCard } from "@/lib/fashion-memory/catalog-search/product-card";
import {
  fashionCatalogHasResults,
  fashionCatalogReadyToDisplay,
} from "@/lib/fashion-memory/catalog-search/display-ready";
import type { MessageFashionCatalogSearchMetaV1 } from "@/lib/fashion-memory/catalog-search/types";
import type { ChatMessage } from "@/lib/ai-chat/types";

/** Real product thumbnails streamed in mid-search, to seed the loader rack. */
function collectStreamedImages(
  fashionCatalogSearch: MessageFashionCatalogSearchMetaV1 | undefined,
  fashionPreviewImages: string[],
): string[] {
  const seen = new Set<string>();
  const images: string[] = [];
  const add = (url?: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    images.push(url);
  };

  for (const url of fashionPreviewImages) {
    add(url);
    if (images.length >= 24) return images;
  }

  for (const slot of fashionCatalogSearch?.slots ?? []) {
    for (const candidate of slot.verified_pool ?? []) {
      add(hydratedCandidateToProductCard(candidate).imageUrl);
      if (images.length >= 24) return images;
    }
  }

  return images;
}

function AssistantLine({ children }: { children: ReactNode }) {
  return (
    <div className="shoop-chat-assistant">
      <ShoopIcon size={24} className="shoop-chat-assistant__mark" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
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

  const fashionCatalogSearch = message.metadata?.fashionCatalogSearch;
  const fashionRouter = message.metadata?.fashionRouter;
  const lookAsk = message.metadata?.lookAsk;
  const streamingFashionPipeline = useChatStore((s) => s.streamingFashionPipeline);
  const streamingFashionPreviewImages = useChatStore(
    (s) => s.streamingFashionPreviewImages,
  );
  const streamingFashionDroppedImages = useChatStore(
    (s) => s.streamingFashionDroppedImages,
  );

  const showFashionLoader =
    message.status === "streaming" &&
    streamingFashionPipeline &&
    !fashionCatalogReadyToDisplay(fashionCatalogSearch);

  const loaderImages = collectStreamedImages(
    fashionCatalogSearch,
    streamingFashionPreviewImages,
  );

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
          <div className="shoop-chat-user">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      ) : (
        <div className="tp-shoop-reply-enter w-full min-w-0">
          <div
            aria-live={message.status === "streaming" ? "polite" : undefined}
            aria-atomic={message.status === "streaming" ? "false" : undefined}
            className="w-full min-w-0 text-ink"
          >
            {showFashionLoader ? (
              <CurationLoader
                pipelineActive
                hasSearch
                productImages={loaderImages}
                droppedImages={streamingFashionDroppedImages}
              />
            ) : message.status === "streaming" && assistantPlain === "" ? (
              <>
                <CurationLoader
                  hasSearch={fashionCatalogHasResults(fashionCatalogSearch)}
                  productImages={loaderImages}
                  droppedImages={streamingFashionDroppedImages}
                />
                <StatusRibbon
                  message={message}
                  streamPlain=""
                  hideWriting={streamingFashionPipeline}
                />
              </>
            ) : message.status === "streaming" ? (
              <>
                {message.content.trim() || assistantPlain.trim() ? (
                  <AssistantLine>
                    <MarkdownRenderer source={assistantPlain} />
                  </AssistantLine>
                ) : null}
                <StatusRibbon
                  message={message}
                  streamPlain={assistantPlain}
                  hideWriting={streamingFashionPipeline}
                />
              </>
            ) : (
              <>
                {message.content.trim() ? (
                  <AssistantLine>
                    <MarkdownRenderer source={message.content} />
                  </AssistantLine>
                ) : fashionCatalogHasResults(fashionCatalogSearch) ? null : (
                  <AssistantLine>
                    <p className="text-sm text-ink-soft">
                      Here are a few quick questions so I can narrow this down.
                    </p>
                  </AssistantLine>
                )}
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

      {!isUser && lookAsk ? (
        <div className="shoop-lookask-chat">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={
              lookAsk.token
                ? `/api/ask/${encodeURIComponent(lookAsk.token)}/image`
                : lookAsk.imageUrl
            }
            alt=""
          />
          <div className="meta">
            <b>Verdict: {lookAsk.verdictTitle}</b>
            <a href={lookAsk.askPath}>Open discussion →</a>
          </div>
        </div>
      ) : null}

      {!isUser &&
      !fashionCatalogSearch?.provisional &&
      fashionCatalogSearch?.curation &&
      fashionCatalogSearch.render ? (
        <ChatMessageProductLinkProvider messageId={message.id}>
          <div className="mt-4 w-full">
            <FashionCurationResults
              data={fashionCatalogSearch}
              searchId={message.id}
            />
          </div>
        </ChatMessageProductLinkProvider>
      ) : null}

      {!isUser &&
      !fashionCatalogSearch?.provisional &&
      fashionCatalogSearch?.slots.length &&
      (!fashionCatalogSearch.curation || !fashionCatalogSearch.render) ? (
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
  hideWriting = false,
}: {
  message: ChatMessage;
  streamPlain: string;
  hideWriting?: boolean;
}) {
  if (message.status === "streaming" && streamPlain !== "" && !hideWriting) {
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
