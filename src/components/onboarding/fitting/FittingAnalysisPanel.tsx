"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  FittingCta,
  FittingKick,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";
import { guestFetch } from "@/lib/client/guest-fetch";
import { PHOTO_ERROR, publicPhotoError } from "@/lib/photo-analysis/errors";
import type { PhotoCoverage } from "@/lib/photo-analysis/result";
import { fillPhotoAnalysisForm, type PhotoAnalysisPublic } from "@/lib/photo-analysis/types";
import type { FittingPhotoValues } from "./FittingPhotoStep";
import {
  AnalysisReviewForm,
  confirmedBodyFromPhoto,
} from "./FittingAnalysisReview";
import { resolveScanCheckBody } from "./scan-check-body";
import {
  FittingWaitProgress,
  SCAN_WAIT_STEPS,
  VERDICT_WAIT_STEPS,
} from "./FittingWaitProgress";
import { listConfirmableTraits } from "@/lib/photo-analysis/review";
import { photoScanPhase } from "@/lib/photo-analysis/scan-phase";
import {
  canonicalScanLabel,
  scanTraitKind,
} from "@/lib/photo-analysis/scan-trait-options";
import { writeOnboardingUiSession } from "./ui-session";
import type { MirrorState } from "./types";

const POLL_MS = 2000;
const POLL_FAIL_LIMIT = 3;
/** Phone scan/verdict stage — always show the card for a beat, even if the scan is already done. */
const PHONE_STAGE_HOLD_MS = 2800;

export type ScanUiPayload = {
  activity: MirrorState["scanActivity"];
  notes: MirrorState["scanNotes"];
};

function clipScanValue(raw: string): string {
  const t = raw.trim();
  if (t.length <= 40) return t;
  return `${t.slice(0, 38).trim()}…`;
}

async function resolvePhotoFile(
  photoFile: File | null,
  preview: string | null,
): Promise<File | null> {
  if (photoFile) return photoFile;
  if (!preview) return null;
  try {
    const blob = await fetch(preview).then((r) => r.blob());
    if (!blob.size) return null;
    return new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" });
  } catch {
    return null;
  }
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export function FittingAnalysisPanel({
  enabled,
  photoFile,
  photoPreview,
  body,
  onBodyChange,
  onComplete,
  onSkip,
  onPersistBody,
  onScanUi,
  phoneStage = false,
}: {
  enabled: boolean;
  photoFile: File | null;
  photoPreview: string | null;
  requestedCoverage?: PhotoCoverage;
  body: FittingPhotoValues;
  onBodyChange: <K extends keyof FittingPhotoValues>(
    key: K,
    value: FittingPhotoValues[K],
  ) => void;
  onComplete: (row: PhotoAnalysisPublic) => void;
  onSkip: () => void;
  onPersistBody: () => Promise<string | null>;
  onScanUi?: (ui: ScanUiPayload) => void;
  /** Mobile: full-page twin card as the wait UI; hold a fake scan even if analysis is ready. */
  phoneStage?: boolean;
}) {
  const [analysis, setAnalysis] = useState<PhotoAnalysisPublic | null>(null);
  const [photoHash, setPhotoHash] = useState<string | null>(null);
  const [polled, setPolled] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const completedRef = useRef(false);
  const kickOnceRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const photoHashRef = useRef(photoHash);
  photoHashRef.current = photoHash;
  const genErrorRef = useRef(genError);
  genErrorRef.current = genError;
  const [minHold, setMinHold] = useState(phoneStage);
  const kickVerdictRef = useRef<(row: PhotoAnalysisPublic) => Promise<void>>(
    async () => undefined,
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const file = await resolvePhotoFile(photoFile, photoPreview);
      if (!file || cancelled) return;
      const hash = await sha256Hex(await file.arrayBuffer());
      if (cancelled) return;
      setPhotoHash(hash);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, photoFile, photoPreview]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let id = 0;
    let fails = 0;

    async function tick() {
      const hash = photoHashRef.current;
      try {
        const qs = hash ? `?hash=${encodeURIComponent(hash)}` : "";
        const res = await guestFetch(`/api/onboarding/photo-analysis${qs}`);
        if (!res.ok) {
          fails += 1;
          if (fails >= POLL_FAIL_LIMIT) {
            setGenError("Couldn’t reach the scan. Try again.");
            setGenerating(false);
            window.clearInterval(id);
          }
          return;
        }
        fails = 0;
        const json = (await res.json()) as {
          analysis: PhotoAnalysisPublic | null;
        };
        if (cancelled) return;
        const row = json.analysis;
        if (hash && row && row.photoHash !== hash) return;
        if (!hash && row?.photoHash) setPhotoHash(row.photoHash);
        setAnalysis(row);
        if (hash) setPolled(true);
        const phase = photoScanPhase(row);
        if (phase === "done" && row?.verdict && !completedRef.current) {
          completedRef.current = true;
          setGenerating(false);
          onCompleteRef.current(row);
          window.clearInterval(id);
          return;
        }
        if (
          phase === "writing" &&
          !genErrorRef.current &&
          !kickOnceRef.current &&
          row &&
          row.verdictStatus !== "running"
        ) {
          setGenerating(true);
          void kickVerdictRef.current(row);
        }
        if (phase === "error") {
          setGenerating(false);
          window.clearInterval(id);
          return;
        }
        if (phase === "done") {
          window.clearInterval(id);
        }
      } catch {
        fails += 1;
        if (fails >= POLL_FAIL_LIMIT) {
          setGenError("Couldn’t reach the scan. Try again.");
          setGenerating(false);
          window.clearInterval(id);
        }
      }
    }

    void tick();
    id = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, retryNonce]);

  useEffect(() => {
    if (!enabled || !phoneStage) {
      setMinHold(false);
      return;
    }
    setMinHold(true);
    const id = window.setTimeout(() => setMinHold(false), PHONE_STAGE_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [enabled, phoneStage]);

  useLayoutEffect(() => {
    if (!onScanUi) return;
    if (!enabled) {
      onScanUi({ activity: "idle", notes: [] });
      return;
    }
    const phase = photoScanPhase(analysis);
    if (genError || analysis?.verdictError) {
      onScanUi({ activity: "idle", notes: [] });
      return;
    }
    const holding = phoneStage && minHold && phase === "reading";
    if (holding) {
      onScanUi({ activity: "reading", notes: [] });
      return;
    }
    if (generating || phase === "writing") {
      onScanUi({ activity: "writing", notes: [] });
      return;
    }
    if (phase === "reading") {
      onScanUi({ activity: "reading", notes: [] });
      return;
    }
    if (phase === "error" || phase === "done" || !analysis?.result) {
      onScanUi({ activity: "idle", notes: [] });
      return;
    }
    const notes = listConfirmableTraits(analysis.result)
      .filter((row) => row.value?.trim())
      .slice(0, 5)
      .map((row) => {
        const kind = scanTraitKind(row.path);
        const short = kind
          ? canonicalScanLabel(kind, row.value!) || row.value!
          : row.value!;
        return {
          label: row.label,
          value: clipScanValue(short),
        };
      });
    onScanUi({ activity: "review", notes });
  }, [
    enabled,
    generating,
    analysis,
    onScanUi,
    phoneStage,
    minHold,
    genError,
  ]);

  useEffect(() => {
    return () => {
      onScanUi?.({ activity: "idle", notes: [] });
    };
    // unmount only — polling must not flash the card back to idle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kickVerdict = useCallback(
    async (row: PhotoAnalysisPublic) => {
      const hash = photoHash || row.photoHash;
      if (!hash) return;
      setAnalysis(row);
      setGenerating(true);
      if (kickOnceRef.current) return;
      kickOnceRef.current = true;
      writeOnboardingUiSession({ step: "verdict", finale: "scan" });
      setGenError(null);
      const declared = confirmedBodyFromPhoto({
        ...body,
        ...resolveScanCheckBody(body, row.result),
      });
      const persistError = await onPersistBody();
      if (persistError) {
        setGenError(persistError);
        setGenerating(false);
        return;
      }
      try {
        const form = new FormData();
        form.append("hash", hash);
        form.append("declared_body", JSON.stringify(declared));
        const file = await resolvePhotoFile(photoFile, photoPreview);
        if (file) form.append("photo", file);
        const res = await guestFetch("/api/onboarding/stylist-verdict", {
          method: "POST",
          body: form,
        });
        const json = (await res.json().catch(() => null)) as {
          analysis?: PhotoAnalysisPublic;
          error?: string;
        } | null;
        if (!res.ok || !json?.analysis) {
          const missing = (
            json as { missing?: { reason?: string }[] } | null
          )?.missing
            ?.map((m) => m.reason)
            .filter((r): r is string => Boolean(r?.trim()));
          setGenError(
            [json?.error || "Couldn’t write the verdict.", missing?.join(" ")]
              .filter(Boolean)
              .join(" "),
          );
          setGenerating(false);
          return;
        }
        setAnalysis(json.analysis);
        if (json.analysis.verdict && json.analysis.verdictStatus === "done") {
          completedRef.current = true;
          onCompleteRef.current(json.analysis);
        }
      } catch {
        setGenError("Couldn’t write the verdict.");
        setGenerating(false);
      }
    },
    [photoHash, body, onPersistBody, photoFile, photoPreview],
  );

  useEffect(() => {
    kickVerdictRef.current = kickVerdict;
  }, [kickVerdict]);

  if (!enabled) return null;

  const phase = photoScanPhase(analysis);
  const pollFailed = Boolean(genError);
  const running =
    phase === "reading" &&
    (analysis != null || !polled) &&
    !pollFailed;
  const usable = Boolean(
    analysis?.result?.analysis_status.usable && (photoHash || analysis?.photoHash),
  );
  const failed = Boolean(analysis?.verdictError || (pollFailed && phase !== "reading"));
  const faking =
    phoneStage && minHold && phase === "reading" && !pollFailed;

  if (!faking && (generating || phase === "writing" || failed)) {
    if (phoneStage && !failed) {
      return (
        <FittingWaitProgress
          compact
          steps={VERDICT_WAIT_STEPS}
          expectedMs={90_000}
        />
      );
    }
    return (
      <section>
        <FittingKick>THE VERDICT</FittingKick>
        <FittingTitle
          lines={[
            { text: "Writing" },
            { text: "what %%suits you.%%", red: true },
          ]}
        />
        {failed ? null : (
          <FittingWhisper>
            Your approved scan, body, era, week, and taste — turned into rules
            you can shop with.
          </FittingWhisper>
        )}
        {!failed ? (
          <FittingWaitProgress
            steps={VERDICT_WAIT_STEPS}
            expectedMs={90_000}
          />
        ) : null}
        {genError ? (
          <p className="mt-4 text-[13px] font-semibold text-[var(--fitting-red)]">
            {genError}
          </p>
        ) : null}
        {analysis?.verdictError ? (
          <div className="mt-8">
            <FittingWhisper>{analysis.verdictError}</FittingWhisper>
            <div className="mt-6 flex flex-col gap-2">
              <FittingCta
                onClick={() => {
                  kickOnceRef.current = false;
                  completedRef.current = false;
                  setGenError(null);
                  setRetryNonce((n) => n + 1);
                  void kickVerdict(analysis);
                }}
              >
                Try again
              </FittingCta>
              <FittingCta onClick={onSkip}>Continue without it</FittingCta>
            </div>
          </div>
        ) : genError ? (
          <div className="mt-6">
            <FittingCta
              onClick={() => {
                kickOnceRef.current = false;
                setGenError(null);
                setRetryNonce((n) => n + 1);
                if (analysis) void kickVerdict(analysis);
              }}
            >
              Try again
            </FittingCta>
          </div>
        ) : null}
      </section>
    );
  }

  if (faking || running) {
    if (phoneStage) {
      return (
        <FittingWaitProgress
          compact
          steps={SCAN_WAIT_STEPS}
          expectedMs={28_000}
        />
      );
    }
    return (
      <section>
        <FittingKick>THE SCAN</FittingKick>
        <FittingTitle
          lines={[
            { text: "Still" },
            { text: "%%reading.%%", red: true },
          ]}
        />
        <FittingWhisper>
          Checking the photo. We&apos;ll ask you to confirm a few things when
          it&apos;s ready.
        </FittingWhisper>
        <FittingWaitProgress steps={SCAN_WAIT_STEPS} expectedMs={28_000} />
      </section>
    );
  }

  if (!analysis || analysis.error || !usable || pollFailed) {
    const scanError =
      genError ||
      publicPhotoError(analysis?.error) ||
      analysis?.gate?.user_message ||
      PHOTO_ERROR.empty;
    return (
      <section>
        <FittingKick>THE SCAN</FittingKick>
        <FittingTitle
          lines={[
            { text: "Couldn’t" },
            { text: "%%read it.%%", red: true },
          ]}
        />
        <FittingWhisper>
          {scanError} Skip this — the rest of your Fitting still stands.
        </FittingWhisper>
        <div className="mt-8 flex flex-col gap-2">
          <FittingCta
            onClick={() => {
              void (async () => {
                const file = await resolvePhotoFile(photoFile, photoPreview);
                if (!file) return;
                setGenError(null);
                setGenerating(false);
                kickOnceRef.current = false;
                setAnalysis(null);
                setPolled(false);
                setRetryNonce((n) => n + 1);
                const form = new FormData();
                fillPhotoAnalysisForm(form, {
                  photo: file,
                  requestedCoverage: "face",
                });
                await guestFetch("/api/onboarding/photo-analysis?force=1", {
                  method: "POST",
                  body: form,
                }).catch(() => undefined);
              })();
            }}
          >
            Try again
          </FittingCta>
          <FittingCta
            onClick={() =>
              analysis ? void kickVerdict(analysis) : onSkip()
            }
          >
            Continue
          </FittingCta>
        </div>
      </section>
    );
  }

  return (
    <div className="min-w-0">
      <AnalysisReviewForm
        key={`${photoHash}-${analysis.ms ?? 0}`}
        photoHash={photoHash || analysis.photoHash}
        result={analysis.result!}
        saved={analysis.userReview}
        body={body}
        onBodyChange={onBodyChange}
        onSaved={(row) => void kickVerdict(row)}
        onSkip={() => void kickVerdict(analysis)}
      />
    </div>
  );
}
