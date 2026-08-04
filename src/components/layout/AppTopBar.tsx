"use client";

import { Menu } from "lucide-react";
import { CartButton } from "@/components/cart/CartButton";
import { ProfileAvatarLink } from "@/components/auth/ProfileAvatarLink";
import { CatalogLocalizationBar } from "@/components/layout/CatalogLocalizationBar";

type AppTopBarProps = {
  onOpenSidebar: () => void;
};

export function AppTopBar({ onOpenSidebar }: AppTopBarProps) {
  return (
    <div className="z-10 shrink-0 border-b border-hairline bg-white/95 backdrop-blur-md">
      <header className="relative flex h-14 items-center shoop-page-x md:h-16">
        {/* Left */}
        <div className="flex min-w-0 items-center gap-6">
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-[10px] text-ink-soft transition hover:bg-surface-tint hover:text-ink lg:hidden"
            aria-label="Open sidebar"
            onClick={onOpenSidebar}
          >
            <Menu className="size-[18px]" strokeWidth={1.75} />
          </button>
          {/* FIND → TRY → DECIDE crumb — home is always FIND */}
          <nav
            aria-label="Journey"
            className="hidden items-center gap-4 font-display text-[10.5px] font-extrabold tracking-[0.08em] text-[#b9b9c2] lg:flex"
          >
            <span className="text-brand">FIND</span>
            <span>TRY</span>
            <span>DECIDE</span>
          </nav>
        </div>

        {/* Trailing utilities — profile last, flush to the far edge */}
        <div className="ml-auto flex items-center gap-1 sm:gap-1.5 md:gap-2">
          <div className="hidden min-w-0 sm:block">
            <CatalogLocalizationBar />
          </div>
          <CartButton />
          <ProfileAvatarLink className="ml-1 sm:ml-1.5 md:ml-2" />
        </div>
      </header>
    </div>
  );
}
