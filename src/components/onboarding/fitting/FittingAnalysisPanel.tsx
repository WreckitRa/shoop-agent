"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FittingCta,
  FittingKick,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";
import { guestFetch } from "@/lib/client/guest-fetch";
import { PHOTO_ERROR } from "@/lib/photo-analysis/errors";
import type { PhotoCoverage } from "@/lib/photo-analysis/result";
import type { PhotoAnalysisPublic } from "@/lib/photo-analysis/types";
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
  onPersistBody: () => Promise<boolean>;
  onScanUi?: (ui: ScanUiPayload) => void;
}) {
  const [analysis, setAnalysis] = useState<PhotoAnalysisPublic | null>(null);
  const [photoHash, setPhotoHash] = useState<string | null>(null);
  const [polled, setPolled] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const completedRef = useRef(false);
  const kickOnceRef = useRef(false);
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

    async function tick() {
      try {
        const qs = photoHash
          ? `?hash=${encodeURIComponent(photoHash)}`
          : "";
        const res = await guestFetch(`/api/onboarding/photo-analysis${qs}`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          analysis: PhotoAnalysisPublic | null;
        };
        if (cancelled) return;
        const row = json.analysis;
        if (photoHash && row && row.photoHash !== photoHash) return;
        if (!photoHash && row?.photoHash) setPhotoHash(row.photoHash);
        setAnalysis(row);
        if (photoHash) setPolled(true);
        const phase = photoScanPhase(row);
        if (phase === "done" && row?.verdict && !completedRef.current) {
          completedRef.current = true;
          setGenerating(false);
          onComplete(row);
          return;
        }
        if (phase === "writing") {
          setGenerating(true);
          if (row && row.verdictStatus !== "running") {
            void kickVerdictRef.current(row);
          }
        }
        if (phase === "done" || phase === "error") {
          window.clearInterval(id);
        }
      } catch {
        /* display-only */
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
  }, [enabled, photoHash, onComplete]);

  useEffect(() => {
    if (!onScanUi) return;
    if (!enabled) {
      onScanUi({ activity: "idle", notes: [] });
      return;
    }
    const phase = photoScanPhase(analysis);
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
  }, [enabled, generating, analysis, onScanUi]);

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
      const savedBody = await onPersistBody();
      if (!savedBody) {
        kickOnceRef.current = false;
        setGenError("Couldn’t save your measurements.");
        setGenerating(false);
        return;
      }
      try {
        const res = await guestFetch("/api/onboarding/stylist-verdict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hash,
            declared_body: declared,
          }),
        });
        const json = (await res.json().catch(() => null)) as {
          analysis?: PhotoAnalysisPublic;
          error?: string;
        } | null;
        if (!res.ok || !json?.analysis) {
          kickOnceRef.current = false;
          setGenError(json?.error || "Couldn’t write the verdict.");
          setGenerating(false);
          return;
        }
        setAnalysis(json.analysis);
        if (json.analysis.verdict && json.analysis.verdictStatus === "done") {
          completedRef.current = true;
          onComplete(json.analysis);
        }
      } catch {
        kickOnceRef.current = false;
        setGenError("Couldn’t write the verdict.");
        setGenerating(false);
      }
    },
    [photoHash, body, onPersistBody, onComplete],
  );

  useEffect(() => {
    kickVerdictRef.current = kickVerdict;
  }, [kickVerdict]);

  if (!enabled) return null;

  const phase = photoScanPhase(analysis);
  const running = phase === "reading" && (analysis != null || !polled);
  const usable = Boolean(
    analysis?.result?.analysis_status.usable && (photoHash || analysis?.photoHash),
  );

  if (
    generating ||
    phase === "writing" ||
    Boolean(analysis?.verdictError)
  ) {
    return (
      <section>
        <FittingKick>THE VERDICT</FittingKick>
        <FittingTitle
          lines={[
            { text: "Writing" },
            { text: "what %%suits you.%%", red: true },
          ]}
        />
        {genError || analysis?.verdictError ? null : (
          <FittingWhisper>
            Your approved scan, body, era, week, and taste — turned into rules
            you can shop with. Watch your twin — that&apos;s the only picture.
          </FittingWhisper>
        )}
        {!genError && !analysis?.verdictError ? (
          <FittingWaitProgress
            steps={VERDICT_WAIT_STEPS}
            expectedMs={45_000}
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

  if (running) {
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
          Checking the photo on your twin. We&apos;ll ask you to confirm a few
          things when it&apos;s ready.
        </FittingWhisper>
        <FittingWaitProgress steps={SCAN_WAIT_STEPS} expectedMs={28_000} />
      </section>
    );
  }

  if (!analysis || analysis.error || !usable) {
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
          {analysis?.error ||
            analysis?.gate?.user_message ||
            PHOTO_ERROR.empty}{" "}
          Skip this — the rest of your Fitting still stands.
        </FittingWhisper>
        <div className="mt-8">
          <FittingCta onClick={onSkip}>Continue</FittingCta>
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
        onSkip={onSkip}
      />
    </div>
  );
}
