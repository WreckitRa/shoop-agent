"use client";

import { ChatComposer } from "@/components/chat/ChatComposer";
import { HomeQuickActions } from "@/components/chat/HomeQuickActions";
import { HomeTodayOnYou } from "@/components/chat/HomeTodayOnYou";
import { useChatGreeting } from "@/components/chat/useChatGreeting";
import { cn } from "@/lib/ai-chat/cn";

type Props = {
  previewUrl: string | null;
  onPreview: (imageUrl: string | null) => void;
  /** 40/40/20 onboarding — tighter hero so it fits the chat pane. */
  compact?: boolean;
};

/**
 * Home find UI — left column (desktop Mirror lives in ChatLayout).
 * Mobile chrome (peek + tabs) lives in AppShell.
 */
export function EmptyChatState({ onPreview, compact }: Props) {
  const greetLine = useChatGreeting();

  return (
    <div
      className={cn(
        "flex min-h-full flex-col",
        compact ? "shoop-onboard-home" : "py-5 lg:py-7",
      )}
    >
      <div className={cn("flex min-w-0 flex-col", !compact && "lg:pt-1")}>
        <p className="shoop-hero-eyebrow hidden lg:block">{greetLine}</p>
        <h1 className={cn("shoop-greeting-h1", compact ? "mt-1" : "mt-1.5")}>
          What are we
          <br />
          looking for <em>today?</em>
        </h1>
        <p
          className={cn(
            "shoop-hero-copy",
            compact ? "mb-3.5 mt-2" : "mb-[22px] mt-2.5",
          )}
        >
          I search the stores that matter, cut the noise, and show you what&apos;s
          worth buying… <b>on you.</b> Honest verdicts, every time.
        </p>

        <ChatComposer homeVariant="hero" />

        <p className="shoop-find-lab">Try these</p>
        <div className={compact ? "mt-2.5" : "mt-3.5"}>
          <HomeQuickActions className="shoop-week" />
        </div>

        {compact ? null : <HomeTodayOnYou onPreview={onPreview} />}
      </div>
    </div>
  );
}
