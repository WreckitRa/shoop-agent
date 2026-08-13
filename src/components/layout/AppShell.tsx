"use client";

import { useChatStore } from "@/components/chat/chat-store";
import {
  ChatSidebar,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
} from "@/components/chat/ChatSidebar";
import { ToastHost } from "@/components/ui/ToastHost";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { TryOnDrawer } from "@/components/tryon/TryOnDrawer";
import { SelfAvatarHost } from "@/components/tryon/SelfAvatarHost";
import { AppTopBar } from "@/components/layout/AppTopBar";
import { AppTabBar } from "@/components/layout/AppTabBar";
import { GuestModeBanner } from "@/components/auth/GuestModeBanner";

export function AppShell({ children }: { children: React.ReactNode }) {
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const sidebarCollapsed = useChatStore((s) => s.sidebarCollapsed);

  return (
    <div
      className="flex h-[100dvh] overflow-hidden"
      style={
        {
          "--chat-sidebar-width": sidebarCollapsed
            ? `${SIDEBAR_WIDTH_COLLAPSED}px`
            : `${SIDEBAR_WIDTH_EXPANDED}px`,
        } as React.CSSProperties
      }
    >
      <ChatSidebar />
      <ToastHost />

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <GuestModeBanner />
          <AppTopBar onOpenSidebar={() => setSidebarOpen(true)} />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
          <AppTabBar />
        </main>
        <TryOnDrawer />
        <SelfAvatarHost />
        <CartDrawer />
      </div>
    </div>
  );
}
