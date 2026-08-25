"use client";

import { useEffect, useRef, useState } from "react";
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
import { ScanStage } from "./scan-ui";

const POLL_MS = 2000;

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
  requestedCoverage = "full_body",
  body,
  onBodyChange,
  onComplete,
  onSkip,
  onPersistBody,
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
}) {
  const [analysis, setAnalysis] = useState<PhotoAnalysisPublic | null>(null);
  const [photoHash, setPhotoHash] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setPhotoHash(null);
      setAnalysis(null);
      setGenerating(false);
      completedRef.current = false;
      return;
    }
    let cancelled = false;
    setAnalysis(null);
    setPhotoHash(null);
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
    if (!enabled || !photoHash) return;
    let cancelled = false;
    let id = 0;

    async function tick() {
      try {
        const res = await guestFetch(
          `/api/onboarding/photo-analysis?hash=${encodeURIComponent(photoHash!)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { analysis: PhotoAnalysisPublic | null };
        if (cancelled) return;
        const row = json.analysis;
        if (row && row.photoHash !== photoHash) return;
        setAnalysis(row);
        if (row?.verdict && row.verdictStatus === "done" && !completedRef.current) {
          completedRef.current = true;
          onComplete(row);
          return;
        }
        if (row?.verdictStatus === "running") setGenerating(true);
        const saw =
          row?.gate?.requested_coverage ??
          row?.result?.analysis_status.requested_coverage;
        const analysisDone =
          row &&
          row.status !== "running" &&
          (!saw || saw === requestedCoverage);
        const verdictPending =
          generating || row?.verdictStatus === "running";
        if (analysisDone && !verdictPending && row?.verdictStatus !== "running") {
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
  }, [enabled, photoHash, requestedCoverage, generating, onComplete]);

  async function kickVerdict(row: PhotoAnalysisPublic) {
    if (!photoHash) return;
    setGenerating(true);
    setGenError(null);
    setAnalysis(row);
    const savedBody = await onPersistBody();
    if (!savedBody) {
      setGenError("Couldn’t save your measurements.");
      setGenerating(false);
      return;
    }
    try {
      const res = await guestFetch("/api/onboarding/stylist-verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hash: photoHash,
          declared_body: confirmedBodyFromPhoto(body),
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        analysis?: PhotoAnalysisPublic;
        error?: string;
      } | null;
      if (!res.ok || !json?.analysis) {
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
      setGenError("Couldn’t write the verdict.");
      setGenerating(false);
    }
  }

  if (!enabled) return null;

  const running = !analysis || analysis.status === "running";
  const usable = Boolean(analysis?.result?.analysis_status.usable && photoHash);

  if (generating || analysis?.verdictStatus === "running") {
    return (
      <section>
        <FittingKick>THE VERDICT</FittingKick>
        <FittingTitle
          lines={[
            { text: "Writing" },
            { text: "what %%suits you.%%", red: true },
          ]}
        />
        <FittingWhisper>
          Using the scan you approved, plus height, build, era, week, and
          taste. This takes a minute — stay here.
        </FittingWhisper>
        <ScanStage src={photoPreview} scanning size="drop" />
        {genError ? (
          <p className="mt-4 text-[13px] font-semibold text-[var(--fitting-red)]">
            {genError}
          </p>
        ) : null}
        {analysis?.verdictError ? (
          <div className="mt-8">
            <FittingWhisper>{analysis.verdictError}</FittingWhisper>
            <FittingCta onClick={onSkip}>Continue without it</FittingCta>
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
          Checking the photo. We’ll ask you to confirm a few things when it’s
          ready.
        </FittingWhisper>
        <ScanStage src={photoPreview} scanning size="drop" />
      </section>
    );
  }

  if (analysis?.error || !usable) {
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
      <div className="mb-6 max-w-[280px]">
        <ScanStage src={photoPreview} scanning={false} size="drop" />
      </div>
      <AnalysisReviewForm
        key={`${photoHash}-${analysis.ms ?? 0}`}
        photoHash={photoHash!}
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
