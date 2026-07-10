"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { AppShellProvider } from "@/components/layout/AppShellProvider";
import { parseConversationIdFromPath } from "@/lib/shared/chatRoutes";

function ChatShellInner() {
  const pathname = usePathname();
  const conversationId = useMemo(
    () => parseConversationIdFromPath(pathname) ?? undefined,
    [pathname],
  );

  return (
    <AppShellProvider conversationId={conversationId}>
      <ChatLayout />
    </AppShellProvider>
  );
}

/** Mounted once in `(chat)/layout.tsx` — survives `/` ↔ `/c/:id` navigations. */
export function ChatShell() {
  return (
    <Suspense fallback={null}>
      <ChatShellInner />
    </Suspense>
  );
}
