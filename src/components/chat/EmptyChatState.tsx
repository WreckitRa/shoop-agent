"use client";

import Image from "next/image";
import { ArrowDownRight } from "lucide-react";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { WelcomeBackBanner } from "@/components/chat/WelcomeBackBanner";
import { HomeQuickActions } from "@/components/chat/HomeQuickActions";
import { useChatGreeting } from "@/components/chat/useChatGreeting";
import { SHOOP_HERO_SHOPPING_SRC } from "@/lib/shared/brand-assets";

export function EmptyChatState() {
  const greeting = useChatGreeting();

  return (
    <div className="relative z-10 flex h-full min-h-0 w-full flex-col overflow-hidden lg:overflow-x-hidden lg:overflow-y-auto lg:pb-10">
      {/* Mobile + tablet — hero only; actions/recent sit above composer in ChatLayout */}
      <div className="mx-auto flex h-full min-h-0 w-full max-w-page-narrow items-center py-2 sm:py-4 lg:hidden">
        <div className="relative w-full">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 opacity-25 sm:h-48 sm:w-48">
            <Image
              src={SHOOP_HERO_SHOPPING_SRC}
              alt=""
              fill
              priority
              unoptimized
              sizes="192px"
              className="object-contain"
            />
          </div>
          <div className="relative z-10">
            <p className="shoop-hero-eyebrow">AI Shopping Assistant</p>
            <div className="mt-1.5 flex items-end gap-2 sm:mt-3">
              <h1 className="font-serif text-[2rem] font-semibold leading-[0.98] tracking-[-0.035em] text-ink sm:text-[2.8rem]">
                Find what&apos;s worth buying
              </h1>
              <ArrowDownRight
                className="mb-1 size-7 shrink-0 text-brand"
                strokeWidth={1.5}
                aria-hidden
              />
            </div>
            <p className="mt-2 max-w-[30rem] text-[13px] leading-snug text-ink-secondary sm:mt-3 sm:text-[15px] sm:leading-relaxed">
              Tell me what you need. I&apos;ll search, compare, and cut the
              noise.
            </p>
            <div className="mt-3 sm:mt-5">
              <ChatComposer homeVariant="hero" />
            </div>
          </div>
        </div>
      </div>

      {/* Desktop — content floats above the centered background figure */}
      <div className="mx-auto hidden min-h-0 w-full max-w-page-wide flex-1 flex-col justify-center lg:flex">
        <div className="shoop-home-desktop-content w-full max-w-[min(43rem,62%)] translate-y-8">
          <div className="mt-5">
            <p className="text-sm font-medium text-ink-muted">{greeting}</p>
            <div className="mt-2 flex items-end gap-3">
              <h1 className="shoop-greeting-h1 text-ink">shop with taste</h1>
              <ArrowDownRight
                className="mb-1 size-9 shrink-0 text-brand"
                strokeWidth={1.35}
                aria-hidden
              />
            </div>
            <p className="shoop-hero-copy mt-3 max-w-[36rem]">
              Curated picks with taste — I search the stores that matter, cut
              the noise, and tell you what&apos;s worth buying.
            </p>
          </div>
          <div className="mt-5 xl:mt-6">
            <ChatComposer homeVariant="hero" />
          </div>
          <WelcomeBackBanner />
          <div className="mt-5">
            <HomeQuickActions />
          </div>
        </div>
      </div>
    </div>
  );
}
