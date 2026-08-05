"use client";

import { useState } from "react";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { HomeQuickActions } from "@/components/chat/HomeQuickActions";
import { HomeMirrorCard } from "@/components/chat/HomeMirrorCard";
import { HomeTodayOnYou } from "@/components/chat/HomeTodayOnYou";
import { useChatGreeting } from "@/components/chat/useChatGreeting";

/**
 * Home find UI — matches home-ui-wireframe.html (find → try → decide).
 */
export function EmptyChatState() {
  const greetLine = useChatGreeting();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  return (
    <div className="grid min-h-full flex-1 grid-cols-1 gap-9 py-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-9 lg:py-7">
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

        <HomeTodayOnYou onPreview={setPreviewUrl} />
      </div>

      <HomeMirrorCard
        previewUrl={previewUrl}
        className="mx-auto w-full max-w-sm lg:mx-0 lg:max-w-none"
      />
    </div>
  );
}
