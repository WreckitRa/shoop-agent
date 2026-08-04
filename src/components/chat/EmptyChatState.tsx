"use client";

import { ChatComposer } from "@/components/chat/ChatComposer";
import { HomeQuickActions } from "@/components/chat/HomeQuickActions";
import { HomeMirrorCard } from "@/components/chat/HomeMirrorCard";
import { useChatGreeting } from "@/components/chat/useChatGreeting";

/**
 * Home empty state — Fitting look (find → try → decide).
 * Left: greeting + ask + chips. Right: THE MIRROR avatar card (HTML prototype).
 */
export function EmptyChatState() {
  const greetLine = useChatGreeting();

  return (
    <div className="grid min-h-full flex-1 grid-cols-1 gap-8 py-6 md:gap-9 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-9 lg:py-8">
      <div className="flex min-w-0 flex-col justify-center lg:pt-2">
        <p className="shoop-hero-eyebrow">{greetLine}</p>
        <h1 className="shoop-greeting-h1 mt-1.5">
          What are we
          <br />
          looking for <em>today?</em>
        </h1>
        <p className="shoop-hero-copy mt-2.5">
          I search the stores that matter, cut the noise, and show you what&apos;s
          worth buying… <b>on you.</b> Honest verdicts, every time.
        </p>

        <div className="mt-5 max-w-[40rem]">
          <ChatComposer homeVariant="hero" />
        </div>
        <div className="mt-3.5 max-w-[40rem]">
          <HomeQuickActions />
        </div>
      </div>

      <HomeMirrorCard className="mx-auto w-full max-w-sm lg:mx-0 lg:max-w-none" />
    </div>
  );
}
