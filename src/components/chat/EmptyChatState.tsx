"use client";

import { ChatComposer } from "@/components/chat/ChatComposer";
import { HomeQuickActions } from "@/components/chat/HomeQuickActions";
import { HomeMirrorCard } from "@/components/chat/HomeMirrorCard";
import { HomeTodayOnYou } from "@/components/chat/HomeTodayOnYou";
import { useChatGreeting } from "@/components/chat/useChatGreeting";

type Props = {
  previewUrl: string | null;
  onPreview: (imageUrl: string | null) => void;
};

/**
 * Home find UI — left column (desktop Mirror lives in ChatLayout).
 * On mobile the full Mirror stacks under the hero.
 */
export function EmptyChatState({ previewUrl, onPreview }: Props) {
  const greetLine = useChatGreeting();

  return (
    <div className="flex min-h-full flex-col py-6 lg:py-7">
      <div className="flex min-w-0 flex-col lg:pt-1">
        <p className="shoop-hero-eyebrow">{greetLine}</p>
        <h1 className="shoop-greeting-h1 mt-1.5">
          What are we
          <br />
          looking for <em>today?</em>
        </h1>
        <p className="shoop-hero-copy mt-2.5 mb-[22px]">
          I search the stores that matter, cut the noise, and show you what&apos;s
          worth buying… <b>on you.</b> Honest verdicts, every time.
        </p>

        <ChatComposer homeVariant="hero" />

        <div className="mt-3.5">
          <HomeQuickActions />
        </div>

        <HomeTodayOnYou onPreview={onPreview} />
      </div>

      <HomeMirrorCard
        previewUrl={previewUrl}
        className="mx-auto mt-9 w-full max-w-sm lg:hidden"
      />
    </div>
  );
}
