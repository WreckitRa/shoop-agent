"use client";

import Link from "next/link";
import { ChevronRight, MessageSquare } from "lucide-react";
import { isConversationSummaryVisible } from "@/lib/ai-chat/conversation-visibility";
import { conversationPath } from "@/lib/shared/chatRoutes";
import { useChatStore } from "@/components/chat/chat-store";

const MAX_RECENT = 3;

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function HomeRecentConversations() {
  const conversations = useChatStore((s) => s.conversations);
  const loadingList = useChatStore((s) => s.loadingList);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);

  const recent = conversations
    .filter(isConversationSummaryVisible)
    .slice(0, MAX_RECENT);

  if (!loadingList && recent.length === 0) return null;

  return (
    <section className="w-full">
      <div className="mb-1.5 flex items-center justify-between gap-3 px-0.5 sm:mb-2.5">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink sm:text-[15px]">
          Recent conversations
        </h2>
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-ink-muted transition hover:text-ink sm:text-[13px]"
        >
          View all
          <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {loadingList && recent.length === 0 ? (
        <p className="px-0.5 py-4 text-sm text-ink-muted">Loading…</p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5 sm:gap-2">
          {recent.map((c) => (
            <li key={c.id}>
              <Link
                href={conversationPath(c.id)}
                className="flex min-h-[64px] min-w-0 flex-col justify-center rounded-xl bg-white/60 px-2 py-1.5 text-center ring-1 ring-hairline/70 transition active:bg-surface-tint sm:min-h-[72px] sm:rounded-2xl sm:px-3 sm:py-2"
              >
                <span className="mx-auto mb-1 flex size-6 shrink-0 items-center justify-center rounded-lg bg-surface-tint text-ink-muted sm:size-7">
                  <MessageSquare
                    className="size-3 sm:size-3.5"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-semibold leading-tight tracking-[-0.01em] text-ink sm:text-[12px]">
                    {c.title}
                  </span>
                  <span className="hidden">
                    Continue where you left off
                  </span>
                </span>
                <span className="mt-0.5 shrink-0 text-[9px] tabular-nums text-ink-muted sm:text-[10px]">
                  {formatRelativeTime(c.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
