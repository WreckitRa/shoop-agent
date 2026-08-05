"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShoopIcon, ShoopLogo } from "@/components/brand/ShoopBrand";
import { cn } from "@/lib/ai-chat/cn";
import {
  ASK_VOTE_CHOICES,
  ASK_VOTE_LABELS,
  type AskVoteChoice,
  type LookAskSharePublic,
} from "@/lib/ask/types";
import {
  getAskDisplayName,
  getAskVoterKey,
  setAskDisplayName,
} from "@/lib/ask/voter-client";
import { formatScanEmphasis } from "@/lib/tryon/look-scan-types";
import { guestFetch } from "@/lib/client/guest-fetch";

const AVATAR_COLORS = [
  "#C97B84",
  "#B08968",
  "#7C93B5",
  "#8FA98F",
  "#A98FB5",
  "#D4A574",
];

function initial(name: string) {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * 17) % 6;
  return AVATAR_COLORS[h]!;
}

type Props = {
  token: string;
  initialShare?: LookAskSharePublic | null;
};

export function AskLookCard({ token, initialShare }: Props) {
  const [share, setShare] = useState<LookAskSharePublic | null>(
    initialShare ?? null,
  );
  const [loading, setLoading] = useState(!initialShare);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(
    () => getAskDisplayName() ?? "",
  );
  const [needName, setNeedName] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<AskVoteChoice | null>(
    null,
  );
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);

  const voterKey = useMemo(() => getAskVoterKey(), []);

  useEffect(() => {
    if (!fullscreen) {
      setZoom(1);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
      if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100));
      }
      if (e.key === "-" || e.key === "_") {
        setZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100));
      }
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await guestFetch(`/api/ask/${token}`, {
        headers: { "X-Ask-Voter-Key": voterKey },
        cache: "no-store",
      });
      const body = (await res.json()) as {
        error?: string;
        share?: LookAskSharePublic;
      };
      if (!res.ok || !body.share) {
        throw new Error(body.error ?? "Couldn't load this look.");
      }
      setShare(body.share);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load this look.");
    } finally {
      setLoading(false);
    }
  }, [token, voterKey]);

  useEffect(() => {
    if (initialShare) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await guestFetch(`/api/ask/${token}`, {
          headers: { "X-Ask-Voter-Key": voterKey },
          cache: "no-store",
        });
        const body = (await res.json()) as {
          error?: string;
          share?: LookAskSharePublic;
        };
        if (!res.ok || !body.share) {
          throw new Error(body.error ?? "Couldn't load this look.");
        }
        if (!cancelled) {
          setShare(body.share);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Couldn't load this look.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialShare, token, voterKey]);

  async function submitVote(choice: AskVoteChoice, displayName: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await guestFetch(`/api/ask/${token}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice,
          displayName,
          voterKey,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        share?: LookAskSharePublic;
      };
      if (body.share) setShare(body.share);
      if (!res.ok && res.status !== 409) {
        throw new Error(body.error ?? "Couldn't record your vote.");
      }
      setNeedName(false);
      setPendingChoice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record your vote.");
    } finally {
      setBusy(false);
    }
  }

  function onVoteClick(choice: AskVoteChoice) {
    const name = getAskDisplayName() || nameDraft.trim();
    if (!name) {
      setPendingChoice(choice);
      setNeedName(true);
      return;
    }
    setAskDisplayName(name);
    void submitVote(choice, name);
  }

  function confirmName() {
    const name = nameDraft.trim();
    if (!name) return;
    setAskDisplayName(name);
    setNeedName(false);
    if (pendingChoice) void submitVote(pendingChoice, name);
  }

  async function addNote() {
    const body = noteDraft.trim();
    if (!body || !share) return;
    const name = getAskDisplayName() || nameDraft.trim() || "You";
    setAskDisplayName(name);
    setBusy(true);
    try {
      const res = await guestFetch(`/api/ask/${token}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, displayName: name, voterKey }),
      });
      const json = (await res.json()) as {
        error?: string;
        share?: LookAskSharePublic;
      };
      if (!res.ok) throw new Error(json.error ?? "Couldn't add note.");
      if (json.share) setShare(json.share);
      setNoteDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add note.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !share) {
    return (
      <div className="shoop-ask-shell">
        <p className="text-sm text-[var(--fitting-quiet)]">Loading the card…</p>
      </div>
    );
  }

  if (error && !share) {
    return (
      <div className="shoop-ask-shell flex flex-col items-center gap-3">
        <p className="text-sm text-red-700">{error}</p>
        <button
          type="button"
          className="text-sm font-semibold underline"
          onClick={() => void refresh()}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!share) return null;

  const revealed = share.shoopRevealed;
  const totalHuman = ASK_VOTE_CHOICES.reduce(
    (n, c) => n + (share.tallies[c] - (revealed && share.shoopVote === c ? 1 : 0)),
    0,
  );
  const juryTotal = ASK_VOTE_CHOICES.reduce((n, c) => n + share.tallies[c], 0);
  const avg =
    juryTotal > 0
      ? (share.tallies.no * 1 +
          share.tallies.meh * 2 +
          share.tallies.almost * 3 +
          share.tallies.love * 4) /
        juryTotal
      : 0;
  const avgLab =
    avg >= 3.5 ? "LEANING LOVE"
    : avg >= 2.8 ? "LEANING ALMOST"
    : avg >= 2 ? "LEANING MEH"
    : "LEANING NO";

  const serial = String(share.serial).padStart(6, "0");
  const asker = share.askerName.toUpperCase();

  return (
    <div className="shoop-ask-shell">
      <div className="shoop-ask-card">
        <div className="shoop-ask-im">
          {share.killCount != null ? (
            <span className="shoop-ask-kill">
              SHOOP SKIPPED <b>{share.killCount}</b> TO FIND THIS
            </span>
          ) : null}
          <button
            type="button"
            className="shoop-ask-fullbtn"
            onClick={() => setFullscreen(true)}
          >
            Zoom & inspect
          </button>
          <button
            type="button"
            className="shoop-ask-imhit"
            onClick={() => setFullscreen(true)}
            aria-label="Open full look to zoom and inspect"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={share.imageUrl}
              alt={`${share.askerName} trying it on`}
            />
          </button>
        </div>
        <div className="shoop-ask-id">
          <b>
            {asker} · trying it on
          </b>
          <i>№ {serial}</i>
        </div>

        <div className="shoop-ask-body">
          <div className="shoop-ask-q">
            Should {share.askerName.split(" ")[0]} get it?{" "}
            <b>You first.</b>
          </div>

          {!revealed ? (
            <div>
              <div className="shoop-ask-seal">
                <div className="stitch" />
                <div className="s1">SEALED</div>
                <div className="s2">vote before you peek... no cheating</div>
              </div>
              <div className="shoop-ask-votes">
                {ASK_VOTE_CHOICES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cn("shoop-ask-vb", c === "love" && "love")}
                    disabled={busy}
                    onClick={() => onVoteClick(c)}
                  >
                    {ASK_VOTE_LABELS[c]}
                  </button>
                ))}
              </div>
              <div className="shoop-ask-vfoot">
                no account needed · {totalHuman} voted · Shoop voted too...
                shows after yours
              </div>
            </div>
          ) : (
            <div className="shoop-ask-reveal">
              <div className="shoop-ask-poll">
                <div className="shoop-ask-pt">
                  {asker.split(" ")[0]} ASKED FRIENDS · {totalHuman} VOTED
                </div>
                {juryTotal > 0 ? (
                  <div className="shoop-ask-avg">
                    <b>
                      {avg.toFixed(1)}
                      <small>/4</small>
                    </b>
                    <i>FRIENDS + SHOOP · {avgLab}</i>
                  </div>
                ) : null}
                {ASK_VOTE_CHOICES.map((c) => {
                  const n = share.tallies[c];
                  const pct =
                    juryTotal > 0 ? Math.round((n / juryTotal) * 100) : 0;
                  const voters = share.votes.filter((v) => v.choice === c);
                  return (
                    <div
                      key={c}
                      className={cn(
                        "shoop-ask-prow",
                        share.myVote === c && "mine",
                      )}
                    >
                      <span
                        className={cn("pl", c === "love" && "love")}
                      >
                        {ASK_VOTE_LABELS[c]}
                        {share.myVote === c ? (
                          <span className="youtag"> YOU</span>
                        ) : share.ownerVote === c ? (
                          <span className="youtag">
                            {" "}
                            {share.askerName.split(" ")[0]?.toUpperCase()}
                          </span>
                        ) : null}
                      </span>
                      <span className="pbar">
                        <i style={{ width: `${pct}%` }} />
                      </span>
                      <span className="avs">
                        {voters.map((v) =>
                          v.isShoop ? (
                            <span
                              key={v.voterKey}
                              className="av bot"
                              title="Shoop voted"
                            >
                              <ShoopIcon size={14} className="!rounded-full" />
                            </span>
                          ) : (
                            <span
                              key={v.voterKey}
                              className={cn(
                                "av",
                                (v.voterKey === voterKey || v.isOwner) && "you",
                                v.isOwner && "asker",
                              )}
                              style={
                                v.voterKey === voterKey || v.isOwner
                                  ? undefined
                                  : { background: colorFor(v.displayName) }
                              }
                              title={
                                v.isOwner
                                  ? `${v.displayName} (asker)`
                                  : v.displayName
                              }
                            >
                              {v.voterKey === voterKey
                                ? "YOU"
                                : v.isOwner
                                  ? initial(share.askerName)
                                  : initial(v.displayName)}
                            </span>
                          ),
                        )}
                      </span>
                    </div>
                  );
                })}

                {share.shoopVerdict && share.shoopVote ? (
                  <div className="shoop-ask-shooprow">
                    <span className="svlab">
                      SHOOP VOTED —{" "}
                      <em>{ASK_VOTE_LABELS[share.shoopVote].toUpperCase()}</em>
                    </span>
                    <div
                      className="sv"
                      dangerouslySetInnerHTML={{
                        __html: formatScanEmphasis(
                          `**${share.shoopVerdict.verdict_title}** — ${share.shoopVerdict.verdict_body}`,
                        ),
                      }}
                    />
                  </div>
                ) : null}

                <div className="shoop-ask-notes">
                  {share.notes.map((n) => (
                    <div key={n.id} className="noterow">
                      <span
                        className="av"
                        style={{ background: colorFor(n.displayName) }}
                      >
                        {initial(n.displayName)}
                      </span>
                      <span>
                        <b>{n.displayName}</b> — {n.body}
                      </span>
                    </div>
                  ))}
                  <div className="notein">
                    <input
                      value={noteDraft}
                      maxLength={120}
                      placeholder="say why... (optional)"
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void addNote();
                      }}
                    />
                    <button
                      type="button"
                      disabled={busy || !noteDraft.trim()}
                      onClick={() => void addNote()}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {share.myVote && share.shoopVote ? (
                <div className="shoop-ask-clash">
                  {share.myVote === share.shoopVote ? (
                    <>
                      You said <b>{ASK_VOTE_LABELS[share.myVote]}</b> · Shoop
                      said <b>{ASK_VOTE_LABELS[share.shoopVote]}</b> — you and
                      the stylist agree
                    </>
                  ) : (
                    <>
                      You said <b>{ASK_VOTE_LABELS[share.myVote]}</b> · Shoop
                      said <b>{ASK_VOTE_LABELS[share.shoopVote]}</b> — fight it
                      out
                    </>
                  )}
                </div>
              ) : null}

              <Link href="/" className="shoop-ask-detonate">
                Make your twin — free
              </Link>
              <div className="shoop-ask-detsub">
                same dress · your body · your verdict
              </div>
            </div>
          )}

          {error ? (
            <p className="mt-3 text-center text-[11px] text-red-700">{error}</p>
          ) : null}
        </div>

        <div className="shoop-ask-cfoot">
          <span className="wm">
            <ShoopLogo className="h-[13px]" />
            <span className="tag">the honest stylist</span>
          </span>
          <Link href="/" className="joinlink">
            MAKE MY TWIN — FREE
          </Link>
        </div>
      </div>

      {needName ? (
        <div className="shoop-ask-namegate" role="dialog" aria-modal>
          <div className="shoop-ask-namebox">
            <p className="lab">What should we call you?</p>
            <input
              autoFocus
              value={nameDraft}
              maxLength={40}
              placeholder="Your name"
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmName();
              }}
            />
            <button
              type="button"
              disabled={!nameDraft.trim() || busy}
              onClick={confirmName}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {fullscreen ? (
        <div
          className="shoop-ask-fs"
          role="dialog"
          aria-modal="true"
          aria-label="Inspect look"
        >
          <div className="shoop-ask-fs__bar">
            <div className="shoop-ask-fs__zoom">
              <button
                type="button"
                aria-label="Zoom out"
                disabled={zoom <= 1}
                onClick={() =>
                  setZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100))
                }
              >
                −
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                aria-label="Zoom in"
                disabled={zoom >= 3}
                onClick={() =>
                  setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))
                }
              >
                +
              </button>
            </div>
            <button
              type="button"
              className="shoop-ask-fs__close"
              aria-label="Close"
              onClick={() => setFullscreen(false)}
            >
              Close
            </button>
          </div>
          <div
            className="shoop-ask-fs__stage"
            onClick={(e) => {
              if (e.target === e.currentTarget) setFullscreen(false);
            }}
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey) return;
              e.preventDefault();
              const next =
                e.deltaY < 0
                  ? Math.min(3, zoom + 0.1)
                  : Math.max(1, zoom - 0.1);
              setZoom(Math.round(next * 100) / 100);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={share.imageUrl}
              alt={`${share.askerName} — full look`}
              style={{ transform: `scale(${zoom})` }}
              onDoubleClick={() =>
                setZoom((z) => (z > 1 ? 1 : 2))
              }
            />
          </div>
          <p className="shoop-ask-fs__hint">
            Pinch or use + / − · double-tap to zoom · Esc to close
          </p>
        </div>
      ) : null}
    </div>
  );
}
