"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MessageCircle, Share2, Users } from "lucide-react";
import { openAuthModal, useGuestMode } from "@/hooks/useGuestMode";
import { guestFetch } from "@/lib/client/guest-fetch";
import {
  ASK_VOTE_CHOICES,
  ASK_VOTE_LABELS,
  type LookAskSharePublic,
} from "@/lib/ask/types";
import {
  askShareAbsoluteUrl,
  copyAskShareUrl,
  openWhatsAppAskShare,
} from "@/lib/ask/share-client";
import { NEW_CHAT_PATH } from "@/lib/shared/chatRoutes";
import { cn } from "@/lib/ai-chat/cn";

function friendVoteCount(share: LookAskSharePublic) {
  return share.votes.filter((v) => !v.isShoop && !v.isOwner).length;
}

function AskShareCard({ share }: { share: LookAskSharePublic }) {
  const serial = String(share.serial).padStart(6, "0");
  const friends = friendVoteCount(share);
  const noteCount = share.notes.length;
  const askPath = `/ask/${share.token}`;
  const [shareHint, setShareHint] = useState<string | null>(null);

  async function copyLink() {
    const url = askShareAbsoluteUrl(askPath);
    const ok = await copyAskShareUrl(url);
    setShareHint(ok ? "Link copied" : url);
  }

  function shareWhatsApp() {
    const url = askShareAbsoluteUrl(askPath);
    void copyAskShareUrl(url);
    openWhatsAppAskShare(url);
    setShareHint("Opening WhatsApp…");
  }

  return (
    <article className="overflow-hidden rounded-[18px] border border-hairline bg-white shadow-[0_12px_28px_-22px_rgba(14,14,17,0.22)]">
      <div className="grid gap-0 sm:grid-cols-[140px_minmax(0,1fr)]">
        <Link
          href={askPath}
          className="relative block aspect-[3/4] overflow-hidden bg-[#F1F1F4] sm:aspect-auto sm:min-h-[180px]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={share.imageUrl}
            alt={`Look № ${serial}`}
            className="size-full object-contain object-bottom"
          />
        </Link>

        <div className="flex min-w-0 flex-col p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-display text-[9.5px] font-extrabold tracking-[0.16em] text-brand">
                № {serial}
              </p>
              <h2 className="mt-1 font-display text-[15px] font-extrabold tracking-tight text-ink">
                Should I get it?
              </h2>
              <p className="mt-1 text-[12px] text-ink-muted">
                Shared{" "}
                {new Date(share.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
                {share.ownerVote
                  ? ` · you said ${ASK_VOTE_LABELS[share.ownerVote]}`
                  : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void copyLink()}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-hairline px-3 text-[11px] font-extrabold tracking-wide text-ink transition hover:border-ink"
              >
                <Share2 className="size-3.5" strokeWidth={1.75} aria-hidden />
                Copy link
              </button>
              <button
                type="button"
                onClick={shareWhatsApp}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-ink bg-ink px-3 text-[11px] font-extrabold tracking-wide text-white transition hover:bg-[#26262b]"
              >
                WhatsApp
              </button>
              <Link
                href={askPath}
                className="inline-flex h-9 items-center rounded-full border border-hairline px-3 text-[11px] font-extrabold tracking-wide text-ink-muted transition hover:border-ink hover:text-ink"
              >
                Open
              </Link>
            </div>
          </div>

          {shareHint ? (
            <p className="mt-2 text-[11px] font-semibold text-ink-muted">
              {shareHint}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {ASK_VOTE_CHOICES.map((c) => {
              const n = share.tallies[c];
              if (!n) return null;
              return (
                <span
                  key={c}
                  className={cn(
                    "rounded-full border border-hairline bg-[#F8F8FA] px-2.5 py-1 text-[10.5px] font-bold text-ink",
                    share.ownerVote === c && "border-ink bg-ink text-white",
                  )}
                >
                  {ASK_VOTE_LABELS[c]} · {n}
                </span>
              );
            })}
            {!ASK_VOTE_CHOICES.some((c) => share.tallies[c] > 0) ? (
              <span className="text-[12px] text-ink-muted">No votes yet</span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-semibold text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" strokeWidth={1.75} aria-hidden />
              {friends} friend{friends === 1 ? "" : "s"} voted
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MessageCircle
                className="size-3.5"
                strokeWidth={1.75}
                aria-hidden
              />
              {noteCount} note{noteCount === 1 ? "" : "s"}
            </span>
          </div>

          {share.notes.length ? (
            <ul className="mt-3 space-y-2 border-t border-dashed border-hairline pt-3">
              {share.notes.slice(0, 4).map((n) => (
                <li key={n.id} className="text-[12.5px] leading-snug text-ink-soft">
                  <span className="font-bold text-ink">{n.displayName}</span>
                  {" — "}
                  {n.body}
                </li>
              ))}
              {share.notes.length > 4 ? (
                <li className="text-[11px] font-semibold text-ink-muted">
                  +{share.notes.length - 4} more on the card
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="mt-3 text-[12px] text-ink-muted">
              No comments yet — share the card and see what they say.
            </p>
          )}

          {share.shoopVote ? (
            <p className="mt-3 text-[11px] text-ink-muted">
              Shoop voted{" "}
              <span className="font-bold text-ink">
                {ASK_VOTE_LABELS[share.shoopVote]}
              </span>
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function MyAsksView() {
  const { isGuest } = useGuestMode();
  const [shares, setShares] = useState<LookAskSharePublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await guestFetch("/api/asks", { cache: "no-store" });
      if (res.status === 401) {
        setShares([]);
        setError("sign_in");
        return;
      }
      if (!res.ok) {
        setError("Couldn't load your shared cards.");
        return;
      }
      const body = (await res.json()) as { shares?: LookAskSharePublic[] };
      setShares(body.shares ?? []);
    } catch {
      setError("Couldn't load your shared cards.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isGuest) {
      setLoading(false);
      setError("sign_in");
      setShares([]);
      return;
    }
    void load();
  }, [isGuest, load]);

  return (
    <div className="mx-auto w-full max-w-page-wide">
      <header className="mb-6 md:mb-8">
        <p className="font-display text-[9.5px] font-extrabold tracking-[0.22em] text-ink-muted">
          ASK YOUR FRIENDS
        </p>
        <h1 className="mt-1.5 font-display text-[1.75rem] font-extrabold tracking-tight text-ink md:text-[2rem]">
          Shared cards
        </h1>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-muted">
          Every look you shared — friend votes, notes, and Shoop&apos;s take in
          one place.
        </p>
      </header>

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center text-ink-muted">
          <Loader2 className="size-5 animate-spin" aria-hidden />
        </div>
      ) : error === "sign_in" ? (
        <div className="rounded-[18px] border border-hairline bg-white px-6 py-10 text-center">
          <p className="font-display text-[15px] font-extrabold text-ink">
            Sign in to see your shared cards
          </p>
          <p className="mt-2 text-[13px] text-ink-muted">
            Votes and notes stay with your account.
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
      ) : shares.length === 0 ? (
        <div className="rounded-[18px] border border-hairline bg-gradient-to-b from-[#FCFCFD] to-[#F5F5F7] px-6 py-12 text-center">
          <Share2
            className="mx-auto size-7 text-ink"
            strokeWidth={1.75}
            aria-hidden
          />
          <p className="mt-4 font-display text-[15px] font-extrabold text-ink">
            No shared cards yet
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-muted">
            Try a look on in the fitting room, run Studying Scan, then tap Ask
            your friends — it shows up here.
          </p>
          <Link
            href={NEW_CHAT_PATH}
            className="mt-5 inline-flex h-11 items-center justify-center rounded-[12px] bg-ink px-5 font-display text-[13.5px] font-extrabold text-white transition hover:-translate-y-0.5"
          >
            Start finding
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {shares.map((share) => (
            <li key={share.token}>
              <AskShareCard share={share} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
