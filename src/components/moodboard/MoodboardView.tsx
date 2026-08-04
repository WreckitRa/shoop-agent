"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Heart, Loader2 } from "lucide-react";
import { openAuthModal, useGuestMode } from "@/hooks/useGuestMode";
import { guestFetch } from "@/lib/client/guest-fetch";
import { NEW_CHAT_PATH } from "@/lib/shared/chatRoutes";
import { cn } from "@/lib/ai-chat/cn";

type MoodboardItem = {
  generationId: string;
  imageUrl: string;
  kind: "item" | "look";
  title: string;
  lovedAt: string;
};

export function MoodboardView() {
  const { isGuest } = useGuestMode();
  const [items, setItems] = useState<MoodboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await guestFetch("/api/tryon/moodboard", {
        cache: "no-store",
      });
      if (res.status === 401) {
        setItems([]);
        setError("sign_in");
        return;
      }
      if (!res.ok) {
        setError("Couldn't load your moodboard.");
        return;
      }
      const body = (await res.json()) as { items?: MoodboardItem[] };
      setItems(body.items ?? []);
    } catch {
      setError("Couldn't load your moodboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isGuest) {
      setLoading(false);
      setError("sign_in");
      setItems([]);
      return;
    }
    void load();
  }, [isGuest, load]);

  const remove = async (generationId: string) => {
    setRemovingId(generationId);
    try {
      const res = await guestFetch("/api/tryon/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generation_id: generationId, rating: -1 }),
      });
      if (res.ok) {
        setItems((prev) =>
          prev.filter((item) => item.generationId !== generationId),
        );
      }
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-page-wide">
      <header className="mb-6 md:mb-8">
        <p className="font-display text-[9.5px] font-extrabold tracking-[0.22em] text-ink-muted">
          MOODBOARD
        </p>
        <h1 className="mt-1.5 font-display text-[1.75rem] font-extrabold tracking-tight text-ink md:text-[2rem]">
          Looks you loved
        </h1>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-muted">
          Every ♥ from the fitting room lands here — real try-ons on your twin.
        </p>
      </header>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center text-ink-muted">
          <Loader2 className="size-5 animate-spin" aria-hidden />
        </div>
      ) : error === "sign_in" ? (
        <div className="rounded-[18px] border border-hairline bg-white px-6 py-10 text-center">
          <p className="font-display text-[15px] font-extrabold text-ink">
            Sign in to see your moodboard
          </p>
          <p className="mt-2 text-[13px] text-ink-muted">
            Loved looks stay with your account across devices.
          </p>
          <button
            type="button"
            onClick={() => openAuthModal("login")}
            className="mt-5 inline-flex h-11 items-center justify-center rounded-[12px] bg-ink px-5 font-display text-[13.5px] font-extrabold text-white transition hover:-translate-y-0.5"
          >
            Sign in
          </button>
        </div>
      ) : error ? (
        <div className="rounded-[18px] border border-hairline bg-white px-6 py-8 text-center">
          <p className="text-sm text-ink-muted">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 text-sm font-semibold text-ink underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-[18px] border border-hairline bg-gradient-to-b from-[#FCFCFD] to-[#F5F5F7] px-6 py-12 text-center">
          <Heart
            className="mx-auto size-7 text-brand"
            strokeWidth={1.75}
            aria-hidden
          />
          <p className="mt-4 font-display text-[15px] font-extrabold text-ink">
            Nothing saved yet
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-muted">
            Open the fitting room, try something on, and hit ♥ — it shows up
            here.
          </p>
          <Link
            href={NEW_CHAT_PATH}
            className="mt-5 inline-flex h-11 items-center justify-center rounded-[12px] bg-ink px-5 font-display text-[13.5px] font-extrabold text-white transition hover:-translate-y-0.5"
          >
            Start finding
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
          {items.map((item) => (
            <li
              key={item.generationId}
              className="group overflow-hidden rounded-[16px] border border-hairline bg-white"
            >
              <div className="relative aspect-[3/4] overflow-hidden bg-[#F1F1F4]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl}
                  alt=""
                  className="size-full object-cover object-top"
                />
                <span className="absolute left-2 top-2 rounded-full bg-white px-2 py-0.5 text-[9px] font-black tracking-[0.08em] text-ink">
                  {item.kind === "look" ? "LOOK" : "ON YOU"}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(item.generationId)}
                  disabled={removingId === item.generationId}
                  className={cn(
                    "absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-full border border-hairline bg-white text-brand shadow-soft transition",
                    "opacity-100 md:opacity-0 md:group-hover:opacity-100",
                    removingId === item.generationId && "opacity-50",
                  )}
                  aria-label="Remove from moodboard"
                  title="Remove"
                >
                  {removingId === item.generationId ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Heart className="size-3.5 fill-current" strokeWidth={1.75} />
                  )}
                </button>
              </div>
              <div className="px-3 py-2.5">
                <p className="truncate text-[12px] font-semibold text-ink">
                  {item.title}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-muted">
                  {new Date(item.lovedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
