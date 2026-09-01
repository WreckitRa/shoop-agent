"use client";

import { HONESTY_OPTIONS } from "@/lib/onboarding/form-options";
import {
  FittingKick,
  FittingNavRow,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onContinue?: () => void;
  busy?: boolean;
};

const SCALE = HONESTY_OPTIONS.map((o) => o.value);

export function TasteHonestyStep({
  value,
  onChange,
  onContinue,
  busy,
}: Props) {
  const current = SCALE.includes(value as (typeof SCALE)[number])
    ? value
    : "3";
  const idx = Math.max(0, SCALE.indexOf(current as (typeof SCALE)[number]));
  const opt = HONESTY_OPTIONS[idx]!;

  return (
    <section>
      <FittingKick>PERSON</FittingKick>
      <FittingTitle
        lines={[
          { text: "How honest" },
          { text: "do you want me?" },
        ]}
      />
      <FittingWhisper>
        I&apos;ll never say a piece works when it doesn&apos;t. This only sets how
        I break the news... and every no comes with a{" "}
        <b>yes that gets you the same look.</b>
      </FittingWhisper>

      <div className="mt-6 max-w-[520px]">
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={Number(current)}
          onChange={(e) => onChange(e.target.value)}
          aria-valuemin={1}
          aria-valuemax={5}
          aria-valuenow={Number(current)}
          aria-label={opt.label}
          className="w-full accent-[var(--fitting-red)]"
        />
        <div className="mt-2 flex justify-between gap-1 text-[10px] font-semibold text-[var(--fitting-quiet)]">
          {HONESTY_OPTIONS.map((o) => (
            <span
              key={o.value}
              className={
                o.value === current
                  ? "font-extrabold text-[var(--fitting-ink)]"
                  : undefined
              }
            >
              {o.value} · {o.label}
            </span>
          ))}
        </div>
        <p className="mt-4 text-[14px] leading-[1.55] text-[var(--fitting-quiet)]">
          <b className="font-semibold text-[var(--fitting-ink)]">{opt.label}.</b>{" "}
          “{opt.quote}”
        </p>
      </div>

      {onContinue ? (
        <FittingNavRow
          onNext={onContinue}
          busy={busy}
          nextLabel="Lock it in"
          enterHint={false}
        />
      ) : null}
    </section>
  );
}
