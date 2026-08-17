"use client";

import Link from "next/link";
import { memo, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  LogIn,
  LogOut,
  Plus,
  Settings,
  Share2,
} from "lucide-react";
import { isConversationSummaryVisible } from "@/lib/ai-chat/conversation-visibility";
import { useChatStore } from "@/components/chat/chat-store";
import { ConversationList } from "@/components/chat/ConversationList";
import { ConversationSearch } from "@/components/chat/ConversationSearch";
import { SidebarMenuSection } from "@/components/chat/SidebarMenuSection";
import { SidebarUserFooter } from "@/components/chat/SidebarUserFooter";
import {
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
  sidebarRailBadgeClass,
  sidebarRailButtonClass,
  sidebarRailIconClass,
  sidebarSectionLabelClass,
} from "@/components/chat/sidebar-styles";
import {
  LISTS_COMING_SOON_TOAST,
  ORDERS_COMING_SOON_TOAST,
} from "@/lib/client/coming-soon-toasts";
import { ShoopIcon, ShoopSidebarBrand } from "@/components/brand/ShoopBrand";
import { isChatRoutePathname, NEW_CHAT_PATH } from "@/lib/shared/chatRoutes";
import { useShowSettingsBadge } from "@/hooks/useUserIdentity";
import { useToastStore } from "@/lib/client/toast-store";
import { openAuthModal, useGuestMode } from "@/hooks/useGuestMode";
import { prepareClientForSignedOut } from "@/lib/client/identity-sync";
import { cn } from "@/lib/ai-chat/cn";

export {
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
} from "@/components/chat/sidebar-styles";

function RailBadge({ count }: { count: number }) {
  return <span className={sidebarRailBadgeClass}>{count}</span>;
}

function CollapsedSidebarExpandTrigger() {
  const toggleSidebarCollapsed = useChatStore((s) => s.toggleSidebarCollapsed);

  return (
    <button
      type="button"
      aria-label="Expand sidebar"
      title="Expand sidebar"
      onClick={() => toggleSidebarCollapsed()}
      className="group relative mb-2 flex size-9 items-center justify-center rounded-[10px] transition hover:bg-surface-tint"
    >
      <ShoopIcon
        size={28}
        className="rounded-lg transition-opacity group-hover:opacity-0"
      />
      <ChevronRight
        className="absolute size-4 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100"
        strokeWidth={1.75}
        aria-hidden
      />
    </button>
  );
}

function SidebarCollapsedRail({ onNewShoop }: { onNewShoop: () => void }) {
  const showToast = useToastStore((s) => s.show);
  const showSettingsBadge = useShowSettingsBadge();
  const { isGuest } = useGuestMode();
  const [logoutBusy, setLogoutBusy] = useState(false);

  const logout = async () => {
    setLogoutBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      await prepareClientForSignedOut();
      window.dispatchEvent(new Event("shoop-auth-changed"));
    } finally {
      setLogoutBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col items-center">
      <CollapsedSidebarExpandTrigger />

      <button
        type="button"
        title="New Shoop"
        aria-label="New Shoop"
        onClick={onNewShoop}
        className={cn(sidebarRailButtonClass, "my-0.5")}
      >
        <Plus className={sidebarRailIconClass} strokeWidth={1.75} />
      </button>

      <div aria-hidden className="h-2 shrink-0" />

      <Link
        href="/moodboard"
        title="Moodboard"
        aria-label="Moodboard"
        className={cn(sidebarRailButtonClass, "my-0.5")}
      >
        <Heart className={sidebarRailIconClass} strokeWidth={1.75} />
      </Link>

      <Link
        href="/asks"
        title="Shared cards"
        aria-label="Shared cards"
        className={cn(sidebarRailButtonClass, "my-0.5")}
      >
        <Share2 className={sidebarRailIconClass} strokeWidth={1.75} />
      </Link>

      <button
        type="button"
        title="Orders"
        aria-label="Orders"
        onClick={() => showToast(ORDERS_COMING_SOON_TOAST)}
        className={cn(sidebarRailButtonClass, "my-0.5")}
      >
        <Clock className={sidebarRailIconClass} strokeWidth={1.75} />
      </button>

      <button
        type="button"
        title="My lists"
        aria-label="My lists"
        onClick={() => showToast(LISTS_COMING_SOON_TOAST)}
        className={cn(sidebarRailButtonClass, "my-0.5")}
      >
        <Bookmark className={sidebarRailIconClass} strokeWidth={1.75} />
      </button>

      <div className="mt-auto flex flex-col items-center gap-0.5 pb-1 pt-3">
        <Link
          href="/profile"
          title="Settings"
          aria-label="Settings"
          className={cn(sidebarRailButtonClass, "my-0.5")}
        >
          <Settings className={sidebarRailIconClass} strokeWidth={1.75} />
          {showSettingsBadge ? <RailBadge count={1} /> : null}
        </Link>

        {isGuest ? (
          <button
            type="button"
            title="Sign in"
            aria-label="Sign in"
            onClick={() => openAuthModal("login")}
            className={cn(sidebarRailButtonClass, "my-0.5")}
          >
            <LogIn className={sidebarRailIconClass} strokeWidth={1.75} />
          </button>
        ) : (
          <button
            type="button"
            title="Log out"
            aria-label="Log out"
            disabled={logoutBusy}
            onClick={() => void logout()}
            className={cn(
              sidebarRailButtonClass,
              "my-0.5 text-brand hover:bg-brand-soft hover:text-brand-dark disabled:opacity-50",
            )}
          >
            <LogOut className={sidebarRailIconClass} strokeWidth={1.75} />
          </button>
        )}
      </div>
    </div>
  );
}

export const ChatSidebar = memo(function ChatSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const createConversationAndNavigate = useChatStore(
    (s) => s.createConversationAndNavigate,
  );
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const sidebarCollapsed = useChatStore((s) => s.sidebarCollapsed);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const toggleSidebarCollapsed = useChatStore((s) => s.toggleSidebarCollapsed);
  const sidebarNodes = useChatStore((s) => s.sidebarNodes);
  const conversations = useChatStore((s) => s.conversations);

  const [searchQuery, setSearchQuery] = useState("");

  const filteredIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const visible = sidebarNodes.filter((n) =>
      isConversationSummaryVisible(n.conversation),
    );
    if (!q) return new Set(visible.map((n) => n.conversation.id));
    return new Set(
      visible
        .filter(
          (n) =>
            n.conversation.title.toLowerCase().includes(q) ||
            n.branches.some((b) => b.title.toLowerCase().includes(q)),
        )
        .map((n) => n.conversation.id),
    );
  }, [sidebarNodes, searchQuery]);

  const handleNewShoop = () => {
    void createConversationAndNavigate();
    // Product/profile pages mount outside `(chat)` — ensure we leave even if
    // the store navigate callback is momentarily unset during route transitions.
    if (!isChatRoutePathname(pathname)) {
      router.replace(NEW_CHAT_PATH);
    }
    setSidebarOpen(false);
  };

  return (
    <>
      <aside
        className={cn(
          "shoop-sidebar-desktop fixed inset-y-0 left-0 z-[100] flex h-[100dvh] shrink-0 flex-col overflow-hidden border-r border-hairline bg-white py-4 font-sans transition-[transform,width] duration-[220ms] ease-out",
          "w-[260px] px-3.5 lg:relative lg:translate-x-0",
          sidebarCollapsed
            ? "lg:w-[64px] lg:items-center lg:px-0"
            : "lg:w-[260px]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {sidebarCollapsed ? (
          <div className="hidden min-h-0 flex-1 flex-col lg:flex">
            <SidebarCollapsedRail onNewShoop={handleNewShoop} />
          </div>
        ) : null}

        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            sidebarCollapsed && "lg:hidden",
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <Link
              href={NEW_CHAT_PATH}
              onClick={(e) => {
                e.preventDefault();
                handleNewShoop();
              }}
              className="cursor-pointer px-3 py-0.5"
              aria-label="Shoop home"
            >
              <ShoopSidebarBrand />
            </Link>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-[10px] text-ink-muted transition hover:bg-surface-tint hover:text-ink lg:hidden"
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              <ChevronLeft className="size-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="hidden size-8 items-center justify-center rounded-[10px] text-ink-muted transition hover:bg-surface-tint hover:text-ink lg:inline-flex"
              aria-label="Collapse sidebar"
              onClick={() => toggleSidebarCollapsed()}
            >
              <ChevronLeft className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleNewShoop}
            className="flex h-11 w-full items-center gap-2 rounded-full border border-hairline bg-white px-4 text-sm font-medium text-ink shadow-soft transition hover:bg-surface-tint"
          >
            <Plus className="size-4 shrink-0" strokeWidth={1.75} />
            New chat
          </button>

          <SidebarMenuSection />

          <div className="mt-6 flex min-h-0 flex-1 flex-col overflow-hidden">
            <p className={sidebarSectionLabelClass}>Chats</p>
            <ConversationSearch value={searchQuery} onChange={setSearchQuery} />
            <ConversationList
              filterIds={filteredIds}
              searchQuery={searchQuery.trim()}
            />
          </div>

          <SidebarUserFooter />
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Dismiss sidebar"
          className="fixed inset-0 z-[99] bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
    </>
  );
});
