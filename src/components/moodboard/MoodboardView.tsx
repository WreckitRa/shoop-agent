"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Heart, Loader2 } from "lucide-react";
import { openAuthModal, useGuestMode } from "@/hooks/useGuestMode";
import { guestFetch } from "@/lib/client/guest-fetch";
import { NEW_CHAT_PATH } from "@/lib/shared/chatRoutes";
import { cn } from "@/lib/ai-chat/cn";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { HOLD_COMING_SOON_TOAST } from "@/lib/client/coming-soon-toasts";
import { useToastStore } from "@/lib/client/toast-store";

type MoodboardItem = {
  generationId: string;
  imageUrl: string;
  kind: "item" | "look";
  title: string;
  lovedAt: string;
};

type FilterKey = "all" | "looks" | "pieces";

function relativeSaved(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "saved";
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return "saved today";
  if (days === 1) return "saved 1 day ago";
  return `saved ${days} days ago`;
}

export function MoodboardView({
  embedded = false,
  onCountChange,
  onAskHold,
}: {
  embedded?: boolean;
  onCountChange?: (n: number) => void;
  onAskHold?: () => void;
} = {}) {
  const { isGuest } = useGuestMode();
  const showToast = useToastStore((s) => s.show);
  const openFittingRoom = useTryOnDrawerStore((s) => s.openFittingRoom);
  const openAvatarViewer = useTryOnDrawerStore((s) => s.openAvatarViewer);
  const [items, setItems] = useState<MoodboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await guestFetch("/api/tryon/moodboard", {
        cache: "no-store",
      });
      if (res.status === 401) {
        setItems([]);
        onCountChange?.(0);
        setError("sign_in");
        return;
      }
      if (!res.ok) {
        setError("Couldn't load your moodboard.");
        return;
      }
      const body = (await res.json()) as { items?: MoodboardItem[] };
      const next = body.items ?? [];
      setItems(next);
      onCountChange?.(next.length);
    } catch {
      setError("Couldn't load your moodboard.");
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    if (isGuest) {
      setLoading(false);
      setError("sign_in");
      setItems([]);
      onCountChange?.(0);
      return;
    }
    void load();
  }, [isGuest, load, onCountChange]);

  const remove = async (generationId: string) => {
    setRemovingId(generationId);
    try {
      const res = await guestFetch("/api/tryon/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generation_id: generationId, rating: -1 }),
      });
      if (res.ok) {
        setItems((prev) => {
          const next = prev.filter((item) => item.generationId !== generationId);
          onCountChange?.(next.length);
          return next;
        });
      }
    } finally {
      setRemovingId(null);
    }
  };

  const looks = useMemo(
    () => items.filter((i) => i.kind === "look"),
    [items],
  );
  const pieces = useMemo(
    () => items.filter((i) => i.kind === "item"),
    [items],
  );

  const shownLooks =
    filter === "all" || filter === "looks" ? looks : [];
  const shownPieces =
    filter === "all" || filter === "pieces" ? pieces : [];

  const filters: Array<{ key: FilterKey; label: string; n: number }> = [
    { key: "all", label: "Everything", n: items.length },
    { key: "looks", label: "Looks", n: looks.length },
    { key: "pieces", label: "Pieces", n: pieces.length },
  ];

  const tryOn = () => {
    void openAvatarViewer().catch(() => openFittingRoom());
  };

  const askHold = () => {
    showToast(HOLD_COMING_SOON_TOAST);
    onAskHold?.();
  };

  const body = (
    <>
      {!embedded ? (
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
      ) : null}

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
        <>
          <div className="shoop-decide__filters">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                className={cn(
                  "shoop-decide__f",
                  filter === f.key && "is-sel",
                )}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <b>{f.n}</b>
              </button>
            ))}
          </div>

          {shownLooks.length ? (
            <section className="mb-7">
              <div className="shoop-decide__sechead">
                <h3>Looks you built</h3>
                <span className="shoop-decide__bar" />
                <span className="shoop-decide__sec-n">{shownLooks.length}</span>
              </div>
              <ul className="shoop-decide__looks">
                {shownLooks.map((item) => (
                  <li key={item.generationId} className="shoop-decide__card">
                    <div className="shoop-decide__ph shoop-decide__ph--lg">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.imageUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                      <span className="shoop-decide__tag">
                        <i style={{ background: "#16A34A" }} aria-hidden />
                        Look
                      </span>
                      <button
                        type="button"
                        className="shoop-decide__heart"
                        disabled={removingId === item.generationId}
                        aria-label="Remove from moodboard"
                        onClick={() => void remove(item.generationId)}
                      >
                        {removingId === item.generationId ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          "♥"
                        )}
                      </button>
                    </div>
                    <div className="shoop-decide__cb">
                      <h4>{item.title}</h4>
                      <div className="shoop-decide__meta">
                        <span>{relativeSaved(item.lovedAt)}</span>
                      </div>
                      <div className="shoop-decide__crow">
                        <button
                          type="button"
                          className="shoop-decide__mini shoop-decide__mini--solid"
                          onClick={tryOn}
                        >
                          Try it on
                        </button>
                        <button
                          type="button"
                          className="shoop-decide__mini"
                          onClick={askHold}
                        >
                          Hold it
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {shownPieces.length ? (
            <section>
              <div className="shoop-decide__sechead">
                <h3>Pieces you kept</h3>
                <span className="shoop-decide__bar" />
                <span className="shoop-decide__sec-n">{shownPieces.length}</span>
              </div>
              <ul className="shoop-decide__grid">
                {shownPieces.map((item) => (
                  <li key={item.generationId} className="shoop-decide__card">
                    <div className="shoop-decide__ph shoop-decide__ph--sm">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.imageUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                      <span className="shoop-decide__tag">
                        <i style={{ background: "#C98A0E" }} aria-hidden />
                        On you
                      </span>
                      <button
                        type="button"
                        className="shoop-decide__heart"
                        disabled={removingId === item.generationId}
                        aria-label="Remove from moodboard"
                        onClick={() => void remove(item.generationId)}
                      >
                        {removingId === item.generationId ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          "♥"
                        )}
                      </button>
                    </div>
                    <div className="shoop-decide__cb">
                      <p className="shoop-decide__nm">{item.title}</p>
                      <div className="shoop-decide__meta">
                        <span>{relativeSaved(item.lovedAt)}</span>
                      </div>
                      <div className="shoop-decide__crow">
                        <button
                          type="button"
                          className="shoop-decide__mini shoop-decide__mini--solid"
                          onClick={tryOn}
                        >
                          Try it on
                        </button>
                        <button
                          type="button"
                          className="shoop-decide__mini"
                          onClick={askHold}
                        >
                          Hold
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!shownLooks.length && !shownPieces.length ? (
            <p className="shoop-decide__empty">Nothing under that filter.</p>
          ) : null}
        </>
      )}
    </>
  );

  if (embedded) return <div className="shoop-decide__board">{body}</div>;
  return <div className="mx-auto w-full max-w-page-wide">{body}</div>;
}
