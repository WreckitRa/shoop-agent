"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useChatStore } from "@/components/chat/chat-store";
import { useTryOnDrawerStore } from "@/components/tryon/tryon-drawer-store";
import { cn } from "@/lib/ai-chat/cn";
import { ShareLikenessDialog } from "@/components/ask/ShareLikenessDialog";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useToastStore } from "@/lib/client/toast-store";
import { HOLD_COMING_SOON_TOAST } from "@/lib/client/coming-soon-toasts";
import {
  askShareAbsoluteUrl,
  copyAskShareUrl,
  openWhatsAppAskShare,
} from "@/lib/ask/share-client";
import {
  formatScanEmphasis,
  lookScanDimRows,
  lookScanWeaknessChip,
  PREVIEW_SCAN_DIM_LABEL,
  previewScanNotes,
  previewScanWhispers,
  resolveLookScanMode,
  scoreFromLookScanChecks,
  type LookScanPiece,
  type LookScanVerdict,
  type PreviewScanNote,
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

/** Let her see the dressed look before the scan fog. */
const SCAN_SETTLE_MS = 700;

type Phase = "idle" | "scanning" | "done" | "error";

type CheckKey = "fit" | "palette" | "nolist";

type RailNote = {
  key: string;
  dim?: string;
  dimColor?: string;
  name?: string;
  html: string;
};

type Props = {
  imageUrl?: string | null;
  /** True while Fashn is still dressing — don't start the scan yet. */
  dressing?: boolean;
  pieces: LookScanPiece[];
  className?: string;
  /** Existing mirror twin — scan chrome portals into this. */
  frameEl: HTMLElement | null;
  onScanningChange?: (scanning: boolean) => void;
  onAddToMoodboard?: () => void;
  onAddToCart?: () => void | Promise<void>;
  moodBusy?: boolean;
  cartBusy?: boolean;
  saved?: boolean;
  inCart?: boolean;
  actionHint?: string | null;
};

function RailAb({
  label,
  ariaLabel,
  disabled,
  waiting,
  on,
  soon,
  kind,
  onClick,
  children,
}: {
  label: string;
  ariaLabel: string;
  disabled?: boolean;
  waiting?: boolean;
  on?: boolean;
  soon?: boolean;
  kind?: "heart" | "share" | "hold" | "bag";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "shoop-ab",
        on && "is-on",
        waiting && "is-wait",
        kind && `shoop-ab--${kind}`,
      )}
      disabled={disabled}
      aria-label={waiting ? `${ariaLabel} — after the scan` : ariaLabel}
      aria-pressed={on || undefined}
      onClick={onClick}
    >
      <span className="shoop-ab__glyph" aria-hidden>
        {children}
        {waiting ? (
          <svg className="shoop-ab__lock" viewBox="0 0 16 16">
            <rect x="3.2" y="7.2" width="9.6" height="7" rx="1.4" />
            <path
              d="M5.1 7.2V5.3a2.9 2.9 0 015.8 0v1.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        ) : null}
      </span>
      <span className="shoop-ab__lbl">
        {waiting ? "Wait" : label}
        {!waiting && soon ? <i className="shoop-ab__soon">soon</i> : null}
      </span>
    </button>
  );
}

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

function dimColor(dim: PreviewScanNote["dim"]): string {
  if (dim === "fit" || dim === "set") return "#16A34A";
  return "#C98A0E";
}

function railsFromPreview(notes: PreviewScanNote[]): RailNote[] {
  return notes.map((n) => ({
    key: `${n.dim}-${n.name}`,
    dim: PREVIEW_SCAN_DIM_LABEL[n.dim],
    dimColor: dimColor(n.dim),
    name: n.name,
    html: formatScanEmphasis(n.text),
  }));
}

function railsFromVerdict(verdict: LookScanVerdict): {
  likes: RailNote[];
  gripes: RailNote[];
} {
  const likes: RailNote[] = [];
  const gripes: RailNote[] = [];
  notesFromVerdict(verdict).forEach((n, i) => {
    const row: RailNote = { key: `v-${i}`, html: n.html };
    if (n.tone === "pass") likes.push(row);
    else gripes.push(row);
  });
  return { likes, gripes };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function RailNoteItems({ notes }: { notes: RailNote[] }) {
  return (
    <>
      {notes.map((n) => (
        <li key={n.key} className="typein">
          {n.dim ? (
            <span
              className="shoop-dimchip"
              style={{ borderColor: n.dimColor, color: n.dimColor }}
            >
              {n.dim}
            </span>
          ) : null}
          <span>
            {n.name ? (
              <>
                <b>{n.name}</b>
                {" — "}
              </>
            ) : null}
            <span dangerouslySetInnerHTML={{ __html: n.html }} />
          </span>
        </li>
      ))}
    </>
  );
}

export function StudyingScan({
  imageUrl = null,
  dressing = false,
  pieces,
  className,
  frameEl,
  onScanningChange,
  onAddToMoodboard,
  onAddToCart,
  moodBusy,
  cartBusy,
  saved = false,
  inCart = false,
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
  const [likeNotes, setLikeNotes] = useState<RailNote[]>([]);
  const [gripeNotes, setGripeNotes] = useState<RailNote[]>([]);
  const [fog, setFog] = useState<"off" | "on" | "wipe">("off");
  const [kick, setKick] = useState("Reading it on you...");
  const [error, setError] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const [shareHint, setShareHint] = useState<string | null>(null);
  const [shareConsentOpen, setShareConsentOpen] = useState(false);
  const [pendingShareAction, setPendingShareAction] = useState<
    "copy" | "whatsapp" | null
  >(null);
  const [challengerOpen, setChallengerOpen] = useState(false);
  const [challengers, setChallengers] = useState<
    Array<{ generationId: string; imageUrl: string; title: string }>
  >([]);
  const [challengerBusy, setChallengerBusy] = useState(false);
  const [pickedChallenger, setPickedChallenger] = useState<{
    generationId: string;
    imageUrl: string;
  } | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(() => {
    const token = useTryOnDrawerStore.getState().askShareToken;
    if (!token || typeof window === "undefined") return null;
    return askShareAbsoluteUrl(`/ask/${token}`);
  });
  const timersRef = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const verdictReadyRef = useRef<LookScanVerdict | null>(null);
  const bakeReadyRef = useRef(false);
  const revealedRef = useRef(false);
  const dressingRef = useRef(dressing);
  const imageUrlRef = useRef(imageUrl);
  const replayRef = useRef(false);
  const bakeStartedRef = useRef(false);
  const showToast = useToastStore((s) => s.show);
  const jobId = useTryOnDrawerStore((s) => s.jobId);
  const askShareRequestId = useTryOnDrawerStore((s) => s.askShareRequestId);
  const ownerVerdict = useTryOnDrawerStore((s) => s.ownerVerdict);
  const setOwnerVerdict = useTryOnDrawerStore((s) => s.setOwnerVerdict);
  const setLookScanVerdict = useTryOnDrawerStore((s) => s.setLookScanVerdict);
  const conversationId = useChatStore((s) => s.activeConversationId);

  function clearTimers() {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }

  function schedule(fn: () => void, ms: number) {
    timersRef.current.push(window.setTimeout(fn, ms));
  }

  dressingRef.current = dressing;
  imageUrlRef.current = imageUrl;

  function resetVisuals() {
    setWhisper(previewScanWhispers(pieces)[0]);
    setWhisperDim(false);
    setAnnoLit([false, false, false, false]);
    setChecks({ fit: "idle", palette: "idle", nolist: "idle" });
    setVerdict(null);
    setLikeNotes([]);
    setGripeNotes([]);
    setKick("Reading it on you...");
    setFog("on");
  }

  function tryReveal() {
    const v = verdictReadyRef.current;
    if (!v || revealedRef.current || !bakeReadyRef.current) return;
    if (!replayRef.current && dressingRef.current) return;
    if (!replayRef.current && !imageUrlRef.current) return;
    revealVerdict(v);
  }

  function revealVerdict(v: LookScanVerdict) {
    if (revealedRef.current) return;
    revealedRef.current = true;
    clearTimers();
    setChecks({ fit: "tied", palette: "tied", nolist: "tied" });
    setAnnoLit([false, false, false, true]);
    setWhisperDim(true);
    setWhisper("");
    setVerdict(v);
    const rails = railsFromVerdict(v);
    setLikeNotes(rails.likes);
    setGripeNotes(rails.gripes);
    setKick("Verdict");
    setFog("wipe");
    schedule(() => setFog("off"), 1200);
    setPhase("done");
  }

  function runChoreography(whispers: readonly string[]) {
    const lines = whispers.some(Boolean) ? whispers : FALLBACK_WHISPERS;
    let wi = 0;
    const cycle = () => {
      setWhisperDim(true);
      schedule(() => {
        setWhisper(lines[wi] ?? "");
        setWhisperDim(false);
        wi = (wi + 1) % lines.length;
      }, 280);
      schedule(cycle, 2100);
    };
    cycle();

    schedule(() => setAnnoLit((a) => [true, a[1]!, a[2]!, a[3]!]), 350);
    schedule(() => setChecks((c) => ({ ...c, nolist: "busy" })), 1000);
    schedule(() => setChecks((c) => ({ ...c, fit: "busy" })), 1400);
    schedule(() => {
      setChecks((c) => ({ ...c, palette: "busy" }));
      setAnnoLit((a) => [a[0]!, true, a[2]!, a[3]!]);
    }, 2600);
    schedule(() => setAnnoLit((a) => [a[0]!, a[1]!, true, a[3]!]), 3200);
  }

  function streamPreviewNotes() {
    const preview = previewScanNotes(pieces);
    const likes = railsFromPreview(preview.likes);
    const gripes = railsFromPreview(preview.gripes);
    if (prefersReducedMotion()) {
      setLikeNotes(likes);
      setGripeNotes(gripes);
      return;
    }
    likes.forEach((n, i) => {
      schedule(() => setLikeNotes((prev) => [...prev, n]), 2200 + i * 1500);
    });
    gripes.forEach((n, i) => {
      schedule(
        () => setGripeNotes((prev) => [...prev, n]),
        2200 + likes.length * 1500 + i * 1600,
      );
    });
  }

  function beginBake() {
    clearTimers();
    revealedRef.current = false;
    bakeReadyRef.current = false;
    setError(null);
    setShareHint(null);
    setPhase("scanning");
    resetVisuals();
    runChoreography(previewScanWhispers(pieces));
    streamPreviewNotes();
    const readyIn = prefersReducedMotion() ? 0 : 3400;
    schedule(() => {
      bakeReadyRef.current = true;
      tryReveal();
    }, readyIn);
  }

  async function fetchVerdict() {
    const url = imageUrlRef.current;
    if (!url) return;

    const cached = useTryOnDrawerStore.getState().lookScanVerdict;
    if (cached) {
      verdictReadyRef.current = cached;
      tryReveal();
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const absoluteUrl = /^https?:\/\//i.test(url)
        ? url
        : `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;

      const lookMode = resolveLookScanMode(pieces);
      const res = await guestFetch("/api/tryon/look-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: absoluteUrl,
          pieces,
          lookMode,
          ...(jobId ? { generationId: jobId } : {}),
        }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Couldn't study this look.");
      }
      const body = (await res.json()) as {
        verdict: LookScanVerdict;
        cached?: boolean;
      };
      const v = body.verdict;
      verdictReadyRef.current = v;
      setLookScanVerdict(v);
      tryReveal();
    } catch (err) {
      if (ac.signal.aborted) return;
      clearTimers();
      setFog("off");
      setPhase("error");
      setError(
        err instanceof Error ? err.message : "Couldn't study this look.",
      );
    }
  }

  function startScan(replay = false) {
    abortRef.current?.abort();
    replayRef.current = replay;
    bakeStartedRef.current = true;
    verdictReadyRef.current = replay
      ? useTryOnDrawerStore.getState().lookScanVerdict
      : null;
    beginBake();
    if (imageUrlRef.current) void fetchVerdict();
  }

  async function ensureAskShareUrl(opts?: {
    altImageUrl?: string;
    altGenerationId?: string;
  }): Promise<string | null> {
    const compare = Boolean(opts?.altImageUrl);
    if (shareUrl && !compare) return shareUrl;
    const existingToken = useTryOnDrawerStore.getState().askShareToken;
    if (existingToken && !compare) {
      const url = askShareAbsoluteUrl(`/ask/${existingToken}`);
      setShareUrl(url);
      return url;
    }
    if (!verdict || shareBusy || !imageUrl) return null;
    setShareBusy(true);
    setShareHint(null);
    try {
      const absoluteUrl = /^https?:\/\//i.test(imageUrl)
        ? imageUrl
        : `${window.location.origin}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;

      const ownerVote = useTryOnDrawerStore.getState().ownerVerdict;
      const altImageUrl = opts?.altImageUrl ?? pickedChallenger?.imageUrl;
      const altGenerationId =
        opts?.altGenerationId ?? pickedChallenger?.generationId;

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
          ...(altImageUrl
            ? {
                altImageUrl: /^https?:\/\//i.test(altImageUrl)
                  ? altImageUrl
                  : `${window.location.origin}${altImageUrl.startsWith("/") ? "" : "/"}${altImageUrl}`,
                altGenerationId: altGenerationId ?? null,
              }
            : {}),
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        askPath?: string;
        token?: string;
        pollMode?: string;
      } | null;
      const askPath =
        body?.askPath?.trim() ||
        (body?.token ? `/ask/${body.token.trim()}` : "");
      if (!res.ok || !askPath) {
        throw new Error(body?.error ?? "Couldn't create the share link.");
      }

      if (body?.token) {
        useTryOnDrawerStore.getState().setAskShareToken(body.token);
      }
      const url = askShareAbsoluteUrl(askPath);
      setShareUrl(url);
      return url;
    } catch (err) {
      setShareHint(
        err instanceof Error ? err.message : "Couldn't create the share link.",
      );
      return null;
    } finally {
      setShareBusy(false);
    }
  }

  async function loadChallengers(): Promise<
    Array<{ generationId: string; imageUrl: string; title: string }>
  > {
    const qs = jobId
      ? `?exclude=${encodeURIComponent(jobId)}&limit=12`
      : "?limit=12";
    const res = await guestFetch(`/api/tryon/recent${qs}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      items?: Array<{ generationId: string; imageUrl: string; title: string }>;
    };
    return body.items ?? [];
  }

  async function beginShare(kind: "copy" | "whatsapp") {
    setChallengerBusy(true);
    try {
      const items = await loadChallengers();
      setChallengers(items);
      if (items.length > 0 && !pickedChallenger && !shareUrl) {
        setPendingShareAction(kind);
        setChallengerOpen(true);
        return;
      }
      if (kind === "whatsapp") await shareAskOnWhatsApp();
      else await copyAskLink();
    } finally {
      setChallengerBusy(false);
    }
  }

  async function confirmChallenger(item: {
    generationId: string;
    imageUrl: string;
  }) {
    setPickedChallenger(item);
    setChallengerOpen(false);
    const kind = pendingShareAction ?? "whatsapp";
    setPendingShareAction(null);
    const url = await ensureAskShareUrl({
      altImageUrl: item.imageUrl,
      altGenerationId: item.generationId,
    });
    if (!url) return;
    if (kind === "whatsapp") {
      const ok = await copyAskShareUrl(url);
      setShareHint(
        ok ? "Link copied · opening WhatsApp…" : "Opening WhatsApp…",
      );
      openWhatsAppAskShare(url, true);
      setAsked(true);
    } else {
      const ok = await copyAskShareUrl(url);
      setShareHint(ok ? "Link copied" : url);
      setAsked(true);
    }
  }

  async function ensureShareConsent(): Promise<boolean> {
    try {
      const remembered =
        window.localStorage.getItem("shoop.share-likeness-consent") === "1";
      if (remembered) return true;
      const res = await guestFetch("/api/privacy/share-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareLikenessConsent: true }),
      });
      if (!res.ok) return false;
      window.localStorage.setItem("shoop.share-likeness-consent", "1");
      return true;
    } catch {
      return false;
    }
  }

  async function runShare(kind: "copy" | "whatsapp") {
    const consented =
      window.localStorage.getItem("shoop.share-likeness-consent") === "1";
    if (!consented) {
      setPendingShareAction(kind);
      setShareConsentOpen(true);
      return;
    }
    await beginShare(kind);
  }

  async function copyAskLink() {
    const url = await ensureAskShareUrl();
    if (!url) return;
    const ok = await copyAskShareUrl(url);
    setShareHint(
      ok
        ? "Link copied — anyone with it can see this render of you. Expires in 7 days."
        : url,
    );
    setAsked(true);
  }

  async function shareAskOnWhatsApp() {
    const url = await ensureAskShareUrl();
    if (!url) return;
    const ok = await copyAskShareUrl(url);
    setShareHint(
      ok ? "Link copied · opening WhatsApp…" : "Opening WhatsApp…",
    );
    openWhatsAppAskShare(url, Boolean(pickedChallenger));
    setAsked(true);
  }

  useEffect(() => {
    if (askShareRequestId < 1) return;
    if (!verdict || !imageUrl) {
      setShareHint("Wait for Shoop’s take — then Ask friends.");
      return;
    }
    void runShare("whatsapp");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askShareRequestId]);

  useEffect(() => {
    setShareUrl(null);
    setShareHint(null);
    setAsked(false);
    setPickedChallenger(null);
    // Scan waits until the dressed look is on the twin — parent keys this
    // on the try-on generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (dressing || !imageUrl || bakeStartedRef.current) return;
    const delay = prefersReducedMotion() ? 0 : SCAN_SETTLE_MS;
    const id = window.setTimeout(() => {
      if (bakeStartedRef.current) return;
      startScan();
    }, delay);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dressing, imageUrl]);

  useEffect(() => {
    tryReveal();
  }, [dressing, imageUrl]);

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

  const actionsReady = phase === "done" && Boolean(verdict);
  const onFigure = Boolean(frameEl);
  const scanScore = verdict ? scoreFromLookScanChecks(verdict.checks) : null;
  const weaknessChip = verdict ? lookScanWeaknessChip(verdict.checks) : null;
  const dimRows = verdict && phase === "done" ? lookScanDimRows(verdict) : [];
  const scoreColor =
    scanScore == null
      ? undefined
      : scanScore >= 7.5
        ? "#16A34A"
        : scanScore >= 6
          ? "#C98A0E"
          : "#DC2626";

  const overlays: ReactNode =
    showOnAvatar && frameEl
      ? createPortal(
          <>
            <div
              className={cn(
                "shoop-sscan__fog",
                fog !== "off" && "on",
                fog === "wipe" && "wipe",
              )}
              aria-hidden
            />
            <div
              className={cn(
                "shoop-sscan__scanline",
                phase === "scanning" && "run",
              )}
              aria-hidden
            />
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

            {likeNotes.length ? (
              <div className="shoop-vrail">
                <div className="shoop-vg">
                  <h5>
                    <i style={{ background: "#16A34A" }} aria-hidden />
                    {phase === "done" ? "What I like" : "What I'm checking"}
                  </h5>
                  <ul className="shoop-vg__notes">
                    <RailNoteItems notes={likeNotes} />
                  </ul>
                </div>
              </div>
            ) : null}

            {gripeNotes.length ? (
              <div className="shoop-vrail shoop-vrail--gripes">
                <div className="shoop-vg">
                  <h5>
                    <i style={{ background: "#C98A0E" }} aria-hidden />
                    {phase === "done" ? "What I don't" : "Still reading"}
                  </h5>
                  <ul className="shoop-vg__notes">
                    <RailNoteItems notes={gripeNotes} />
                  </ul>
                </div>
              </div>
            ) : null}

            <div
              className={cn(
                "shoop-sscan__overlay",
                (phase === "scanning" || phase === "done") && "on",
                phase === "scanning" && "shoop-sscan__overlay--reading",
              )}
            >
              <div className="shoop-sscan__overlay-k">{kick}</div>
              {verdict && phase === "done" ? (
                <h3
                  dangerouslySetInnerHTML={{
                    __html: formatScanEmphasis(verdict.verdict_title),
                  }}
                />
              ) : null}
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

            {phase === "error" && error ? (
              <p className="shoop-sscan__on-err">{error}</p>
            ) : null}

            <div className={cn("shoop-arail", !actionsReady && "is-wait")}>
              {!actionsReady ? (
                <p className="shoop-arail__wait">
                  {dressing
                    ? "Dressing…"
                    : phase === "scanning"
                      ? "Studying…"
                      : "After the scan"}
                </p>
              ) : null}
              <RailAb
                kind="heart"
                waiting={!actionsReady}
                on={saved}
                disabled={!actionsReady || moodBusy || !onAddToMoodboard}
                ariaLabel={
                  saved ? "On your moodboard" : "Save to moodboard"
                }
                label={moodBusy ? "Saving…" : saved ? "Saved" : "Board"}
                onClick={() => onAddToMoodboard?.()}
              >
                <svg className="shoop-ab__ic" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              </RailAb>
              <RailAb
                kind="bag"
                waiting={!actionsReady}
                on={inCart}
                disabled={!actionsReady || cartBusy || !onAddToCart}
                ariaLabel={inCart ? "In your cart" : "Add look to cart"}
                label={cartBusy ? "Adding…" : inCart ? "Added" : "Cart"}
                onClick={() => void onAddToCart?.()}
              >
                <svg className="shoop-ab__ic" viewBox="0 0 24 24">
                  <path d="M8.25 8.15V7.1a3.75 3.75 0 017.5 0v1.05h2.52c.9 0 1.6.78 1.52 1.67l-.95 11.1A1.6 1.6 0 0117.25 23H6.75a1.6 1.6 0 01-1.59-1.48l-.95-11.1a1.53 1.53 0 011.52-1.67h2.52zm1.7 0h4.1V7.1a2.05 2.05 0 00-4.1 0v1.05z" />
                </svg>
              </RailAb>
              <RailAb
                kind="hold"
                waiting={!actionsReady}
                soon
                disabled={!actionsReady}
                ariaLabel="Hold — coming soon"
                label="Hold"
                onClick={() => showToast(HOLD_COMING_SOON_TOAST)}
              >
                <svg className="shoop-ab__ic" viewBox="0 0 24 24">
                  <path d="M6.2 2.4h11.6A1.8 1.8 0 0119.6 4.2v16.6a.85.85 0 01-1.32.7L12 17.15 5.72 21.5A.85.85 0 014.4 20.8V4.2A1.8 1.8 0 016.2 2.4z" />
                </svg>
              </RailAb>
              <RailAb
                kind="share"
                waiting={!actionsReady}
                on={asked}
                disabled={!actionsReady || shareBusy}
                ariaLabel="Share this look"
                label={shareBusy ? "Sharing…" : asked ? "Shared" : "Share"}
                onClick={() => void runShare("whatsapp")}
              >
                <svg className="shoop-ab__ic" viewBox="0 0 24 24">
                  <path d="M14 4.2v3.7C7.4 8.7 4.2 13.4 3 19.8c2.4-3.4 5.9-5 11-5.1v3.8L21.4 12 14 4.2z" />
                </svg>
              </RailAb>
            </div>
          </>,
          frameEl,
        )
      : null;

  return (
    <div className={cn("shoop-sscan shoop-sscan--readout", className)}>
      {overlays}

      {phase === "idle" ? (
        <p className="shoop-sscan__empty">
          {imageUrl
            ? "It's on you."
            : "Tap a look on the left, or drag a piece from the fitting room. I'll tell you what I like and what I don't."}
        </p>
      ) : null}

      {phase === "scanning" ? (
        <>
          <p className="shoop-sscan__empty">Reading it on you…</p>
          {likeNotes.length || gripeNotes.length ? (
            <ul className="shoop-sscan__bake-notes">
              <RailNoteItems notes={[...likeNotes, ...gripeNotes]} />
            </ul>
          ) : null}
        </>
      ) : null}

      {verdict && phase === "done" && scanScore != null ? (
        <div className="shoop-sscan__vt shoop-sscan__vt--reading">
          <div className="shoop-mv">
            <span className="shoop-mv__score" style={{ color: scoreColor }}>
              {scanScore.toFixed(1)}
              <i>/10</i>
            </span>
            <div className="shoop-mv__say">
              <b
                dangerouslySetInnerHTML={{
                  __html: formatScanEmphasis(verdict.verdict_title),
                }}
              />
              <em
                dangerouslySetInnerHTML={{
                  __html: formatScanEmphasis(verdict.verdict_body),
                }}
              />
              {weaknessChip ? (
                <span className="shoop-mv__chip">{weaknessChip}</span>
              ) : null}
            </div>
          </div>

          <ul className="shoop-dims">
            {dimRows.map((row) => {
              const col =
                row.tone === "pass"
                  ? "#16A34A"
                  : row.tone === "caution"
                    ? "#C98A0E"
                    : "#DC2626";
              return (
                <li key={row.key} className="shoop-dim">
                  <div className="shoop-dim__r">
                    <span className="shoop-dim__k">{row.label}</span>
                    <span className="shoop-dim__tr">
                      <i
                        style={{
                          width: `${Math.min(100, row.score * 10)}%`,
                          background: col,
                        }}
                      />
                    </span>
                    <span className="shoop-dim__sc" style={{ color: col }}>
                      {row.score.toFixed(1)}
                    </span>
                  </div>
                  <p className="shoop-dim__wy">{row.why}</p>
                </li>
              );
            })}
          </ul>
        </div>
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

      {actionsReady ? (
        <div className="shoop-vote">
          <div className="shoop-vote__h">
            <b>YOUR CALL</b>
            <em>this teaches me faster than anything else</em>
          </div>
          <div className="shoop-vote__row">
            {(
              [
                ["no", "No"],
                ["meh", "Meh"],
                ["almost", "Almost"],
                ["love", "♥ Love it"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={cn(
                  "shoop-vb",
                  id === "love" && "shoop-vb--love",
                  ownerVerdict === id && "is-on",
                )}
                onClick={() => setOwnerVerdict(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="shoop-ask"
            disabled={shareBusy}
            onClick={() => void runShare("whatsapp")}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M22 2L11 13" />
              <path d="M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
            {shareBusy
              ? "Making the card…"
              : asked
                ? "Ask sent"
                : "Ask friends"}
          </button>
        </div>
      ) : null}

      {!onFigure ? (
        <div className="shoop-sscan__actions-row">
          <button
            type="button"
            className="shoop-sscan__btn shoop-sscan__btn--ghost"
            disabled={!actionsReady || shareBusy}
            onClick={() => void runShare("copy")}
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
      ) : actionsReady ? (
        <button
          type="button"
          className="shoop-sscan__copy-link"
          disabled={shareBusy}
          onClick={() => void runShare("copy")}
        >
          {shareBusy ? "Making link…" : "Copy the ask link"}
        </button>
      ) : null}

      {actionHint ? (
        <p className="shoop-sscan__fine shoop-sscan__fine--hint">{actionHint}</p>
      ) : null}
      {shareHint ? (
        <p className="shoop-sscan__fine shoop-sscan__fine--hint">{shareHint}</p>
      ) : (
        <p className="shoop-sscan__fine">
          AI visualization · actual fit and details may differ. Friends vote
          before they see my verdict.
        </p>
      )}

      {actionsReady ? (
        <button
          type="button"
          className="shoop-sscan__replay"
          onClick={() => void startScan(true)}
        >
          Replay the scan
        </button>
      ) : null}

      <ShareLikenessDialog
        open={shareConsentOpen}
        busy={shareBusy}
        onCancel={() => {
          setShareConsentOpen(false);
          setPendingShareAction(null);
        }}
        onConfirm={() => {
          void (async () => {
            setShareBusy(true);
            const ok = await ensureShareConsent();
            setShareBusy(false);
            if (!ok) {
              setShareHint("Could not save sharing consent.");
              return;
            }
            setShareConsentOpen(false);
            const next = pendingShareAction;
            setPendingShareAction(null);
            if (next) await beginShare(next);
          })();
        }}
      />

      {challengerOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-ink/40 p-4 sm:items-center"
          role="dialog"
          aria-label="Pick the other look"
        >
          <div className="max-h-[80dvh] w-full max-w-md overflow-auto rounded-2xl border border-hairline bg-white p-4 shadow-xl">
            <h3 className="font-display text-[15px] font-extrabold text-ink">
              Pick the other look
            </h3>
            <p className="mt-1 text-[12px] text-ink-muted">
              Friends choose between this look and one more — comparative by
              default.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {challengers.map((item) => (
                <button
                  key={item.generationId}
                  type="button"
                  disabled={shareBusy}
                  onClick={() => void confirmChallenger(item)}
                  className="overflow-hidden rounded-xl border border-hairline bg-[#F7F7F9] text-left transition hover:border-ink/30"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.imageUrl}
                    alt={item.title}
                    className="aspect-[3/4] w-full object-cover object-top"
                  />
                  <span className="block truncate px-1.5 py-1 text-[10px] font-bold text-ink">
                    {item.title}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-xl bg-ink py-2.5 text-[12px] font-bold text-white"
              onClick={() => {
                setChallengerOpen(false);
                const kind = pendingShareAction ?? "whatsapp";
                setPendingShareAction(null);
                void (kind === "whatsapp"
                  ? shareAskOnWhatsApp()
                  : copyAskLink());
              }}
            >
              Share this look only
            </button>
            <button
              type="button"
              className="mt-2 w-full rounded-xl border border-hairline py-2.5 text-[12px] font-bold text-ink-muted"
              onClick={() => {
                setChallengerOpen(false);
                const kind = pendingShareAction ?? "whatsapp";
                setPendingShareAction(null);
                void (kind === "whatsapp"
                  ? shareAskOnWhatsApp()
                  : copyAskLink());
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
