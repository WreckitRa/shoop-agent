"use client";

import Link from "next/link";
import { useUserIdentity } from "@/hooks/useUserIdentity";
import { cn } from "@/lib/ai-chat/cn";

export function ProfileAvatarLink({ className }: { className?: string }) {
  const { initials } = useUserIdentity();

  return (
    <Link
      href="/profile"
      aria-label="Your profile"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold tracking-[0.04em] text-white transition hover:bg-ink/90",
        className,
      )}
    >
      {initials}
    </Link>
  );
}
