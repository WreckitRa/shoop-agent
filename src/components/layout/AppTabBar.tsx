"use client";

import { usePathname, useRouter } from "next/navigation";
import { useChatStore } from "@/components/chat/chat-store";
import { requestMirror } from "@/components/tryon/request-mirror";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { useInlineFittingStore } from "@/components/onboarding/inline-fitting-store";
import { cn } from "@/lib/ai-chat/cn";
import {
  conversationPath,
  isChatRoutePathname,
  NEW_CHAT_PATH,
} from "@/lib/shared/chatRoutes";

type Tab = "stylist" | "mirror" | "board";

/** Persistent mobile chrome — chat, Mirror, moodboard, and the rest of the shell. */
export function AppTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const tryOnOpen = useTryOnDrawerStore((s) => s.open);
  const fittingColumnOpen = useInlineFittingStore((s) => s.columnOpen);
  const dressing = useTryOnDrawerStore(
    (s) => s.status === "starting" || s.status === "processing",
  );

  const current: Tab =
    fittingColumnOpen || tryOnOpen
      ? "mirror"
      : pathname.startsWith("/moodboard")
        ? "board"
        : "stylist";

  function goStylist() {
    useTryOnDrawerStore.getState().close();
    if (isChatRoutePathname(pathname)) return;
    const id = useChatStore.getState().activeConversationId;
    router.push(id ? conversationPath(id) : NEW_CHAT_PATH);
  }

  function goMirror() {
    if (tryOnOpen || fittingColumnOpen) return;
    requestMirror();
  }

  function goBoard() {
    useTryOnDrawerStore.getState().close();
    if (pathname.startsWith("/moodboard")) return;
    router.push("/moodboard");
  }

  return (
    <nav className="shoop-tabbar" aria-label="App">
      <button
        type="button"
        className={cn("shoop-tabbar__tab", current === "stylist" && "is-on")}
        aria-current={current === "stylist" ? "page" : undefined}
        onClick={goStylist}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M4.5 18.5V7.8A2.3 2.3 0 016.8 5.5h10.4A2.3 2.3 0 0119.5 7.8v7.2a2.3 2.3 0 01-2.3 2.3H9.2L4.5 18.5z" />
        </svg>
        Stylist
      </button>
      <button
        type="button"
        className={cn("shoop-tabbar__tab", current === "mirror" && "is-on")}
        aria-current={current === "mirror" ? "page" : undefined}
        onClick={goMirror}
      >
        <span className="relative">
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect x="6" y="3.5" width="12" height="17" rx="3.5" />
            <circle cx="12" cy="10" r="2.4" />
            <path d="M8.6 16.2c.9-1.5 2-2.2 3.4-2.2s2.5.7 3.4 2.2" />
          </svg>
          {dressing ? <i className="shoop-tabbar__live" aria-hidden /> : null}
        </span>
        Mirror
      </button>
      <button
        type="button"
        className={cn("shoop-tabbar__tab", current === "board" && "is-on")}
        aria-current={current === "board" ? "page" : undefined}
        onClick={goBoard}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="4" y="4" width="7" height="7" rx="1.6" />
          <rect x="13" y="4" width="7" height="7" rx="1.6" />
          <rect x="4" y="13" width="7" height="7" rx="1.6" />
          <rect x="13" y="13" width="7" height="7" rx="1.6" />
        </svg>
        Board
      </button>
    </nav>
  );
}
