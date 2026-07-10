"use client";

import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { useChatStore } from "@/components/chat/chat-store";
import { useChatFocusHighlight } from "@/components/chat/ChatFocusHighlightContext";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { cn } from "@/lib/ai-chat/cn";
import { chatMessageDomId } from "@/lib/shared/chatFocus";
import {
  EditUserInline,
  MessageActions,
} from "@/components/chat/MessageActions";
import type { ChatMessage } from "@/lib/ai-chat/types";

/** Active assistant row: sole subscriber to `streamingDraft` → only this subtree updates per token. */
function StreamingAssistantRow({
  message,
}: {
  message: ChatMessage;
}) {
  const draft = useChatStore((s) => s.streamingDraft);

  return (
    <div className="flex flex-col gap-1">
      <MessageBubble message={message} assistantLiveText={draft} />
      <div className="pl-1">
        <MessageActions message={message} showActions={false} />
      </div>
    </div>
  );
}

type StaticRowProps = {
  message: ChatMessage;
  latestUserId: string | null;
  lastAssistantId: string | null;
  isStreaming: boolean;
  streamTargetId: string | null;
  editingUserId: string | null;
  onStartEdit: (id: string) => void;
  endEdit: () => void;
};

const StaticChatRow = memo(
  function StaticChatRow({
    message,
    latestUserId,
    lastAssistantId,
    isStreaming,
    streamTargetId,
    editingUserId,
    onStartEdit,
    endEdit,
  }: StaticRowProps) {
    const regenerateAssistant = useChatStore((s) => s.regenerateAssistant);
    const editUserMessage = useChatStore((s) => s.editUserMessage);

    const streamingThis =
      isStreaming &&
      message.role === "assistant" &&
      message.id === streamTargetId;

    const doneEnough =
      message.status === "completed" ||
      message.status === "stopped" ||
      message.status === "failed";

    const showAssistantActions =
      message.role === "assistant" &&
      doneEnough &&
      !streamingThis &&
      message.id === lastAssistantId;

    const isLatestUser =
      message.role === "user" && message.id === latestUserId;

    const showUserActions =
      message.role === "user" &&
      isLatestUser &&
      !isStreaming &&
      editingUserId !== message.id;

    const onCopy = useCallback(() => {
      void navigator.clipboard.writeText(message.content).catch(() => {});
    }, [message.content]);

    const onRegenerate = useCallback(() => {
      void regenerateAssistant(message.id);
    }, [message.id, regenerateAssistant]);

    const onEdit = useCallback(() => {
      onStartEdit(message.id);
    }, [message.id, onStartEdit]);

    if (message.role === "user" && editingUserId === message.id) {
      return (
        <div className="flex justify-end">
          <EditUserInline
            initial={message.content}
            onCancel={endEdit}
            onSave={(next) => {
              endEdit();
              void editUserMessage(message.id, next);
            }}
          />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1">
        <MessageBubble message={message} />
        <div
          className={
            message.role === "user" ? "flex justify-end pr-1" : "pl-1"
          }
        >
          <MessageActions
            message={message}
            showActions={showAssistantActions || showUserActions}
            onCopy={message.role === "assistant" ? onCopy : undefined}
            onRegenerate={showAssistantActions ? onRegenerate : undefined}
            onEdit={showUserActions ? onEdit : undefined}
          />
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.message === next.message &&
    prev.latestUserId === next.latestUserId &&
    prev.lastAssistantId === next.lastAssistantId &&
    prev.isStreaming === next.isStreaming &&
    prev.streamTargetId === next.streamTargetId &&
    prev.editingUserId === next.editingUserId &&
    prev.onStartEdit === next.onStartEdit &&
    prev.endEdit === next.endEdit,
);

type MessageRowShellProps = {
  messageId: string;
  children: ReactNode;
};

function MessageRowShell({ messageId, children }: MessageRowShellProps) {
  const highlight = useChatFocusHighlight();
  const isFocused =
    highlight?.messageId === messageId &&
    (highlight.productId == null || highlight.productId === "");
  return (
    <div
      id={chatMessageDomId(messageId)}
      data-chat-message-id={messageId}
      className={cn(
        "scroll-mt-24 rounded-2xl transition-[box-shadow,background-color] duration-300",
        isFocused && "chat-message-focus-ring",
      )}
    >
      {children}
    </div>
  );
}

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const sidebarNodes = useChatStore((s) => s.sidebarNodes);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamTargetId = useChatStore((s) => s.streamingAssistantMessageId);

  const branchTitleById = useMemo(() => {
    const node = sidebarNodes.find(
      (n) => n.conversation.id === activeConversationId,
    );
    return new Map((node?.branches ?? []).map((b) => [b.id, b.title]));
  }, [sidebarNodes, activeConversationId]);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const onStartEdit = useCallback((id: string) => {
    setEditingUserId(id);
  }, []);

  const endEdit = useCallback(() => setEditingUserId(null), []);

  const latestIds = useMemo(() => {
    let lastUserId: string | null = null;
    let lastAssistantId: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!lastUserId && m.role === "user") lastUserId = m.id;
      else if (!lastAssistantId && m.role === "assistant") lastAssistantId = m.id;
      if (lastUserId && lastAssistantId) break;
    }
    return { lastUserId, lastAssistantId };
  }, [messages]);

  return (
    <div
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      aria-label="Chat messages"
      className="flex flex-col gap-6 pb-6 pt-4"
    >
      {messages.map((m, index) => {
        const prev = index > 0 ? messages[index - 1] : null;
        const branchChanged =
          Boolean(m.branchId) && m.branchId !== prev?.branchId;
        const branchLabel =
          branchChanged && m.branchId
            ? branchTitleById.get(m.branchId)
            : null;

        const isLiveStream =
          m.role === "assistant" &&
          m.status === "streaming" &&
          m.id === streamTargetId;

        const row = isLiveStream ? (
          <StreamingAssistantRow message={m} />
        ) : (
          <StaticChatRow
            message={m}
            latestUserId={latestIds.lastUserId}
            lastAssistantId={latestIds.lastAssistantId}
            isStreaming={isStreaming}
            streamTargetId={streamTargetId}
            editingUserId={editingUserId}
            onStartEdit={onStartEdit}
            endEdit={endEdit}
          />
        );

        return (
          <div key={m.id} className="flex flex-col gap-3">
            {branchLabel ? (
              <div
                className="flex items-center gap-2 px-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted"
                role="separator"
              >
                <span className="h-px flex-1 bg-hairline-soft" aria-hidden />
                <span>{branchLabel}</span>
                <span className="h-px flex-1 bg-hairline-soft" aria-hidden />
              </div>
            ) : null}
            <MessageRowShell messageId={m.id}>{row}</MessageRowShell>
          </div>
        );
      })}
    </div>
  );
}
