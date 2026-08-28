"use client";

import { useRef, useState } from "react";
import {
  FittingCta,
  FittingKick,
  FittingNavRow,
  FittingQlbl,
  FittingTitle,
  FittingWhisper,
  OnboardingChip,
  OnboardingWhy,
} from "@/components/onboarding/onboarding-ui";
import { cn } from "@/lib/ai-chat/cn";
import type {
  BodyShapeBand,
  BuildBand,
  BustFullnessBand,
  MuscularityBand,
} from "@/lib/tryon/types";
import type { BuildKey } from "./types";
import type { PhotoCoverage } from "@/lib/photo-analysis/result";
import { resolveVisualDefinition } from "./bodySilhouetteGeometry";

export type LegLineBand = "long_torso" | "even" | "long_leg";

export type FittingPhotoValues = {
  photoPreview: string | null;
  photoCoverage: PhotoCoverage;
  heightUnit: "ft" | "cm";
  heightFt: number;
  heightIn: number;
  heightCm: number;
  weightValue: number | null;
  weightUnit: "lb" | "kg";
  weightSkipped: boolean;
  build: BuildKey | null;
  /** Soft / toned / defined — required for FASHN silhouette. */
  muscularity: MuscularityBand | null;
  /** Proportion distribution — optional, used in FASHN prompt when set. */
  bodyShape: BodyShapeBand | null;
  /** Women's department only — optional visual band. */
  bustFullness: BustFullnessBand | null;
  /** Typed in when the photo stops at the hips. */
  legLine: LegLineBand | null;
};

type Props = {
  values: FittingPhotoValues;
  onChange: <K extends keyof FittingPhotoValues>(
    key: K,
    value: FittingPhotoValues[K],
  ) => void;
  onPhotoFile?: (file: File) => void;
  onSkipPhoto: () => void;
  onContinue: () => void;
  busy?: boolean;
  showContinue?: boolean;
  /** Show bust-fullness chips when gender presentation is feminine. */
  showBust?: boolean;
  /** scan = photo + analysis first; body = height/build after identity. */
  mode?: "scan" | "body";
  /** Guest: local preview only — processing waits until they save progress. */
  deferProcessing?: boolean;
};

/** Smart default when user skips definition — still satisfies FASHN required attrs. */
export function defaultMuscularityForBuild(
  build: BuildBand | BuildKey | null | undefined,
): MuscularityBand {
  return resolveVisualDefinition(build ?? null, null);
}

const BUILDS: { label: string; value: BuildKey }[] = [
  { label: "Slim", value: "slim" },
  { label: "Average", value: "average" },
  { label: "Athletic", value: "athletic" },
  { label: "Broad", value: "broad" },
  { label: "Plus", value: "plus" },
];

const MUSCLE: { label: string; value: MuscularityBand; hint: string }[] = [
  { label: "Soft", value: "low", hint: "Relaxed, natural" },
  { label: "Toned", value: "moderate", hint: "Light definition" },
  { label: "Defined", value: "high", hint: "Visible shape" },
];

const BODY_SHAPES: { label: string; value: BodyShapeBand }[] = [
  { label: "Rectangle", value: "rectangle" },
  { label: "Triangle", value: "triangle" },
  { label: "Inverted", value: "inverted_triangle" },
  { label: "Hourglass", value: "hourglass" },
  { label: "Oval", value: "oval" },
];

const BUST: { label: string; value: BustFullnessBand }[] = [
  { label: "Subtle", value: "subtle" },
  { label: "Average", value: "average" },
  { label: "Full", value: "full" },
  { label: "Very full", value: "very_full" },
];

const LEG_LINES: { label: string; value: LegLineBand; hint: string }[] = [
  { label: "Long torso", value: "long_torso", hint: "Rise sits higher" },
  { label: "Even", value: "even", hint: "Split at mid" },
  { label: "Long legs", value: "long_leg", hint: "Inseam does the work" },
];

/** Digit width for tabular numbers; pad so "4" / "175" never clip. */
function digitWidth(val: string | number, minDigits = 1) {
  const s = String(val === "" || val == null ? "0" : val);
  const digits = Math.max(minDigits, s.length);
  return `${digits + 1}ch`;
}

function UnitSeg({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-[13px] border-[1.5px] border-[var(--fitting-g3)] bg-white">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "px-3.5 py-2.5 text-xs font-extrabold transition sm:px-[18px]",
            value === opt.id
              ? "bg-[var(--fitting-ink)] text-white"
              : "text-[var(--fitting-quiet)] hover:text-[var(--fitting-ink)]",
          )}
        >
          {opt.label}
        </button>
      ))}
    </span>
  );
}

/**
 * Value first, then unit, then steppers — fixed min height, digits never clipped.
 * Layout: [number] [unit] | [▲▼]
 *
 * While focused, do not clamp to min — otherwise typing 75 is impossible (7 clamps to 35).
 * Final min/max applied on blur; max still soft-enforced while typing.
 */
function NumBox({
  value,
  min,
  max,
  unit,
  onChange,
  minDigits = 1,
  placeholder,
}: {
  value: number | null;
  min: number;
  max: number;
  unit: string;
  onChange: (n: number | null) => void;
  minDigits?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display =
    draft !== null ? draft : value == null ? "" : String(value);

  function commitClamp(n: number | null) {
    if (n == null) {
      onChange(null);
      return;
    }
    onChange(Math.min(max, Math.max(min, n)));
  }

  return (
    <span className="inline-flex h-[52px] items-center overflow-visible rounded-[13px] border-[1.5px] border-[var(--fitting-g3)] bg-white">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        placeholder={placeholder ?? "—"}
        onFocus={() => setDraft(value == null ? "" : String(value))}
        onChange={(e) => {
          // Digits only — free entry; min not applied until blur.
          const raw = e.target.value.replace(/[^\d]/g, "");
          setDraft(raw);
          if (raw === "") {
            onChange(null);
            return;
          }
          const n = Number(raw);
          if (Number.isNaN(n)) return;
          if (n > max) {
            setDraft(String(max));
            onChange(max);
            return;
          }
          onChange(n);
        }}
        onBlur={() => {
          setDraft(null);
          if (value == null && display === "") return;
          const n =
            value ??
            (display === "" ? null : Number(display.replace(/[^\d]/g, "")));
          if (n == null || Number.isNaN(n)) {
            onChange(null);
            return;
          }
          commitClamp(n);
        }}
        style={{ width: digitWidth(display || placeholder || "0", minDigits) }}
        className="min-w-[2.75em] border-0 bg-transparent py-2 pl-3.5 font-display text-[22px] font-extrabold leading-none tabular-nums text-[var(--fitting-ink)] outline-none placeholder:text-[#D9D9DE]"
      />
      <b className="shrink-0 pl-1 pr-2 text-[10.5px] font-bold uppercase tracking-[0.04em] text-[#B7B7BF]">
        {unit}
      </b>
      <span className="flex h-full flex-col justify-center border-l border-[#EEEEF2] pr-1">
        <button
          type="button"
          className="px-2 py-0.5 text-[8px] leading-none text-[var(--fitting-quiet)] hover:text-[var(--fitting-ink)]"
          onClick={() => {
            setDraft(null);
            commitClamp((value ?? min) + 1);
          }}
          aria-label={`Increase ${unit}`}
        >
          ▲
        </button>
        <button
          type="button"
          className="px-2 py-0.5 text-[8px] leading-none text-[var(--fitting-quiet)] hover:text-[var(--fitting-ink)]"
          onClick={() => {
            setDraft(null);
            commitClamp((value ?? min) - 1);
          }}
          aria-label={`Decrease ${unit}`}
        >
          ▼
        </button>
      </span>
    </span>
  );
}

function lbToKg(lb: number) {
  return Math.round(lb * 0.453592);
}
function kgToLb(kg: number) {
  return Math.round(kg / 0.453592);
}

export function FittingPhotoStep({
  values,
  onChange,
  onPhotoFile,
  onSkipPhoto,
  onContinue,
  busy,
  showContinue = true,
  showBust = false,
  mode = "scan",
  deferProcessing = false,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  function setHeightUnit(next: "ft" | "cm") {
    if (next === values.heightUnit) return;
    if (next === "cm") {
      const cm = Math.round((values.heightFt * 12 + values.heightIn) * 2.54);
      onChange("heightCm", Math.min(210, Math.max(140, cm)));
    } else {
      const totalIn = values.heightCm / 2.54;
      const ft = Math.floor(totalIn / 12);
      const inch = Math.round(totalIn % 12);
      onChange("heightFt", Math.min(7, Math.max(4, ft)));
      onChange("heightIn", Math.min(11, Math.max(0, inch === 12 ? 0 : inch)));
    }
    onChange("heightUnit", next);
  }

  function setWeightUnit(next: "lb" | "kg") {
    if (next === values.weightUnit) return;
    if (values.weightValue != null) {
      const converted =
        next === "kg"
          ? lbToKg(values.weightValue)
          : kgToLb(values.weightValue);
      onChange(
        "weightValue",
        Math.min(250, Math.max(35, converted)),
      );
    }
    onChange("weightUnit", next);
  }

  const scan = mode === "scan";
  const showBody = true;
  const showLegs = true;

  return (
    <section>
      {scan ? (
        <FittingKick>LOOK · PHOTO</FittingKick>
      ) : (
        <FittingKick>LOOK · BUILD</FittingKick>
      )}
      <FittingTitle
        lines={
          scan
            ? [
                { text: "The photo doesn't" },
                { text: "round %%down.%%", red: true },
              ]
            : [
                { text: "A few" },
                { text: "%%numbers.%%", red: true },
              ]
        }
      />
      {scan ? (
        <FittingWhisper>
          {deferProcessing
            ? "One face photograph — tap the face on the card. It stays on this device until you save your progress — we don't process it until then. Height and build are typed facts after this."
            : "One face photograph — tap the face on the card. Height and build are typed facts after this — used for the twin, never shown, never judged."}
        </FittingWhisper>
      ) : (
        <FittingWhisper>
          Height, build, the honest bits. Used for the twin — never shown, never
          judged.
        </FittingWhisper>
      )}

      {scan ? (
        <>
          {!values.photoPreview ? (
            <button
              type="button"
              onClick={onSkipPhoto}
              className="mt-1 border-0 border-b border-[var(--fitting-line)] bg-transparent pb-0.5 text-[12.5px] font-semibold text-[var(--fitting-quiet)]"
            >
              skip... you can add it at the Mirror
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-[12.5px] font-bold text-[var(--fitting-quiet)] hover:text-[var(--fitting-ink)]"
              >
                Change photo
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPhotoFile?.(f);
                }}
              />
            </div>
          )}

          <OnboardingWhy>
            Face the light, just you, no heavy filters.{" "}
            <b className="font-bold text-[var(--fitting-red)]">
              Your photos train nothing and are sold to no one
            </b>
            ... delete anytime.
          </OnboardingWhy>
        </>
      ) : null}

      {scan ? null : (
        <>
      <FittingQlbl>How tall are you?</FittingQlbl>
      <div className="flex flex-wrap items-center gap-3">
        {values.heightUnit === "ft" ? (
          <div className="flex flex-wrap gap-2.5">
            <NumBox
              unit="ft"
              value={values.heightFt}
              min={4}
              max={7}
              minDigits={1}
              onChange={(n) => onChange("heightFt", n ?? 5)}
            />
            <NumBox
              unit="in"
              value={values.heightIn}
              min={0}
              max={11}
              minDigits={1}
              onChange={(n) => onChange("heightIn", n ?? 0)}
            />
          </div>
        ) : (
          <NumBox
            unit="cm"
            value={values.heightCm}
            min={140}
            max={210}
            minDigits={3}
            onChange={(n) => onChange("heightCm", n ?? 175)}
          />
        )}
        <UnitSeg
          value={values.heightUnit}
          onChange={(id) => setHeightUnit(id as "ft" | "cm")}
          options={[
            { id: "ft", label: "ft / in" },
            { id: "cm", label: "cm" },
          ]}
        />
      </div>
      <OnboardingWhy>
        type it... and watch the card, the figure grows with you
      </OnboardingWhy>

      <FittingQlbl hint="helps the fit math... never shown, never judged">
        And your weight?
      </FittingQlbl>
      <div className="flex flex-wrap items-center gap-3">
        <NumBox
          unit={values.weightUnit}
          value={values.weightSkipped ? null : values.weightValue}
          min={35}
          max={250}
          minDigits={2}
          placeholder="—"
          onChange={(n) => {
            onChange("weightSkipped", false);
            onChange("weightValue", n);
          }}
        />
        <UnitSeg
          value={values.weightUnit}
          onChange={(id) => setWeightUnit(id as "lb" | "kg")}
          options={[
            { id: "lb", label: "lb" },
            { id: "kg", label: "kg" },
          ]}
        />
        <OnboardingChip
          selected={values.weightSkipped}
          onClick={() => {
            onChange("weightSkipped", !values.weightSkipped);
            if (!values.weightSkipped) onChange("weightValue", null);
          }}
        >
          Prefer not to say
        </OnboardingChip>
      </div>

      {showBody ? (
        <>
      <FittingQlbl hint="honesty beats flattery... true fit is the whole point">
        Your build
      </FittingQlbl>
      <div className="flex max-w-[620px] flex-wrap gap-2.5">
        {BUILDS.map((b) => (
          <OnboardingChip
            key={b.value}
            selected={values.build === b.value}
            onClick={() => onChange("build", b.value)}
          >
            {b.label}
          </OnboardingChip>
        ))}
      </div>

      <FittingQlbl hint="Used to shape your twin — soft, toned, or defined">
        Definition
      </FittingQlbl>
      <div className="flex max-w-[620px] flex-wrap gap-2.5">
        {MUSCLE.map((m) => (
          <OnboardingChip
            key={m.value}
            selected={values.muscularity === m.value}
            onClick={() =>
              onChange(
                "muscularity",
                values.muscularity === m.value ? null : m.value,
              )
            }
          >
            {m.label}
          </OnboardingChip>
        ))}
      </div>

      <FittingQlbl hint="where weight sits — shoulders, hips, middle. Skip if unsure.">
        Shape
      </FittingQlbl>
      <div className="flex max-w-[620px] flex-wrap gap-2.5">
        {BODY_SHAPES.map((s) => (
          <OnboardingChip
            key={s.value}
            selected={values.bodyShape === s.value}
            onClick={() =>
              onChange(
                "bodyShape",
                values.bodyShape === s.value ? null : s.value,
              )
            }
          >
            {s.label}
          </OnboardingChip>
        ))}
      </div>

      {showBust ? (
        <>
          <FittingQlbl hint="visual only — for the twin, never cup sizes">
            Bust
          </FittingQlbl>
          <div className="flex max-w-[620px] flex-wrap gap-2.5">
            {BUST.map((b) => (
              <OnboardingChip
                key={b.value}
                selected={values.bustFullness === b.value}
                onClick={() =>
                  onChange(
                    "bustFullness",
                    values.bustFullness === b.value ? null : b.value,
                  )
                }
              >
                {b.label}
              </OnboardingChip>
            ))}
          </div>
        </>
      ) : null}
        </>
      ) : null}

      {showLegs ? (
        <>
          <FittingQlbl hint="where the vertical splits — rise vs inseam">
            Legs
          </FittingQlbl>
          <div className="flex max-w-[620px] flex-wrap gap-2.5">
            {LEG_LINES.map((l) => (
              <OnboardingChip
                key={l.value}
                selected={values.legLine === l.value}
                onClick={() =>
                  onChange(
                    "legLine",
                    values.legLine === l.value ? null : l.value,
                  )
                }
              >
                {l.label}
              </OnboardingChip>
            ))}
          </div>
        </>
      ) : null}
        </>
      )}

      {showContinue ? (
        scan && values.photoPreview ? (
          <div className="sticky bottom-0 z-[4] mt-8 bg-gradient-to-t from-white via-white/95 to-transparent pt-6">
            <FittingCta onClick={onContinue} disabled={busy}>
              {busy ? "Saving…" : "Keep going... it's developing"}
            </FittingCta>
          </div>
        ) : (
          <FittingNavRow
            onNext={onContinue}
            busy={busy}
            nextLabel={scan ? "Skip for now" : "Lock it in"}
          />
        )
      ) : null}
    </section>
  );
}
