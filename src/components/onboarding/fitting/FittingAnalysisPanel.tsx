"use client";

import { useEffect, useRef, useState } from "react";
import { guestFetch } from "@/lib/client/guest-fetch";
import { labToHex } from "@/lib/photo-analysis/colour";
import {
  describeBody,
  describeColour,
  describeFace,
  describeNotes,
} from "@/lib/photo-analysis/describe";
import { PHOTO_ERROR } from "@/lib/photo-analysis/errors";
import type { Lab, PhotoAnalysisPublic, PhotoProfile } from "@/lib/photo-analysis/types";

const POLL_MS = 2000;

function Swatch({ lab, label }: { lab: Lab; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 rounded-full outline outline-1 outline-black/10"
        style={{ background: labToHex(lab) }}
        aria-hidden
      />
      <span className="text-[11px] font-semibold text-[var(--fitting-quiet)]">
        {label}
      </span>
    </span>
  );
}

function statusCopy(
  status: string,
  error: string | null,
): { line: string; fail: boolean } {
  if (status === "pending") return { line: "Still looking…", fail: false };
  if (status === "error") {
    return { line: error?.trim() || PHOTO_ERROR.failed, fail: true };
  }
  return { line: "Done", fail: false };
}

function ProfileCard({
  title,
  status,
  error,
  profile,
}: {
  title: string;
  status: string;
  error: string | null;
  profile: PhotoProfile | null;
}) {
  const st = statusCopy(status, error);
  const colour = profile ? describeColour(profile.colour) : null;
  const face = profile ? describeFace(profile.face) : null;
  const body = profile ? describeBody(profile.body) : null;
  const notes = profile ? describeNotes(profile) : [];

  return (
    <div className="min-w-0">
      <div className="text-[11px] font-extrabold tracking-[0.08em] text-[var(--fitting-ink)]">
        {title}
      </div>
      <div
        className={
          st.fail
            ? "mt-0.5 text-[11px] font-semibold text-[var(--fitting-red)]"
            : "mt-0.5 text-[11px] font-semibold text-[var(--fitting-quiet)]"
        }
      >
        {st.line}
      </div>

      {colour ? (
        <div className="mt-3">
          <div className="text-[10.5px] font-extrabold tracking-[0.08em] text-[var(--fitting-quiet)]">
            COLOUR
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {colour.skin ? <Swatch lab={colour.skin} label="skin" /> : null}
            {colour.hair ? <Swatch lab={colour.hair} label="hair" /> : null}
            {colour.iris ? <Swatch lab={colour.iris} label="eyes" /> : null}
          </div>
          <ul className="mt-2 space-y-1 text-[13px] leading-[1.45] text-[var(--fitting-ink)]">
            {colour.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {face ? (
        <div className="mt-3">
          <div className="text-[10.5px] font-extrabold tracking-[0.08em] text-[var(--fitting-quiet)]">
            FACE
          </div>
          <p className="mt-1.5 text-[13px] leading-[1.45] text-[var(--fitting-ink)]">
            {face}
          </p>
        </div>
      ) : null}

      {body ? (
        <div className="mt-3">
          <div className="text-[10.5px] font-extrabold tracking-[0.08em] text-[var(--fitting-quiet)]">
            BODY
          </div>
          <p className="mt-1.5 text-[13px] leading-[1.45] text-[var(--fitting-ink)]">
            {body}
          </p>
        </div>
      ) : null}

      {notes.length ? (
        <ul className="mt-3 space-y-1 text-[11.5px] text-[var(--fitting-quiet)]">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

async function resolvePhotoFile(
  file: File | null,
  preview: string | null,
): Promise<File | null> {
  if (file && file.size > 0) return file;
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
    specStatus: "pending",
    gptStatus: "pending",
    specResult: null,
    gptResult: null,
    specError: null,
    gptError: null,
  };
}

export function FittingAnalysisPanel({
  enabled,
  photoFile,
  photoPreview,
}: {
  enabled: boolean;
  photoFile: File | null;
  photoPreview: string | null;
}) {
  const [analysis, setAnalysis] = useState<PhotoAnalysisPublic | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const rerunningRef = useRef(false);
  rerunningRef.current = rerunning;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let id = 0;

    async function tick() {
      if (rerunningRef.current) return;
      try {
        const res = await guestFetch("/api/onboarding/photo-analysis");
        if (!res.ok) return;
        const body = (await res.json()) as { analysis: PhotoAnalysisPublic | null };
        if (cancelled || rerunningRef.current) return;
        setAnalysis(body.analysis);
        const row = body.analysis;
        if (
          row &&
          row.specStatus !== "pending" &&
          row.gptStatus !== "pending"
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
  }, [enabled, pollKey]);

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
      form.append("photo", file);
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
  if (!analysis) {
    return (
      <div className="mt-10 max-w-[720px] rounded-[20px] border border-[var(--fitting-line)] bg-white px-5 py-4">
        <div className="text-[11px] font-extrabold tracking-[0.1em] text-[var(--fitting-red)]">
          WHAT I SEE
        </div>
        <p className="mt-1.5 text-[12.5px] font-semibold text-[var(--fitting-quiet)]">
          Two independent reads of the same photo. Not used for finds.
        </p>
      </div>
    );
  }

  const running =
    rerunning ||
    analysis.specStatus === "pending" ||
    analysis.gptStatus === "pending";

  return (
    <div className="mt-10 max-w-[720px] rounded-[20px] border border-[var(--fitting-line)] bg-white px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-extrabold tracking-[0.1em] text-[var(--fitting-red)]">
          WHAT I SEE
        </div>
        <button
          type="button"
          onClick={() => void rerun()}
          disabled={rerunning}
          className="shrink-0 border-0 bg-transparent p-0 text-[12px] font-bold text-[var(--fitting-quiet)] hover:text-[var(--fitting-ink)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {rerunning ? "Re-running…" : "Re-run analysis"}
        </button>
      </div>
      <p className="mt-1.5 text-[12.5px] font-semibold text-[var(--fitting-quiet)]">
        {rerunError
          ? rerunError
          : running
            ? "Spec is usually quick. GPT thinks longer — you can keep going."
            : "Two independent reads. Stored only — nothing here changes finds."}
      </p>

      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <ProfileCard
          title="Spec"
          status={analysis.specStatus}
          error={analysis.specError}
          profile={analysis.specResult}
        />
        <ProfileCard
          title="GPT"
          status={analysis.gptStatus}
          error={analysis.gptError}
          profile={analysis.gptResult}
        />
      </div>
    </div>
  );
}
