"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { GitBranch, Trash2 } from "lucide-react";
import { conversationPath } from "@/lib/shared/chatRoutes";
import {
  buildChatReturnPath,
  parseChatFocusFromSearchParams,
} from "@/lib/shared/chatFocus";
import { isConversationSummaryVisible } from "@/lib/ai-chat/conversation-visibility";
import { useChatStore } from "@/components/chat/chat-store";
import { cn } from "@/lib/ai-chat/cn";

export function ConversationList({
  filterIds,
  searchQuery,
}: {
  filterIds: Set<string>;
  searchQuery: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focusMessageId = useMemo(
    () => parseChatFocusFromSearchParams(searchParams)?.messageId ?? null,
    [searchParams],
  );

  const sidebarNodes = useChatStore((s) => s.sidebarNodes);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const loadingList = useChatStore((s) => s.loadingList);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const visibleNodes = sidebarNodes.filter(
    (n) =>
      isConversationSummaryVisible(n.conversation) &&
      filterIds.has(n.conversation.id),
  );

  const onChatRoute = pathname.startsWith("/c/");

  async function handleConfirmDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteConversation(id);
      setConfirmDeleteId(null);
      setSidebarOpen(false);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="shoop-recent-scroll min-h-0 flex-1 pb-1">
      {visibleNodes.map((node) => {
        const c = node.conversation;
        const isConfirming = confirmDeleteId === c.id;
        const isDeleting = deletingId === c.id;
        const showBranches = node.branches.length > 0;
        const convActive =
          onChatRoute &&
          c.id === activeConversationId &&
          (!focusMessageId ||
            node.branches.every((b) => b.anchorMessageId !== focusMessageId));

        if (isConfirming) {
          return (
            <div
              key={c.id}
              className="rounded-xl border border-hairline bg-surface-tint px-3 py-2"
            >
              <p className="truncate text-[13px] font-medium text-ink">
                Delete “{c.title}”?
              </p>
              <p className="mt-1 text-[11px] leading-snug text-ink-muted">
                Removed from your list. We keep it for memory and history.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded-full px-2 py-1 text-[11px] font-medium text-ink-secondary transition hover:bg-surface-subtle"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => void handleConfirmDelete(c.id)}
                  className="rounded-full bg-brand-soft px-2 py-1 text-[11px] font-medium text-brand-dark transition hover:bg-brand/15 disabled:opacity-60"
                >
                  {isDeleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          );
        }

        return (
          <div key={c.id} className="flex flex-col">
            <div
              className={cn(
                "group flex items-center gap-0.5 rounded-xl transition-colors",
                convActive
                  ? "bg-surface-subtle"
                  : "hover:bg-surface-tint",
              )}
            >
              <Link
                href={conversationPath(c.id)}
                title={c.title}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "min-w-0 flex-1 truncate px-3 py-2.5 text-left text-[13px] leading-[1.4] transition",
                  convActive
                    ? "font-medium text-ink"
                    : "text-ink-secondary hover:text-ink",
                )}
              >
                {c.title}
              </Link>
              <button
                type="button"
                aria-label={`Delete ${c.title}`}
                title="Delete shoop"
                onClick={(e) => {
                  e.preventDefault();
                  setConfirmDeleteId(c.id);
                }}
                className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-white/60 hover:text-error-deep"
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </button>
            </div>
            {showBranches
              ? node.branches.map((branch) => {
                  if (!branch.anchorMessageId) return null;
                  const branchActive =
                    onChatRoute &&
                    c.id === activeConversationId &&
                    focusMessageId === branch.anchorMessageId;
                  return (
                    <Link
                      key={branch.id}
                      href={buildChatReturnPath(c.id, {
                        messageId: branch.anchorMessageId,
                      })}
                      title={branch.title}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        "flex min-w-0 items-center gap-1.5 truncate rounded-lg py-1.5 pl-6 pr-3 text-left text-[12px] leading-[1.35] transition",
                        branchActive
                          ? "bg-surface-subtle font-medium text-ink"
                          : "text-ink-muted hover:bg-surface-tint hover:text-ink-secondary",
                      )}
                    >
                      <GitBranch
                        className="size-3 shrink-0 opacity-70"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <span className="truncate">{branch.title}</span>
                    </Link>
                  );
                })
              : null}
          </div>
        );
      })}
      {loadingList && conversations.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-ink-muted">Loading…</p>
      ) : null}
      {!loadingList && visibleNodes.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-ink-muted">
          {searchQuery ? "No matching shoops" : "No shoops yet"}
        </p>
      ) : null}
    </div>
  );
}
