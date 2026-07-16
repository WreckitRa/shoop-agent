"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { CartButton } from "@/components/cart/CartButton";
import { TryOnTopBarButton } from "@/components/tryon/TryOnTopBarButton";
import { ProfileAvatarLink } from "@/components/auth/ProfileAvatarLink";
import { CatalogLocalizationBar } from "@/components/layout/CatalogLocalizationBar";
import { ShoopLogo } from "@/components/brand/ShoopBrand";
import { NEW_CHAT_PATH } from "@/lib/shared/chatRoutes";

type AppTopBarProps = {
  onOpenSidebar: () => void;
};

export function AppTopBar({ onOpenSidebar }: AppTopBarProps) {
  return (
    <div className="z-10 shrink-0 border-b border-hairline-soft bg-page/90 backdrop-blur-md">
      <header className="relative flex h-14 items-center shoop-page-x md:h-16">
        {/* Left */}
        <div className="flex min-w-0 items-center">
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-xl text-ink-soft transition hover:bg-surface-tint hover:text-ink lg:hidden"
            aria-label="Open sidebar"
            onClick={onOpenSidebar}
          >
            <Menu className="size-[18px]" strokeWidth={1.75} />
          </button>
          <Link
            href={NEW_CHAT_PATH}
            className="hidden items-center rounded-lg px-1 py-1 transition-opacity hover:opacity-80 lg:inline-flex"
            aria-label="Shoop home"
          >
            <ShoopLogo className="h-[22px]" />
          </Link>
        </div>

        {/* Center wordmark — mobile only */}
        <div className="pointer-events-none absolute inset-x-0 flex justify-center lg:hidden">
          <Link
            href={NEW_CHAT_PATH}
            className="pointer-events-auto"
            aria-label="Shoop home"
          >
            <ShoopLogo className="h-5" />
          </Link>
        </div>

        {/* Trailing utilities — profile last, flush to the far edge */}
        <div className="ml-auto flex items-center gap-1 sm:gap-1.5 md:gap-2">
          <div className="hidden min-w-0 sm:block">
            <CatalogLocalizationBar />
          </div>
          <TryOnTopBarButton />
          <CartButton />
          <ProfileAvatarLink className="ml-1 sm:ml-1.5 md:ml-2" />
        </div>
      </header>
    </div>
  );
}
