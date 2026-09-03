"use client";

import { usePathname, useRouter } from "next/navigation";
import { useChatStore } from "@/components/chat/chat-store";
import { requestMirror } from "@/components/tryon/request-mirror";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { useInlineFittingStore } from "@/components/onboarding/inline-fitting-store";
import { closeYouOverlays } from "@/lib/client/close-you-overlays";
import { cn } from "@/lib/ai-chat/cn";
import {
  conversationPath,
  isChatRoutePathname,
  NEW_CHAT_PATH,
} from "@/lib/shared/chatRoutes";

type Tab = "flick" | "find" | "board" | "you";

/** Persistent mobile chrome — The Flick, Find, Board, You. */
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
      ? "flick"
      : pathname.startsWith("/moodboard")
        ? "board"
        : pathname.startsWith("/profile")
          ? "you"
          : "find";

  function goFind() {
    closeYouOverlays();
    if (isChatRoutePathname(pathname)) return;
    const id = useChatStore.getState().activeConversationId;
    router.push(id ? conversationPath(id) : NEW_CHAT_PATH);
  }

  function goFlick() {
    if (tryOnOpen || fittingColumnOpen) return;
    requestMirror();
  }

  function goBoard() {
    closeYouOverlays();
    if (pathname.startsWith("/moodboard")) return;
    router.push("/moodboard");
  }

  function goYou() {
    closeYouOverlays();
    if (pathname.startsWith("/profile")) return;
    router.push("/profile");
  }

  return (
    <nav className="shoop-tabbar" aria-label="App">
      <button
        type="button"
        className={cn("shoop-tabbar__tab", current === "flick" && "is-on")}
        aria-current={current === "flick" ? "page" : undefined}
        onClick={goFlick}
      >
        <span className="relative">
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect x="4" y="6" width="16" height="15" rx="3" />
            <path d="M12 3v6M9 6l3-3 3 3" />
          </svg>
          {dressing ? <i className="shoop-tabbar__live" aria-hidden /> : null}
        </span>
        The Flick
      </button>
      <button
        type="button"
        className={cn("shoop-tabbar__tab", current === "find" && "is-on")}
        aria-current={current === "find" ? "page" : undefined}
        onClick={goFind}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        Find
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
      <button
        type="button"
        className={cn("shoop-tabbar__tab", current === "you" && "is-on")}
        aria-current={current === "you" ? "page" : undefined}
        onClick={goYou}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20a7.5 7.5 0 0115 0" />
        </svg>
        You
      </button>
    </nav>
  );
}
