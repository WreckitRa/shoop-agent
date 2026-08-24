"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { guestFetch } from "@/lib/client/guest-fetch";
import { PHOTO_ERROR } from "@/lib/photo-analysis/errors";
import {
  isAssessment,
  type Assessment,
  type PhotoCoverage,
  type StylePhotoAnalysis,
} from "@/lib/photo-analysis/result";
import { fillPhotoAnalysisForm, type PhotoAnalysisPublic } from "@/lib/photo-analysis/types";
import {
  AnalysisReviewForm,
  StylistVerdictControls,
  StylistVerdictView,
} from "./FittingAnalysisReview";
import {
  isHexColor,
  ScanCard,
  ScanPipe,
  ScanRow,
  ScanStage,
  ScanWarn,
  type PipeKind,
} from "./scan-ui";

const POLL_MS = 2000;

function labelOf(key: string): string {
  return key.replace(/_/g, " ");
}

function assessmentsOf(
  value: unknown,
): Array<[string, Assessment]> {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).filter(([, v]) =>
    isAssessment(v),
  ) as Array<[string, Assessment]>;
}

function notesOf(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap((v) =>
    Array.isArray(v) && v.every((x) => typeof x === "string")
      ? (v as string[])
      : [],
  );
}

function LayerRows({
  value,
  empty,
}: {
  value: unknown;
  empty: string;
}) {
  const rows = assessmentsOf(value);
  const notes = notesOf(value);
  if (!rows.length && !notes.length) {
    if (!empty) return null;
    return (
      <p className="text-[12.5px] leading-[1.6] text-[var(--fitting-quiet)]">
        {empty}
      </p>
    );
  }
  return (
    <>
      {rows.map(([key, item]) => (
        <ScanRow
          key={key}
          label={labelOf(key)}
          evidence={item.evidence || undefined}
          value={item.value ?? "not observable"}
          sub={item.caveats.length ? item.caveats.join(" · ") : undefined}
          confidence={item.confidence}
          patch={isHexColor(item.value) ? item.value : null}
        />
      ))}
      {notes.length ? (
        <p className="mt-3 text-[12.5px] leading-[1.55] text-[var(--fitting-quiet)]">
          {notes.join(" · ")}
        </p>
      ) : null}
    </>
  );
}

function ResultLayers({ result }: { result: StylePhotoAnalysis }) {
  const status = result.analysis_status;
  const cap = result.capture_quality;
  const profile = result.visible_profile;
  const bodyBadge = profile.body_proportions.body_shape_summary.value;
  const faceBadge = profile.face.primary_shape.value;
  const colorBadge = profile.color.skin_depth.value;
  const colorRisk =
    cap.color_analysis_reliability === "low" ||
    cap.color_analysis_reliability === "unusable";

  return (
    <>
      <ScanCard
        title="LAYER 1 · BODY"
        badge={bodyBadge ? bodyBadge.toUpperCase() : "—"}
        badgeTone={bodyBadge ? "red" : "quiet"}
      >
        <LayerRows
          value={profile.body_proportions}
          empty={
            result.analysis_status.requested_coverage === "face"
              ? "Face route — body is typed in on the next step, not read from pixels."
              : result.analysis_status.requested_coverage === "upper_body"
                ? "Torso was in frame. Legs are typed in after this, not guessed."
                : "No full-length silhouette. Face and colour layers still ran. The reading will say which rules it could not compute rather than inventing them."
          }
        />
      </ScanCard>

      <ScanCard
        title="LAYER 2 · FACE"
        badge={faceBadge ? faceBadge.toUpperCase() : "—"}
        badgeTone={faceBadge ? "red" : "quiet"}
      >
        <LayerRows
          value={profile.face}
          empty="Face region wasn’t clear enough to measure."
        />
      </ScanCard>

      <ScanCard
        title="LAYER 3 · COLOUR"
        badge={
          colorRisk
            ? "CAST RISK"
            : colorBadge
              ? colorBadge.toUpperCase()
              : "—"
        }
        badgeTone={colorRisk ? "watch" : colorBadge ? "good" : "quiet"}
      >
        <LayerRows
          value={profile.color}
          empty="Colour wasn’t readable from this photo."
        />
        {colorRisk ? (
          <ScanWarn>
            <b>White balance is not trustworthy.</b> Colour claims stay hedged
            until a cleaner photo lands.
          </ScanWarn>
        ) : null}
      </ScanCard>

      <ScanCard
        title="LAYER 4 · HAIR & GROOMING"
        badge={
          profile.hair_and_grooming.hair_length.value
            ? profile.hair_and_grooming.hair_length.value.toUpperCase()
            : "—"
        }
        badgeTone={
          profile.hair_and_grooming.hair_length.value ? "red" : "quiet"
        }
      >
        <LayerRows
          value={profile.hair_and_grooming}
          empty="Hair and grooming weren’t readable from this photo."
        />
      </ScanCard>

      <ScanCard
        title="LAYER 5 · CAPTURE"
        badge={status.usable ? "USABLE" : "UNUSABLE"}
        badgeTone={status.usable ? "good" : "red"}
      >
        <p className="text-[13px] leading-[1.45] text-[var(--fitting-ink)]">
          {status.summary}
        </p>
        {!status.usable && status.refusal_or_failure_reason ? (
          <ScanWarn>
            <b>{status.refusal_or_failure_reason}</b>
          </ScanWarn>
        ) : null}
        <ScanRow
          label="Reliability"
          evidence="face · colour · proportion · fit"
          value={[
            cap.face_analysis_reliability,
            cap.color_analysis_reliability,
            cap.proportion_analysis_reliability,
            cap.garment_fit_reliability,
          ].join(" · ")}
          sub={`${status.analyzed_image_count} image${status.analyzed_image_count === 1 ? "" : "s"}`}
          confidence={status.overall_confidence}
        />
        <LayerRows value={cap} empty="" />
      </ScanCard>

      {result.outfit_analysis.length ? (
        <ScanCard title="GARMENTS ON HER">
          {result.outfit_analysis.map((g) => (
            <ScanRow
              key={g.garment}
              label={g.garment}
              evidence={g.evidence || undefined}
              value={g.fit_status}
              sub={[g.visible_color, ...g.observations]
                .filter(Boolean)
                .join(" · ")}
              confidence={g.confidence}
            />
          ))}
        </ScanCard>
      ) : null}

      {result.preliminary_styling_implications.length ? (
        <ScanCard title="PROVISIONAL IMPLICATIONS">
          {result.preliminary_styling_implications.map((item) => (
            <ScanRow
              key={`${item.area}-${item.guidance}`}
              label={labelOf(item.area)}
              evidence={item.rationale || undefined}
              value={item.guidance}
              sub={labelOf(item.direction)}
              confidence={item.confidence}
              tone="body"
            />
          ))}
        </ScanCard>
      ) : null}

      {result.requested_additional_photos.length ? (
        <ScanCard title="MORE PHOTOS">
          {result.requested_additional_photos.map((p) => (
            <ScanRow
              key={p.photo}
              label={p.photo}
              value={p.instructions}
              tone="body"
            />
          ))}
        </ScanCard>
      ) : null}

      {result.final_summary.provisional_style_profile ? (
        <ScanCard
          title="PROVISIONAL PROFILE"
          badge={labelOf(result.final_summary.readiness_for_final_recommendations)}
          badgeTone="quiet"
        >
          <p className="text-[13px] leading-[1.45] text-[var(--fitting-ink)]">
            {result.final_summary.provisional_style_profile}
          </p>
          <p className="mt-2 font-whisper text-[14px] italic leading-[1.6] text-[var(--fitting-quiet)]">
            {result.final_summary.next_best_action}
          </p>
        </ScanCard>
      ) : null}
    </>
  );
}

function pipeLines(opts: {
  running: boolean;
  analysis: PhotoAnalysisPublic | null;
  rerunError: string | null;
}): Array<{ text: ReactNode; kind?: PipeKind }> {
  if (!opts.analysis) {
    return [{ text: <>hashed photo · waiting on the gate</>, kind: "wn" }];
  }
  const a = opts.analysis;
  const lines: Array<{ text: ReactNode; kind?: PipeKind }> = [
    { text: <>photo received</> },
  ];
  if (opts.rerunError) {
    lines.push({ text: <b>{opts.rerunError}</b>, kind: "no" });
    return lines;
  }
  if (opts.running) {
    lines.push({ text: <>running capture check…</>, kind: "wn" });
    return lines;
  }
  if (a.error) {
    lines.push({ text: <b>{a.error}</b>, kind: "no" });
    return lines;
  }
  if (a.gate) {
    const d = a.gate.decision;
    const kind: PipeKind =
      d === "reject" || d === "request_retake"
        ? "no"
        : d === "accept_partial"
          ? "wn"
          : "ok";
    lines.push({
      text: (
        <>
          gate · <b>{d.replace(/_/g, " ")}</b> · asked{" "}
          {a.gate.requested_coverage.replace(/_/g, " ")} · saw{" "}
          {a.gate.highest_supported_coverage.replace(/_/g, " ")}
        </>
      ),
      kind,
    });
  }
  if (a.result) {
    const s = a.result.analysis_status;
    lines.push({
      text: (
        <>
          analysis · <b>{s.usable ? "usable" : "unusable"}</b> ·{" "}
          {(s.achieved_coverage ?? "coverage").replace(/_/g, " ")}
          {s.coverage_complete === false ? " · incomplete" : ""} ·{" "}
          {Math.round(s.overall_confidence * 100)}%
        </>
      ),
      kind: s.usable ? "ok" : "no",
    });
    lines.push({
      text: (
        <>
          profile sealed · <b>height and weight never inferred from pixels</b>
        </>
      ),
    });
  }
  return lines;
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

function asPending(row: PhotoAnalysisPublic | null): PhotoAnalysisPublic | null {
  if (!row) return row;
  return {
    ...row,
    status: "running",
    gate: null,
    result: null,
    userReview: null,
    verdict: null,
    verdictStatus: "idle",
    verdictError: null,
    verdictMs: null,
    verdictModel: null,
    error: null,
  };
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
  declaredContext = {},
  quizGaps = [],
  requestedCoverage = "full_body",
}: {
  enabled: boolean;
  photoFile: File | null;
  photoPreview: string | null;
  declaredContext?: Record<string, unknown>;
  quizGaps?: string[];
  requestedCoverage?: PhotoCoverage;
}) {
  const [analysis, setAnalysis] = useState<PhotoAnalysisPublic | null>(null);
  const [photoHash, setPhotoHash] = useState<string | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const rerunningRef = useRef(false);
  rerunningRef.current = rerunning;

  useEffect(() => {
    if (!enabled) {
      setPhotoHash(null);
      setAnalysis(null);
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
      if (rerunningRef.current) return;
      try {
        const res = await guestFetch(
          `/api/onboarding/photo-analysis?hash=${encodeURIComponent(photoHash!)}`,
        );
        if (!res.ok) return;
        const body = (await res.json()) as { analysis: PhotoAnalysisPublic | null };
        if (cancelled || rerunningRef.current) return;
        const row = body.analysis;
        if (row && row.photoHash !== photoHash) return;
        setAnalysis(row);
        const saw =
          row?.gate?.requested_coverage ??
          row?.result?.analysis_status.requested_coverage;
        if (
          row &&
          row.status !== "running" &&
          (!saw || saw === requestedCoverage)
        ) {
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
  }, [enabled, photoHash, pollKey, requestedCoverage]);

  async function rerun() {
    if (rerunning) return;
    setRerunError(null);
    rerunningRef.current = true;
    setRerunning(true);
    setAnalysis((row) => asPending(row));
    try {
      const file = await resolvePhotoFile(photoFile, photoPreview);
      if (!file) {
        setRerunError("Photo isn’t in this session — change photo, then re-run.");
        return;
      }
      const form = new FormData();
      fillPhotoAnalysisForm(form, {
        photo: file,
        declaredContext,
        requestedCoverage,
      });
      const res = await guestFetch("/api/onboarding/photo-analysis?force=1", {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => null)) as {
        analysis?: PhotoAnalysisPublic | null;
        error?: string;
      } | null;
      if (!res.ok) {
        setRerunError(body?.error || "Re-run failed.");
        return;
      }
      if (body?.analysis) setAnalysis(body.analysis);
    } catch {
      setRerunError("Re-run failed — try again.");
    } finally {
      rerunningRef.current = false;
      setRerunning(false);
      setPollKey((n) => n + 1);
    }
  }

  if (!enabled) return null;

  const running = rerunning || !analysis || analysis.status === "running";
  const usable = Boolean(analysis?.result?.analysis_status.usable && photoHash);

  return (
    <div className="mt-5 min-w-0 space-y-0">
      <div>
        <ScanCard
          title="LAYER 0 · INPUT"
          badge={running ? "SCANNING" : analysis?.result ? "SEALED" : "—"}
          badgeTone={running ? "red" : analysis?.result ? "good" : "quiet"}
        >
          <ScanStage src={photoPreview} scanning={running} />
          <ScanPipe
            lines={pipeLines({ running, analysis, rerunError })}
          />
          <button
            type="button"
            onClick={() => void rerun()}
            disabled={rerunning}
            className="mt-3 border-0 bg-transparent p-0 font-display text-[12px] font-extrabold text-[var(--fitting-quiet)] hover:text-[var(--fitting-ink)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {rerunning ? "Re-running…" : "Re-run analysis"}
          </button>
        </ScanCard>
      </div>

      <div>
        {running ? (
          <ScanCard title="THE SCAN">
            <p className="font-whisper text-[14px] italic leading-[1.5] text-[var(--fitting-quiet)]">
              Checking the photo. Not used for finds.
            </p>
          </ScanCard>
        ) : analysis?.error ? (
          <ScanCard title="THE SCAN" badge="FAILED" badgeTone="red">
            <ScanWarn>
              <b>{analysis.error}</b>
            </ScanWarn>
          </ScanCard>
        ) : analysis?.result ? (
          <>
            <ResultLayers result={analysis.result} />
            {usable ? (
              <AnalysisReviewForm
                key={`${photoHash}-${analysis.ms ?? 0}`}
                photoHash={photoHash!}
                result={analysis.result}
                saved={analysis.userReview}
                onSaved={setAnalysis}
              />
            ) : null}
            {usable ? (
              <>
                <StylistVerdictControls
                  photoHash={photoHash!}
                  analysis={analysis}
                  quizGaps={quizGaps}
                  onUpdated={setAnalysis}
                />
                {analysis.verdict ? (
                  <StylistVerdictView verdict={analysis.verdict} />
                ) : null}
              </>
            ) : null}
          </>
        ) : analysis?.gate ? (
          <ScanCard
            title="THE GATE"
            badge={analysis.gate.decision.replace(/_/g, " ").toUpperCase()}
            badgeTone={
              analysis.gate.next_action === "run_full_analysis" ? "good" : "red"
            }
          >
            <p className="text-[13px] leading-[1.45] text-[var(--fitting-ink)]">
              {analysis.gate.user_message}
            </p>
            {analysis.gate.missing_requirements.length ? (
              <ScanWarn>
                {analysis.gate.missing_requirements.join(" · ")}
              </ScanWarn>
            ) : null}
          </ScanCard>
        ) : (
          <ScanCard title="THE SCAN">
            <p className="text-[13px] text-[var(--fitting-quiet)]">
              {PHOTO_ERROR.empty}
            </p>
          </ScanCard>
        )}
      </div>
    </div>
  );
}
