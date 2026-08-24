"use client";

import { useMemo, useState } from "react";
import { FittingCta } from "@/components/onboarding/onboarding-ui";
import { guestFetch } from "@/lib/client/guest-fetch";
import {
  buildStyleUserReview,
  listReviewableAssessments,
} from "@/lib/photo-analysis/review";
import type { StylePhotoAnalysis } from "@/lib/photo-analysis/result";
import type { PhotoAnalysisPublic } from "@/lib/photo-analysis/types";
import type { StylistVerdict } from "@/lib/photo-analysis/verdict";
import {
  isHexColor,
  ScanCard,
  ScanRow,
  ScanRule,
  ScanSection,
  ScanWarn,
} from "./scan-ui";

export function AnalysisReviewForm({
  photoHash,
  result,
  saved,
  onSaved,
}: {
  photoHash: string;
  result: StylePhotoAnalysis;
  saved: PhotoAnalysisPublic["userReview"];
  onSaved: (row: PhotoAnalysisPublic) => void;
}) {
  const rows = useMemo(() => listReviewableAssessments(result), [result]);
  const initialEdits = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of saved?.corrections ?? []) out[c.path] = c.corrected_value;
    return out;
  }, [saved]);
  const [edits, setEdits] = useState<Record<string, string>>(initialEdits);
  const [rejected, setRejected] = useState<string[]>(saved?.rejected_paths ?? []);
  const [notes, setNotes] = useState(saved?.notes[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rejectedSet = new Set(rejected);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const review = buildStyleUserReview({ rows, edits, rejected, notes });
      const res = await guestFetch("/api/onboarding/photo-analysis", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash: photoHash, review }),
      });
      const body = (await res.json().catch(() => null)) as {
        analysis?: PhotoAnalysisPublic;
        error?: string;
      } | null;
      if (!res.ok || !body?.analysis) {
        setError(body?.error || "Couldn’t save your review.");
        return;
      }
      onSaved(body.analysis);
    } catch {
      setError("Couldn’t save your review.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScanCard
      title="SELF-REPORT · FOR COMPARISON ONLY"
      badge={saved ? "SAVED" : "EDIT"}
      badgeTone={saved ? "good" : "quiet"}
    >
      <p className="mb-1 text-[12px] leading-[1.55] text-[var(--fitting-quiet)]">
        Edit a line, or reject it. Everything else is treated as confirmed. The
        measurement still wins for styling — this never becomes a correction
        shown back to her as a verdict on her body.
      </p>
      {rows.map((row, i) => {
        const showSection = i === 0 || rows[i - 1]!.section !== row.section;
        const isRejected = rejectedSet.has(row.path);
        return (
          <div key={row.path}>
            {showSection ? (
              <div className="mb-1 mt-4 font-display text-[10.5px] font-extrabold tracking-[0.16em] text-[var(--fitting-quiet)]">
                {row.section.toUpperCase()}
              </div>
            ) : null}
            <ScanRow
              label={row.label}
              evidence={row.evidence || undefined}
              confidence={row.confidence}
              value={
                <input
                  type="text"
                  disabled={isRejected}
                  value={
                    isRejected ? "" : (edits[row.path] ?? row.value ?? "")
                  }
                  placeholder={row.value ?? "not observable"}
                  onChange={(e) =>
                    setEdits((prev) => ({ ...prev, [row.path]: e.target.value }))
                  }
                  className="w-full min-w-0 border-0 bg-transparent p-0 font-display text-[16px] font-black tracking-[-0.02em] text-[var(--fitting-ink)] outline-none placeholder:text-[var(--fitting-quiet)] disabled:opacity-40"
                />
              }
              trailing={
                <button
                  type="button"
                  onClick={() =>
                    setRejected((prev) =>
                      prev.includes(row.path)
                        ? prev.filter((p) => p !== row.path)
                        : [...prev, row.path],
                    )
                  }
                  className={
                    isRejected
                      ? "shrink-0 rounded-[9px] border border-[#B9B9C2] bg-[#E9E9EE] px-2.5 py-1.5 text-[11px] font-bold shadow-[inset_0_3px_3px_-1px_rgba(14,14,17,.3)]"
                      : "shrink-0 rounded-[9px] border border-[#D6D6DE] bg-white px-2.5 py-1.5 text-[11px] font-bold"
                  }
                >
                  {isRejected ? "Undo" : "Reject"}
                </button>
              }
            />
          </div>
        );
      })}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything else I should treat as fact?"
        rows={2}
        className="mt-4 w-full resize-y rounded-[12px] border border-[var(--fitting-line)] px-3 py-2 text-[13px] text-[var(--fitting-ink)] outline-none"
      />
      {error ? (
        <ScanWarn>
          <b>{error}</b>
        </ScanWarn>
      ) : null}
      <div className="mt-4 [&>button]:w-full [&>button]:justify-center">
        <FittingCta onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : saved ? "Update review" : "Looks right"}
        </FittingCta>
      </div>
    </ScanCard>
  );
}

type ColorItem = {
  name: string;
  representative_hex: string | null;
  notes: string;
};

type ColorCaution = {
  color_or_family: string;
  issue: string;
};

type ProportionBlock = {
  strategy_summary: string;
  preferred_overall_silhouette: string[];
  length_strategy: string[];
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

function asColorItems(raw: unknown): ColorItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ColorItem[] = [];
  for (const item of raw) {
    const o = asRecord(item);
    if (!o || typeof o.name !== "string") continue;
    out.push({
      name: o.name,
      representative_hex:
        typeof o.representative_hex === "string" ? o.representative_hex : null,
      notes: typeof o.notes === "string" ? o.notes : "",
    });
  }
  return out;
}

function asCautions(raw: unknown): ColorCaution[] {
  if (!Array.isArray(raw)) return [];
  const out: ColorCaution[] = [];
  for (const item of raw) {
    const o = asRecord(item);
    if (!o || typeof o.color_or_family !== "string") continue;
    out.push({
      color_or_family: o.color_or_family,
      issue: typeof o.issue === "string" ? o.issue : "",
    });
  }
  return out;
}

function asProportion(raw: unknown): ProportionBlock | null {
  const o = asRecord(raw);
  if (!o || typeof o.strategy_summary !== "string") return null;
  return {
    strategy_summary: o.strategy_summary,
    preferred_overall_silhouette: Array.isArray(o.preferred_overall_silhouette)
      ? o.preferred_overall_silhouette.filter((x) => typeof x === "string")
      : [],
    length_strategy: Array.isArray(o.length_strategy)
      ? o.length_strategy.filter((x) => typeof x === "string")
      : [],
  };
}

function unknownCloser(raw: unknown[]): string | null {
  if (!raw.length) return null;
  const bits: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      bits.push(item);
      continue;
    }
    const o = asRecord(item);
    if (!o) continue;
    const field = typeof o.field === "string" ? o.field : null;
    const how =
      typeof o.how_to_resolve === "string"
        ? o.how_to_resolve
        : typeof o.impact === "string"
          ? o.impact
          : null;
    if (field && how) bits.push(`${field}: ${how}`);
    else if (field) bits.push(field);
  }
  return bits.length ? bits.join(" ") : null;
}

export function StylistVerdictView({ verdict }: { verdict: StylistVerdict }) {
  const face = verdict.user_facing_verdict;
  const exec = verdict.executive_verdict;
  const status = verdict.verdict_status;
  const colors = asRecord(verdict.color_system);
  const palette = [
    ...asColorItems(colors?.core_colors),
    ...asColorItems(colors?.best_neutrals),
    ...asColorItems(colors?.near_face_colors),
  ].slice(0, 8);
  const avoid = asCautions(colors?.use_carefully).slice(0, 4);
  const proportion = asProportion(verdict.proportion_and_silhouette);
  const closer = unknownCloser(status.remaining_unknowns);

  return (
    <ScanCard
      title="THE READING · FROM THE PHOTO"
      badge={status.readiness.toUpperCase()}
      badgeTone={status.readiness === "final" ? "good" : "watch"}
    >
      <h2 className="font-display text-[22px] font-black leading-[1.1] tracking-[-0.02em] text-[var(--fitting-ink)]">
        {face.title || exec.headline}
      </h2>
      <p className="mt-2 text-[13.5px] leading-[1.6] text-[#3A3A44]">
        {face.opening || exec.profile_summary}
      </p>

      {face.golden_rules?.length ? (
        <ScanSection kick="YOUR SILHOUETTE" headline="Rules that hold">
          {face.golden_rules.map((rule) => (
            <ScanRule key={rule} yes doText={rule} />
          ))}
        </ScanSection>
      ) : null}

      {proportion ? (
        <ScanSection
          kick="YOUR LINE"
          headline={proportion.preferred_overall_silhouette[0]}
          body={proportion.strategy_summary}
        >
          {proportion.length_strategy.slice(0, 4).map((rule) => (
            <ScanRule key={rule} yes doText={rule} />
          ))}
        </ScanSection>
      ) : null}

      {face.first_five_actions?.length ? (
        <ScanSection kick="SCALE" headline="First five">
          {face.first_five_actions.map((rule) => (
            <ScanRule key={rule} yes doText={rule} />
          ))}
        </ScanSection>
      ) : null}

      {palette.length ? (
        <ScanSection kick="PALETTE">
          <div className="mt-3 grid grid-cols-2 gap-2">
            {palette.map((c) => (
              <div
                key={`${c.name}-${c.representative_hex ?? ""}`}
                className="overflow-hidden rounded-xl border border-[var(--fitting-line)] bg-white"
              >
                <div
                  className="h-10 bg-[var(--fitting-mist)]"
                  style={
                    isHexColor(c.representative_hex)
                      ? { background: c.representative_hex }
                      : undefined
                  }
                />
                <div className="px-2.5 py-2">
                  <b className="font-display text-[11.5px] font-extrabold">
                    {c.name}
                  </b>
                  {c.notes ? (
                    <div className="mt-[3px] text-[10.5px] leading-[1.45] text-[var(--fitting-quiet)]">
                      {c.notes}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </ScanSection>
      ) : null}

      {face.mistakes_to_avoid?.length || avoid.length ? (
        <ScanWarn>
          <b>THE AVOID LIST</b>
          {avoid.length ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {avoid.map((c) => (
                <span
                  key={c.color_or_family}
                  className="inline-flex items-center rounded-[9px] border border-[#F0C9CC] bg-white px-2.5 py-1.5 text-[12px] font-bold text-[var(--fitting-ink)]"
                >
                  {c.color_or_family}
                </span>
              ))}
            </div>
          ) : null}
          {(face.mistakes_to_avoid ?? []).map((item) => (
            <ScanRule key={item} yes={false} doText={item} />
          ))}
          {avoid.map((c) =>
            c.issue ? (
              <div key={`${c.color_or_family}-issue`} className="mt-1.5">
                {c.issue}
              </div>
            ) : null,
          )}
        </ScanWarn>
      ) : null}

      {face.confidence_note || closer ? (
        <p className="mt-[22px] font-whisper text-[14px] italic leading-[1.6] text-[var(--fitting-quiet)]">
          {face.confidence_note}
          {face.confidence_note && closer ? " " : ""}
          {closer}
        </p>
      ) : null}
    </ScanCard>
  );
}

export function StylistVerdictControls({
  photoHash,
  analysis,
  quizGaps,
  onUpdated,
}: {
  photoHash: string;
  analysis: PhotoAnalysisPublic;
  quizGaps: string[];
  onUpdated: (row: PhotoAnalysisPublic) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gaps = [
    ...quizGaps,
    ...(analysis.userReview ? [] : ["Confirm what I saw in the photo"]),
  ];
  const ready = gaps.length === 0;
  const writing = busy || analysis.verdictStatus === "running";

  async function generate() {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await guestFetch("/api/onboarding/stylist-verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash: photoHash }),
      });
      const body = (await res.json().catch(() => null)) as {
        analysis?: PhotoAnalysisPublic;
        error?: string;
        missing?: Array<{ reason: string }>;
      } | null;
      if (!res.ok) {
        const extra = body?.missing?.map((m) => m.reason).join(" ");
        setError(body?.error || extra || "Couldn’t write the verdict.");
        if (body?.analysis) onUpdated(body.analysis);
        return;
      }
      if (body?.analysis) onUpdated(body.analysis);
    } catch {
      setError("Couldn’t write the verdict.");
    } finally {
      setBusy(false);
    }
  }

  if (analysis.verdict && !writing && !error && !analysis.verdictError) {
    return (
      <div className="mb-3 [&>button]:w-full [&>button]:justify-center">
        <FittingCta onClick={() => void generate()} disabled={writing}>
          Dress these observations again
        </FittingCta>
      </div>
    );
  }

  return (
    <ScanCard
      title="THE READING · FROM THE PHOTO"
      badge={writing ? "WRITING" : ready ? "READY" : "WAITING"}
      badgeTone={writing ? "watch" : ready ? "good" : "quiet"}
    >
      {gaps.length ? (
        <ul className="space-y-1 text-[12.5px] text-[var(--fitting-quiet)]">
          {gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] font-semibold text-[var(--fitting-quiet)]">
          Review is saved. I’ll write the durable stylist verdict from it.
        </p>
      )}
      {error || analysis.verdictError ? (
        <ScanWarn>
          <b>{error || analysis.verdictError}</b>
        </ScanWarn>
      ) : null}
      <div className="mt-4 [&>button]:w-full [&>button]:justify-center">
        <FittingCta onClick={() => void generate()} disabled={!ready || writing}>
          {writing
            ? "Dressing the observations…"
            : analysis.verdict
              ? "Dress these observations again"
              : "Dress these observations"}
        </FittingCta>
      </div>
    </ScanCard>
  );
}
