"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useChatStore } from "@/components/chat/chat-store";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { cn } from "@/lib/ai-chat/cn";
import { guestFetch } from "@/lib/client/guest-fetch";
import {
  copyAskShareUrl,
  openWhatsAppAskShare,
} from "@/lib/ask/share-client";
import {
  formatScanEmphasis,
  type LookScanPiece,
  type LookScanVerdict,
} from "@/lib/tryon/look-scan-types";

const FALLBACK_ANNOS = [
  "checking the drape",
  "palette vs yours",
  "hem · proportion",
  "no-list · clear ✓",
] as const;

const FALLBACK_WHISPERS = [
  "stepping back for a look...",
  "mm... the shoulders. <b>interesting.</b>",
  "checking it against <b>your no-list...</b>",
  "one more angle...",
] as const;

type Phase = "idle" | "scanning" | "done" | "error";

type CheckKey = "fit" | "palette" | "nolist";

type Props = {
  imageUrl: string;
  pieces: LookScanPiece[];
  className?: string;
  /** Existing mirror twin — scan chrome portals into this. */
  frameEl: HTMLElement | null;
  onScanningChange?: (scanning: boolean) => void;
  onAddToMoodboard?: () => void;
  onAddToCart?: () => void | Promise<void>;
  moodBusy?: boolean;
  cartBusy?: boolean;
  actionHint?: string | null;
};

function toneColor(
  tone: "idle" | "busy" | "pass" | "caution" | "fail",
): string {
  if (tone === "pass") return "#16A34A";
  if (tone === "caution") return "#C98A0E";
  if (tone === "fail") return "#E42831";
  if (tone === "busy") return "#E42831";
  return "#D4D4D8";
}

function notesFromVerdict(verdict: LookScanVerdict): Array<{
  tone: "pass" | "caution" | "fail";
  html: string;
}> {
  const sentences = verdict.verdict_body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tones: Array<"pass" | "caution" | "fail"> = [
    verdict.checks.fit,
    verdict.checks.palette,
    verdict.checks.nolist,
  ];
  if (!sentences.length) {
    return [
      {
        tone: verdict.checks.fit,
        html: formatScanEmphasis(verdict.verdict_title),
      },
    ];
  }
  return sentences.slice(0, 5).map((s, i) => ({
    tone: tones[Math.min(i, tones.length - 1)]!,
    html: formatScanEmphasis(s),
  }));
}

export function StudyingScan({
  imageUrl,
  pieces,
  className,
  frameEl,
  onScanningChange,
  onAddToMoodboard,
  onAddToCart,
  moodBusy,
  cartBusy,
  actionHint,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [whisper, setWhisper] = useState<string>(FALLBACK_WHISPERS[0]);
  const [whisperDim, setWhisperDim] = useState(false);
  const [annoLit, setAnnoLit] = useState<boolean[]>([
    false,
    false,
    false,
    false,
  ]);
  const [checks, setChecks] = useState<{
    fit: "idle" | "busy" | "tied";
    palette: "idle" | "busy" | "tied";
    nolist: "idle" | "busy" | "tied";
  }>({ fit: "idle", palette: "idle", nolist: "idle" });
  const [verdict, setVerdict] = useState<LookScanVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareHint, setShareHint] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(() => {
    const token = useTryOnDrawerStore.getState().askShareToken;
    if (!token || typeof window === "undefined") return null;
    return `${window.location.origin}/ask/${token}`;
  });
  const timersRef = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const verdictReadyRef = useRef<LookScanVerdict | null>(null);
  const choreographyDoneRef = useRef(false);
  const jobId = useTryOnDrawerStore((s) => s.jobId);
  const conversationId = useChatStore((s) => s.activeConversationId);
  const loadConversation = useChatStore((s) => s.loadConversation);

  function clearTimers() {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }

  function schedule(fn: () => void, ms: number) {
    timersRef.current.push(window.setTimeout(fn, ms));
  }

  function resetVisuals() {
    clearTimers();
    setWhisper(FALLBACK_WHISPERS[0]);
    setWhisperDim(false);
    setAnnoLit([false, false, false, false]);
    setChecks({ fit: "idle", palette: "idle", nolist: "idle" });
    setVerdict(null);
  }

  function revealVerdict(v: LookScanVerdict) {
    setChecks({ fit: "tied", palette: "tied", nolist: "tied" });
    setAnnoLit([false, false, false, true]);
    setWhisperDim(true);
    setVerdict(v);
    setPhase("done");
  }

  function runChoreography(whispers: readonly string[]) {
    choreographyDoneRef.current = false;

    const say = (i: number) => {
      setWhisperDim(true);
      schedule(() => {
        setWhisper(whispers[i] ?? FALLBACK_WHISPERS[i] ?? "");
        setWhisperDim(false);
      }, 300);
    };

    schedule(() => setAnnoLit((a) => [true, a[1]!, a[2]!, a[3]!]), 350);
    schedule(() => setChecks((c) => ({ ...c, fit: "busy" })), 300);
    schedule(() => say(1), 750);
    schedule(() => {
      setChecks((c) => ({ ...c, fit: "tied", palette: "busy" }));
      setAnnoLit((a) => [a[0]!, true, a[2]!, a[3]!]);
    }, 1050);
    schedule(() => say(2), 1500);
    schedule(() => {
      setChecks((c) => ({ ...c, palette: "tied", nolist: "busy" }));
      setAnnoLit((a) => [a[0]!, a[1]!, true, a[3]!]);
    }, 1750);
    schedule(() => setAnnoLit((a) => [a[0]!, a[1]!, a[2]!, true]), 2050);
    schedule(() => say(3), 2150);
    schedule(() => {
      choreographyDoneRef.current = true;
      const ready = verdictReadyRef.current;
      if (ready) revealVerdict(ready);
    }, 2500);
  }

  async function startScan() {
    abortRef.current?.abort();
    clearTimers();
    verdictReadyRef.current = null;
    choreographyDoneRef.current = false;
    setError(null);
    setShareHint(null);
    setPhase("scanning");
    resetVisuals();
    runChoreography(FALLBACK_WHISPERS);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const absoluteUrl = /^https?:\/\//i.test(imageUrl)
        ? imageUrl
        : `${window.location.origin}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;

      const res = await guestFetch("/api/tryon/look-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: absoluteUrl, pieces }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Couldn't study this look.");
      }
      const body = (await res.json()) as { verdict: LookScanVerdict };
      const v = body.verdict;
      verdictReadyRef.current = v;

      if (choreographyDoneRef.current) {
        revealVerdict(v);
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      clearTimers();
      setPhase("error");
      setError(
        err instanceof Error ? err.message : "Couldn't study this look.",
      );
    }
  }

  async function ensureAskShareUrl(): Promise<string | null> {
    if (shareUrl) return shareUrl;
    const existingToken = useTryOnDrawerStore.getState().askShareToken;
    if (existingToken) {
      const url = `${window.location.origin}/ask/${existingToken}`;
      setShareUrl(url);
      return url;
    }
    if (!verdict || shareBusy) return null;
    setShareBusy(true);
    setShareHint(null);
    try {
      const absoluteUrl = /^https?:\/\//i.test(imageUrl)
        ? imageUrl
        : `${window.location.origin}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;

      const ownerVote = useTryOnDrawerStore.getState().ownerVerdict;

      const res = await guestFetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: absoluteUrl,
          pieces,
          verdict,
          generationId: jobId,
          conversationId,
          ownerVote,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        url?: string;
        askPath?: string;
        token?: string;
      } | null;
      if (!res.ok || !body?.url) {
        throw new Error(body?.error ?? "Couldn't create the share link.");
      }

      if (body.token) {
        useTryOnDrawerStore.getState().setAskShareToken(body.token);
      }
      setShareUrl(body.url);
      if (conversationId) {
        void loadConversation(conversationId);
      }
      return body.url;
    } catch (err) {
      setShareHint(
        err instanceof Error ? err.message : "Couldn't create the share link.",
      );
      return null;
    } finally {
      setShareBusy(false);
    }
  }

  async function copyAskLink() {
    const url = await ensureAskShareUrl();
    if (!url) return;
    const ok = await copyAskShareUrl(url);
    setShareHint(ok ? "Link copied — send it to your friends" : url);
  }

  async function shareAskOnWhatsApp() {
    const url = await ensureAskShareUrl();
    if (!url) return;
    const ok = await copyAskShareUrl(url);
    setShareHint(
      ok ? "Link copied · opening WhatsApp…" : "Opening WhatsApp…",
    );
    openWhatsAppAskShare(url);
  }

  useEffect(() => {
    if (!imageUrl) return;
    setShareUrl(null);
    setShareHint(null);
    void startScan();
    // Auto-study each new dressed look.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startScan closes over latest pieces/imageUrl
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearTimers();
    };
  }, []);

  useEffect(() => {
    onScanningChange?.(phase === "scanning");
    return () => onScanningChange?.(false);
  }, [phase, onScanningChange]);

  const annos = verdict?.annotations ?? FALLBACK_ANNOS;
  const showOnAvatar =
    phase === "scanning" || phase === "done" || phase === "error";

  function checkTone(
    key: CheckKey,
  ): "idle" | "busy" | "pass" | "caution" | "fail" {
    if (phase === "done" && verdict) {
      const v = verdict.checks[key];
      if (v === "fail") return "fail";
      if (v === "caution") return "caution";
      return "pass";
    }
    if (checks[key] === "busy") return "busy";
    if (checks[key] === "tied") return "pass";
    return "idle";
  }

  const overlays: ReactNode =
    showOnAvatar && frameEl
      ? createPortal(
          <>
            <div className="shoop-sscan__band" aria-hidden>
              <div className="shoop-sscan__line" />
            </div>

            {phase === "scanning"
              ? annos.map((label, i) => (
                  <div
                    key={i}
                    className={cn(
                      "shoop-sscan__anno",
                      `shoop-sscan__anno--${i + 1}`,
                      annoLit[i] && "lit",
                    )}
                  >
                    {i % 2 === 1 ? <span className="tick" /> : null}
                    <span>{label}</span>
                    {i % 2 === 0 ? <span className="tick" /> : null}
                  </div>
                ))
              : null}

            <div
              className={cn(
                "shoop-sscan__chips",
                (phase === "done" || phase === "scanning") && "on",
              )}
            >
              {(
                [
                  ["fit", "Fit"],
                  ["palette", "Palette"],
                  ["nolist", "No-list"],
                ] as const
              ).map(([key, label]) => {
                const tone = checkTone(key);
                return (
                  <span key={key} className="shoop-sscan__chip">
                    <i style={{ background: toneColor(tone) }} aria-hidden />
                    {label}
                  </span>
                );
              })}
            </div>

            <div
              className={cn(
                "shoop-sscan__whisper shoop-sscan__whisper--stage",
                phase === "scanning" && "on",
                whisperDim && "dim",
              )}
              dangerouslySetInnerHTML={{
                __html:
                  phase === "error"
                    ? "couldn't finish the scan..."
                    : whisper.includes("<b>")
                      ? whisper
                      : formatScanEmphasis(whisper),
              }}
            />

            {verdict && phase === "done" ? (
              <div className="shoop-sscan__overlay on">
                <div className="shoop-sscan__overlay-k">Verdict</div>
                <h3
                  dangerouslySetInnerHTML={{
                    __html: formatScanEmphasis(verdict.verdict_title),
                  }}
                />
              </div>
            ) : null}

            {phase === "error" && error ? (
              <p className="shoop-sscan__on-err">{error}</p>
            ) : null}
          </>,
          frameEl,
        )
      : null;

  const notes = verdict && phase === "done" ? notesFromVerdict(verdict) : [];
  const actionsReady = phase === "done" && Boolean(verdict);

  return (
    <div className={cn("shoop-sscan shoop-sscan--readout", className)}>
      {overlays}

      {phase === "idle" || phase === "scanning" ? (
        <p className="shoop-sscan__empty">
          {phase === "scanning"
            ? "Studying this look on you…"
            : "Pull something off the rail and I'll tell you what I'd say if we were standing here together."}
        </p>
      ) : null}

      {notes.length ? (
        <ul className="shoop-sscan__notes">
          {notes.map((n, i) => (
            <li key={i}>
              <i style={{ background: toneColor(n.tone) }} aria-hidden />
              <span dangerouslySetInnerHTML={{ __html: n.html }} />
            </li>
          ))}
        </ul>
      ) : null}

      {phase === "error" ? (
        <button
          type="button"
          className="shoop-sscan__replay"
          onClick={() => void startScan()}
        >
          Try the scan again
        </button>
      ) : null}

      <div className="shoop-sscan__actions-row">
        <button
          type="button"
          className="shoop-sscan__btn shoop-sscan__btn--primary"
          disabled={!actionsReady || shareBusy}
          onClick={() => void shareAskOnWhatsApp()}
        >
          <i aria-hidden />
          {shareBusy ? "Making the card…" : "Share on WhatsApp"}
        </button>
        <button
          type="button"
          className="shoop-sscan__btn shoop-sscan__btn--ghost"
          disabled={!actionsReady || shareBusy}
          onClick={() => void copyAskLink()}
        >
          {shareBusy ? "Making link…" : "Copy link"}
        </button>
        <button
          type="button"
          className="shoop-sscan__btn shoop-sscan__btn--ghost"
          disabled={!actionsReady || moodBusy || !onAddToMoodboard}
          onClick={() => onAddToMoodboard?.()}
        >
          {moodBusy ? "Saving…" : "Add to moodboard"}
        </button>
        <button
          type="button"
          className="shoop-sscan__btn shoop-sscan__btn--ghost"
          disabled={!actionsReady || cartBusy || !onAddToCart}
          onClick={() => void onAddToCart?.()}
        >
          {cartBusy ? "Adding…" : "Add to cart"}
        </button>
      </div>

      {actionHint ? (
        <p className="shoop-sscan__fine shoop-sscan__fine--hint">{actionHint}</p>
      ) : null}
      {shareHint ? (
        <p className="shoop-sscan__fine shoop-sscan__fine--hint">{shareHint}</p>
      ) : (
        <p className="shoop-sscan__fine">
          AI visualization · actual fit and details may differ. They vote before
          they see mine.
        </p>
      )}

      {actionsReady ? (
        <button
          type="button"
          className="shoop-sscan__replay"
          onClick={() => void startScan()}
        >
          Replay the scan
        </button>
      ) : null}
    </div>
  );
}
