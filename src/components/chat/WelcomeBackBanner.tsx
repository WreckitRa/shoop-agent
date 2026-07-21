"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { conversationPath } from "@/lib/shared/chatRoutes";
import { guestFetch } from "@/lib/client/guest-fetch";
import { getClientIdentityScopeKey } from "@/lib/client/identity-sync";
import { useAppSessionStore } from "@/lib/client/app-session";

type ResumeHint = {
  label: string;
  conversationId: string;
};

let resumeHintInflight: Promise<ResumeHint | null> | null = null;
let resumeHintScopeKey = "";

async function fetchResumeHint(scopeKey: string): Promise<ResumeHint | null> {
  if (resumeHintInflight && resumeHintScopeKey === scopeKey) {
    return resumeHintInflight;
  }
  resumeHintScopeKey = scopeKey;
  resumeHintInflight = (async () => {
    try {
      const res = await guestFetch("/api/home/resume-hint", {
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { hint?: ResumeHint | null };
      if (json.hint?.label && json.hint.conversationId) {
        return json.hint;
      }
      return null;
    } catch {
      return null;
    }
  })().finally(() => {
    resumeHintInflight = null;
  });
  return resumeHintInflight;
}

export function WelcomeBackBanner() {
  const accessMode = useAppSessionStore((s) => s.mode);
  const authUserId = useAppSessionStore((s) => s.authUserId);
  const scopeKey = getClientIdentityScopeKey();
  const [hint, setHint] = useState<ResumeHint | null>(null);

  useEffect(() => {
    if (accessMode === "anonymous" || accessMode === "loading") {
      return;
    }

    let cancelled = false;
    void fetchResumeHint(scopeKey).then((next) => {
      if (!cancelled) setHint(next);
    });

    return () => {
      cancelled = true;
    };
  }, [accessMode, authUserId, scopeKey]);

  const visibleHint =
    accessMode === "anonymous" || accessMode === "loading" ? null : hint;
  if (!visibleHint) return null;

  return (
    <div className="mt-6 w-full md:mt-8">
      <Link
        href={conversationPath(visibleHint.conversationId)}
        className="group flex w-full items-center gap-3 rounded-2xl border border-hairline bg-white px-4 py-3.5 text-left shadow-soft transition duration-150 ease-ios hover:border-ink/15 hover:shadow-card active:scale-[0.995]"
      >
        <p className="min-w-0 flex-1 text-sm leading-snug text-ink">
          Welcome back… still hunting{" "}
          <span className="font-semibold text-ink">{visibleHint.label}</span>?
        </p>
        <ArrowRight
          className="size-4 shrink-0 text-ink-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink"
          strokeWidth={1.75}
          aria-hidden
        />
      </Link>
    </div>
  );
}
