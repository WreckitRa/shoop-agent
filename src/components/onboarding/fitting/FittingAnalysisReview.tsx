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
import { cn } from "@/lib/ai-chat/cn";
import { guestFetch } from "@/lib/client/guest-fetch";
import {
  buildStyleUserReview,
  listConfirmableTraits,
  type ConfirmedBody,
} from "@/lib/photo-analysis/review";
import type { StylePhotoAnalysis } from "@/lib/photo-analysis/result";
import type { PhotoAnalysisPublic } from "@/lib/photo-analysis/types";
import {
  kindHasColor,
  matchScanTrait,
  optionsForKind,
  scanTraitKind,
  type ScanTraitKind,
  type ScanTraitOption,
} from "@/lib/photo-analysis/scan-trait-options";
import {
  heightCmFromPhotoValues,
  type FittingPhotoValues,
} from "./FittingPhotoStep";
import { resolveScanCheckBody } from "./scan-check-body";

export function confirmedBodyFromPhoto(
  values: FittingPhotoValues,
): ConfirmedBody {
  const heightCm = heightCmFromPhotoValues(values);
  const weightKg =
    values.weightSkipped || values.weightValue == null
      ? null
      : values.weightUnit === "kg"
        ? Math.round(values.weightValue)
        : Math.round(values.weightValue * 0.453592);
  return {
    height_cm: heightCm,
    weight_kg: weightKg,
    body_type: values.build,
    muscularity: values.muscularity,
    body_shape: values.bodyShape,
    bust_fullness: values.bustFullness,
    leg_line: values.legLine,
  };
}

function ColorDropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ScanTraitOption[];
  value: string;
  onChange: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected =
    options.find((o) => o.label === value || o.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative max-w-[280px]">
      <FittingQlbl>{label}</FittingQlbl>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-12 w-full items-center gap-3 rounded-xl border-[1.5px] bg-white px-3 text-left",
          open
            ? "border-[var(--fitting-ink)]"
            : "border-[var(--fitting-line)]",
        )}
      >
        <span
          className="size-7 shrink-0 rounded-full border border-black/10"
          style={{ background: selected?.hex ?? "#EEEFF3" }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--fitting-ink)]">
          {selected?.label ?? "Pick"}
        </span>
        <span className="text-[11px] text-[var(--fitting-quiet)]" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-2xl border border-[var(--fitting-line)] bg-white p-1 shadow-[0_16px_40px_-24px_rgba(14,14,17,0.45)]"
        >
          {options.map((o) => {
            const on = o.label === selected?.label;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    onChange(o.label);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-[13.5px] font-semibold",
                    on
                      ? "bg-[#F4F4F6] text-[var(--fitting-ink)]"
                      : "text-[var(--fitting-ink)] hover:bg-[#F7F7F9]",
                  )}
                >
                  <span
                    className="size-7 shrink-0 rounded-full border border-black/10"
                    style={{ background: o.hex }}
                    aria-hidden
                  />
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function ChipTrait({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ScanTraitOption[];
  value: string;
  onChange: (label: string) => void;
}) {
  return (
    <div>
      <FittingQlbl>{label}</FittingQlbl>
      <div className="flex max-w-[520px] flex-wrap gap-2">
        {options.map((o) => (
          <OnboardingChip
            key={o.id}
            selected={o.label === value || o.id === value}
            onClick={() => onChange(o.label)}
          >
            {o.label}
          </OnboardingChip>
        ))}
      </div>
    </div>
  );
}

function traitControl(
  kind: ScanTraitKind,
  label: string,
  value: string,
  onChange: (label: string) => void,
) {
  const options = optionsForKind(kind);
  if (kindHasColor(kind)) {
    return (
      <ColorDropdown
        label={label}
        options={options}
        value={value}
        onChange={onChange}
      />
    );
  }
  return (
    <ChipTrait
      label={label}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}

export function AnalysisReviewForm({
  photoHash,
  result,
  saved,
  body,
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
    for (const row of rows) {
      const kind = scanTraitKind(row.path);
      const fromSaved = saved?.corrections?.find((c) => c.path === row.path)
        ?.corrected_value;
      if (fromSaved) {
        out[row.path] = fromSaved;
        continue;
      }
      out[row.path] = kind
        ? matchScanTrait(kind, row.value ?? "")?.label ?? ""
        : (row.value ?? "");
    }
    return out;
  }, [rows, saved]);
  const [edits, setEdits] = useState<Record<string, string>>(initialEdits);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        Colours and shape from the photo. Tap anything that&apos;s off — then
        lock it.
      </FittingWhisper>

      {rows.map((row) => {
        const kind = scanTraitKind(row.path);
        if (!kind) return null;
        return (
          <div key={row.path}>
            {traitControl(kind, row.label, edits[row.path] ?? "", (label) =>
              setEdits((prev) => ({ ...prev, [row.path]: label })),
            )}
          </div>
        );
      })}

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
