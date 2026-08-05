"use client";

import { useEffect, useRef, useState } from "react";
import { ShoopIcon } from "@/components/brand/ShoopBrand";
import { cn } from "@/lib/ai-chat/cn";
import { guestFetch } from "@/lib/client/guest-fetch";
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

type Props = {
  imageUrl: string;
  pieces: LookScanPiece[];
  className?: string;
};

export function StudyingScan({ imageUrl, pieces, className }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [whisper, setWhisper] = useState<string>(FALLBACK_WHISPERS[0]);
  const [whisperDim, setWhisperDim] = useState(false);
  const [annoLit, setAnnoLit] = useState<boolean[]>([false, false, false, false]);
  const [checks, setChecks] = useState<{
    fit: "idle" | "busy" | "tied";
    palette: "idle" | "busy" | "tied";
    nolist: "idle" | "busy" | "tied";
  }>({ fit: "idle", palette: "idle", nolist: "idle" });
  const [verdict, setVerdict] = useState<LookScanVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const verdictReadyRef = useRef<LookScanVerdict | null>(null);
  const choreographyDoneRef = useRef(false);

  function clearTimers() {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }

  function schedule(fn: () => void, ms: number) {
    timersRef.current.push(window.setTimeout(fn, ms));
  }

  function resetVisuals(annos: readonly string[], whispers: readonly string[]) {
    clearTimers();
    setWhisper(whispers[0] ?? FALLBACK_WHISPERS[0]);
    setWhisperDim(false);
    setAnnoLit([false, false, false, false]);
    setChecks({ fit: "idle", palette: "idle", nolist: "idle" });
    setVerdict(null);
    void annos;
  }

  function revealVerdict(v: LookScanVerdict) {
    setChecks({ fit: "tied", palette: "tied", nolist: "tied" });
    setAnnoLit([false, false, false, true]);
    setWhisperDim(true);
    setVerdict(v);
    setPhase("done");
  }

  function runChoreography(opts: {
    annos: readonly string[];
    whispers: readonly string[];
  }) {
    const { whispers } = opts;
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
      if (ready) {
        revealVerdict(ready);
      }
      // else keep scanning until API returns
    }, 2500);
  }

  async function startScan() {
    abortRef.current?.abort();
    clearTimers();
    verdictReadyRef.current = null;
    choreographyDoneRef.current = false;
    setError(null);
    setPhase("scanning");
    resetVisuals(FALLBACK_ANNOS, FALLBACK_WHISPERS);
    runChoreography({ annos: FALLBACK_ANNOS, whispers: FALLBACK_WHISPERS });

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const absoluteUrl =
        /^https?:\/\//i.test(imageUrl) ? imageUrl
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

      // Swap in LLM whispers/annos mid-scan if still running
      if (!choreographyDoneRef.current) {
        setWhisper((prev) => prev); // keep current beat
      }

      if (choreographyDoneRef.current) {
        revealVerdict(v);
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      clearTimers();
      setPhase("error");
      setError(err instanceof Error ? err.message : "Couldn't study this look.");
    }
  }

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearTimers();
    };
  }, []);

  const annos = verdict?.annotations ?? FALLBACK_ANNOS;
  const showScanUi = phase === "scanning" || phase === "done" || phase === "error";

  return (
    <div className={cn("shoop-sscan", className)}>
      <div className="shoop-sscan__hd">
        <span className="shoop-sscan__t">THE STUDYING SCAN</span>
      </div>

      {phase === "idle" ? (
        <button
          type="button"
          className="shoop-sscan__start"
          onClick={() => void startScan()}
        >
          Study this look →
        </button>
      ) : null}

      {showScanUi ? (
        <>
          <div
            className={cn(
              "shoop-sscan__frame",
              phase === "scanning" && "shoop-sscan__frame--scanning",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="shoop-sscan__subject" src={imageUrl} alt="Your try-on" />
            <div className="shoop-sscan__band" aria-hidden>
              <div className="shoop-sscan__line" />
            </div>
            {annos.map((label, i) => (
              <div
                key={i}
                className={cn(
                  "shoop-sscan__anno",
                  `shoop-sscan__anno--${i + 1}`,
                  annoLit[i] && "lit",
                  i === 3 && phase === "done" && "keep",
                )}
              >
                {i % 2 === 1 ? <span className="tick" /> : null}
                <span>{label}</span>
                {i % 2 === 0 ? <span className="tick" /> : null}
              </div>
            ))}
          </div>

          <div
            className={cn("shoop-sscan__whisper", whisperDim && "dim")}
            dangerouslySetInnerHTML={{
              __html:
                phase === "error"
                  ? "couldn't finish the scan..."
                  : whisper.includes("<b>")
                    ? whisper
                    : formatScanEmphasis(whisper),
            }}
          />

          <div className="shoop-sscan__checks" aria-hidden={phase === "error"}>
            {(
              [
                ["fit", "FIT"],
                ["palette", "PALETTE"],
                ["nolist", "NO-LIST"],
              ] as const
            ).map(([key, label]) => (
              <div
                key={key}
                className={cn(
                  "shoop-sscan__chk",
                  checks[key] === "busy" && "busy",
                  checks[key] === "tied" && "tied",
                  phase === "done" &&
                    verdict?.checks[
                      key === "nolist" ? "nolist" : key
                    ] === "fail" &&
                    "fail",
                  phase === "done" &&
                    verdict?.checks[
                      key === "nolist" ? "nolist" : key
                    ] === "caution" &&
                    "caution",
                )}
              >
                <span className="knot" />
                <i>{label}</i>
              </div>
            ))}
          </div>

          {phase === "error" && error ? (
            <p className="shoop-sscan__err">{error}</p>
          ) : null}

          {verdict && phase === "done" ? (
            <div className={cn("shoop-sscan__verdict", "show")}>
              <ShoopIcon size={26} className="shrink-0 rounded-[7px]" />
              <div>
                <div className="shoop-sscan__vv">
                  Verdict:{" "}
                  <em
                    dangerouslySetInnerHTML={{
                      __html: formatScanEmphasis(verdict.verdict_title),
                    }}
                  />
                </div>
                <p
                  dangerouslySetInnerHTML={{
                    __html: formatScanEmphasis(verdict.verdict_body),
                  }}
                />
              </div>
            </div>
          ) : null}

          {(phase === "done" || phase === "error") && (
            <button
              type="button"
              className="shoop-sscan__replay"
              onClick={() => void startScan()}
            >
              {phase === "error" ? "Try the scan again" : "Replay the scan"}
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}
