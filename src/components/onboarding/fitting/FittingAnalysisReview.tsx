"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FittingCta,
  FittingKick,
  FittingQlbl,
  FittingTitle,
  FittingWhisper,
  OnboardingChip,
} from "@/components/onboarding/onboarding-ui";
import { guestFetch } from "@/lib/client/guest-fetch";
import {
  buildStyleUserReview,
  listConfirmableTraits,
  type ConfirmedBody,
} from "@/lib/photo-analysis/review";
import type { StylePhotoAnalysis } from "@/lib/photo-analysis/result";
import type { PhotoAnalysisPublic } from "@/lib/photo-analysis/types";
import type { FittingPhotoValues } from "./FittingPhotoStep";
import { resolveScanCheckBody } from "./scan-check-body";

const BUILDS: { label: string; value: NonNullable<FittingPhotoValues["build"]> }[] = [
  { label: "Slim", value: "slim" },
  { label: "Average", value: "average" },
  { label: "Athletic", value: "athletic" },
  { label: "Broad", value: "broad" },
  { label: "Plus", value: "plus" },
];

const MUSCLE: {
  label: string;
  value: NonNullable<FittingPhotoValues["muscularity"]>;
}[] = [
  { label: "Soft", value: "low" },
  { label: "Toned", value: "moderate" },
  { label: "Defined", value: "high" },
];

const SHAPES: {
  label: string;
  value: NonNullable<FittingPhotoValues["bodyShape"]>;
}[] = [
  { label: "Rectangle", value: "rectangle" },
  { label: "Triangle", value: "triangle" },
  { label: "Inverted", value: "inverted_triangle" },
  { label: "Hourglass", value: "hourglass" },
  { label: "Oval", value: "oval" },
];

export function confirmedBodyFromPhoto(
  values: FittingPhotoValues,
): ConfirmedBody {
  const heightCm =
    values.heightUnit === "cm"
      ? values.heightCm
      : Math.round((values.heightFt * 12 + values.heightIn) * 2.54);
  const weightKg =
    values.weightSkipped || values.weightValue == null
      ? null
      : values.weightUnit === "kg"
        ? Math.round(values.weightValue)
        : Math.round(values.weightValue * 0.453592);
  return {
    height_cm: Number.isFinite(heightCm) ? heightCm : null,
    weight_kg: weightKg,
    body_type: values.build,
    muscularity: values.muscularity,
    body_shape: values.bodyShape,
    bust_fullness: values.bustFullness,
    leg_line: values.legLine,
  };
}

export function AnalysisReviewForm({
  photoHash,
  result,
  saved,
  body,
  onBodyChange,
  onSaved,
  onSkip,
}: {
  photoHash: string;
  result: StylePhotoAnalysis;
  saved: PhotoAnalysisPublic["userReview"];
  body: FittingPhotoValues;
  onBodyChange: <K extends keyof FittingPhotoValues>(
    key: K,
    value: FittingPhotoValues[K],
  ) => void;
  onSaved: (row: PhotoAnalysisPublic) => void;
  onSkip?: () => void;
}) {
  const rows = useMemo(() => listConfirmableTraits(result), [result]);
  const shown = useMemo(
    () => resolveScanCheckBody(body, result),
    [body, result],
  );
  const initialEdits = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of rows) out[row.path] = row.value ?? "";
    for (const c of saved?.corrections ?? []) out[c.path] = c.corrected_value;
    return out;
  }, [rows, saved]);
  const [edits, setEdits] = useState<Record<string, string>>(initialEdits);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (body.build !== shown.build) onBodyChange("build", shown.build);
    if (body.muscularity !== shown.muscularity) {
      onBodyChange("muscularity", shown.muscularity);
    }
    if (shown.bodyShape && body.bodyShape !== shown.bodyShape) {
      onBodyChange("bodyShape", shown.bodyShape);
    }
  }, [body, shown, onBodyChange]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const review = buildStyleUserReview({
        rows,
        edits,
        rejected: [],
        notes: "",
        confirmedBody: confirmedBodyFromPhoto({
          ...body,
          build: shown.build,
          muscularity: shown.muscularity,
          bodyShape: shown.bodyShape,
        }),
      });
      const res = await guestFetch("/api/onboarding/photo-analysis", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash: photoHash, review }),
      });
      const json = (await res.json().catch(() => null)) as {
        analysis?: PhotoAnalysisPublic;
        error?: string;
      } | null;
      if (!res.ok || !json?.analysis) {
        setError(json?.error || "Couldn’t save.");
        return;
      }
      onSaved(json.analysis);
    } catch {
      setError("Couldn’t save.");
    } finally {
      setSaving(false);
    }
  }

  if (!rows.length) {
    return (
      <section>
        <FittingKick>THE SCAN</FittingKick>
        <FittingTitle
          lines={[
            { text: "Not enough" },
            { text: "from the %%photo.%%", red: true },
          ]}
        />
        <FittingWhisper>
          We couldn’t read skin, eyes, or hair clearly. Skip this — you can
          correct it later in Settings.
        </FittingWhisper>
        {onSkip ? (
          <div className="mt-8">
            <FittingCta onClick={onSkip}>Skip for now</FittingCta>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section>
      <FittingKick>THE SCAN · CHECK</FittingKick>
      <FittingTitle
        lines={[
          { text: "Does this look" },
          { text: "%%right?%%", red: true },
        ]}
      />
      <FittingWhisper>
        Face reading plus the numbers you already gave me. The twin on the
        right is the picture — fix anything that&apos;s off here, then lock it.
      </FittingWhisper>
      {rows.map((row) => (
        <div key={row.path}>
          <FittingQlbl>{row.label}</FittingQlbl>
          <input
            type="text"
            value={edits[row.path] ?? row.value ?? ""}
            onChange={(e) =>
              setEdits((prev) => ({ ...prev, [row.path]: e.target.value }))
            }
            className="w-full max-w-[440px] border-0 border-b-[3px] border-[var(--fitting-ink)] bg-transparent py-1.5 font-display text-[22px] font-bold text-[var(--fitting-ink)] outline-none placeholder:text-[#D9D9DE] focus:border-[var(--fitting-red)]"
          />
        </div>
      ))}

      <FittingQlbl>Height</FittingQlbl>
      <div className="flex flex-wrap items-end gap-3">
        {body.heightUnit === "cm" ? (
          <input
            type="text"
            inputMode="numeric"
            value={body.heightCm || ""}
            onChange={(e) =>
              onBodyChange(
                "heightCm",
                Number(e.target.value.replace(/[^\d]/g, "")) || 0,
              )
            }
            className="w-[120px] border-0 border-b-[3px] border-[var(--fitting-ink)] bg-transparent py-1.5 font-display text-[22px] font-bold outline-none focus:border-[var(--fitting-red)]"
          />
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              value={body.heightFt || ""}
              onChange={(e) =>
                onBodyChange(
                  "heightFt",
                  Number(e.target.value.replace(/[^\d]/g, "")) || 0,
                )
              }
              className="w-[72px] border-0 border-b-[3px] border-[var(--fitting-ink)] bg-transparent py-1.5 font-display text-[22px] font-bold outline-none focus:border-[var(--fitting-red)]"
            />
            <span className="pb-2 text-[12px] font-bold text-[var(--fitting-quiet)]">
              ft
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={body.heightIn || ""}
              onChange={(e) =>
                onBodyChange(
                  "heightIn",
                  Number(e.target.value.replace(/[^\d]/g, "")) || 0,
                )
              }
              className="w-[72px] border-0 border-b-[3px] border-[var(--fitting-ink)] bg-transparent py-1.5 font-display text-[22px] font-bold outline-none focus:border-[var(--fitting-red)]"
            />
          </>
        )}
        <span className="pb-2 text-[12px] font-bold text-[var(--fitting-quiet)]">
          {body.heightUnit === "cm" ? "cm" : "in"}
        </span>
      </div>

      <FittingQlbl>Weight</FittingQlbl>
      <div className="flex flex-wrap items-end gap-3">
        <input
          type="text"
          inputMode="numeric"
          value={body.weightSkipped ? "" : body.weightValue ?? ""}
          placeholder="—"
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d]/g, "");
            onBodyChange("weightSkipped", false);
            onBodyChange("weightValue", raw ? Number(raw) : null);
          }}
          className="w-[120px] border-0 border-b-[3px] border-[var(--fitting-ink)] bg-transparent py-1.5 font-display text-[22px] font-bold outline-none placeholder:text-[#D9D9DE] focus:border-[var(--fitting-red)]"
        />
        <span className="pb-2 text-[12px] font-bold text-[var(--fitting-quiet)]">
          {body.weightUnit}
        </span>
      </div>

      <FittingQlbl>Build</FittingQlbl>
      <div className="flex max-w-[520px] flex-wrap gap-2">
        {BUILDS.map((b) => (
          <OnboardingChip
            key={b.value}
            selected={shown.build === b.value}
            onClick={() => onBodyChange("build", b.value)}
          >
            {b.label}
          </OnboardingChip>
        ))}
      </div>

      <FittingQlbl>Definition</FittingQlbl>
      <div className="flex max-w-[520px] flex-wrap gap-2">
        {MUSCLE.map((m) => (
          <OnboardingChip
            key={m.value}
            selected={shown.muscularity === m.value}
            onClick={() => onBodyChange("muscularity", m.value)}
          >
            {m.label}
          </OnboardingChip>
        ))}
      </div>

      <FittingQlbl>Shape</FittingQlbl>
      <div className="flex max-w-[520px] flex-wrap gap-2">
        {SHAPES.map((s) => (
          <OnboardingChip
            key={s.value}
            selected={shown.bodyShape === s.value}
            onClick={() =>
              onBodyChange(
                "bodyShape",
                shown.bodyShape === s.value ? null : s.value,
              )
            }
          >
            {s.label}
          </OnboardingChip>
        ))}
      </div>

      {error ? (
        <p className="mt-4 text-[13px] font-semibold text-[var(--fitting-red)]">
          {error}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <FittingCta onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "That’s me"}
        </FittingCta>
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className="text-[13px] font-bold text-[var(--fitting-quiet)] underline-offset-4 hover:text-[var(--fitting-ink)] hover:underline"
          >
            Skip for now
          </button>
        ) : null}
      </div>
    </section>
  );
}
