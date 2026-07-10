"use client";

import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { WelcomeBackBanner } from "@/components/chat/WelcomeBackBanner";
import { HomeQuickActions } from "@/components/chat/HomeQuickActions";
import { useChatGreeting } from "@/components/chat/useChatGreeting";
import { SHOOP_HERO_SHOPPING_SRC } from "@/lib/shared/brand-assets";

export function EmptyChatState() {
  const greeting = useChatGreeting();

  const startConversation = () => {
    const el = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Ask Shoop"]',
    );
    el?.focus({ preventScroll: true });
  };

  return (
    <div className="mt-10 relative z-10 flex min-h-full w-full flex-col overflow-x-hidden pb-2 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4">
      {/* Mobile + tablet — hero only; actions/recent sit above composer in ChatLayout */}
      <div className="mx-auto w-full max-w-page-narrow pt-3 sm:pt-5 lg:hidden">
        <div className="relative shrink-0 overflow-hidden rounded-[28px] border border-hairline bg-page shadow-soft">
          <div className="relative z-10 flex min-h-[200px] flex-col justify-between gap-4 p-5 pr-[46%] sm:min-h-[220px] sm:p-6 sm:pr-[44%]">
            <div className="space-y-2">
              <h1 className="font-serif text-[1.55rem] font-semibold leading-[1.12] tracking-[-0.02em] text-ink sm:text-[1.85rem]">
                Your AI Shopping Assistant
              </h1>
              <p className="max-w-[16rem] text-[13px] leading-relaxed text-ink-secondary sm:text-[14px]">
                Find. Compare. Decide. I&apos;ll handle the rest.
              </p>
            </div>
            <button
              type="button"
              onClick={startConversation}
              className="btn-primary h-10 w-fit gap-1 px-5 text-[13px]"
            >
              Start a conversation
              <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[52%] sm:w-[50%]">
            <Image
              src={SHOOP_HERO_SHOPPING_SRC}
              alt=""
              fill
              priority
              unoptimized
              sizes="(max-width: 1023px) 55vw, 0px"
              className="origin-bottom-right translate-x-8 translate-y-10 scale-[1.56] object-contain object-right-bottom sm:translate-x-10 sm:translate-y-12 md:translate-y-14"
            />
          </div>
        </div>
      </div>

      {/* Desktop — content floats above the centered background figure */}
      <div className="mx-auto hidden min-h-0 w-full max-w-page-wide flex-1 flex-col justify-center lg:flex">
        <div className="w-full max-w-[min(40rem,56%)] space-y-5 xl:space-y-6">
          <p className="shoop-hero-eyebrow">AI Fashion Assistant</p>
          <div className="space-y-3">
            <p className="text-sm font-medium text-ink-muted">{greeting}</p>
            <h1 className="shoop-greeting-h1 text-ink">shop with taste</h1>
            <p className="shoop-hero-copy">
              Curated picks with taste — I search the stores that matter, cut
              the noise, and tell you what&apos;s worth buying.
            </p>
          </div>
          <WelcomeBackBanner />
          <HomeQuickActions />
        </div>
      </div>
    </div>
  );
}
