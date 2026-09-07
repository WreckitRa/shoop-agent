"use client";

import {
  HONESTY_OPTIONS,
  normalizeHonestyPreference,
} from "@/lib/onboarding/form-options";
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

export function TasteHonestyStep({
  value,
  onChange,
  onContinue,
  busy,
}: Props) {
  const current = normalizeHonestyPreference(value) || "3";
  const opt = HONESTY_OPTIONS.find((o) => o.value === current)!;
  const fillPct = ((Number(current) - 1) / 4) * 100;

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

      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={Number(current)}
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={Number(current)}
        aria-valuetext={opt.label}
        aria-label="How honest do you want me"
        onChange={(e) => onChange(e.target.value)}
        className="fitting-honesty-slider mt-6 w-full max-w-[520px]"
        style={{
          background: `linear-gradient(to right, var(--fitting-ink) ${fillPct}%, var(--fitting-g3) ${fillPct}%)`,
        }}
      />
      <div className="mt-2 flex max-w-[520px] justify-between font-display text-[10px] font-extrabold tracking-[0.06em] text-[var(--fitting-quiet)]">
        {HONESTY_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              o.value === current
                ? "text-[var(--fitting-ink)]"
                : "text-[var(--fitting-quiet)]"
            }
          >
            {o.value}
          </button>
        ))}
      </div>
      <p className="mt-4 max-w-[520px] text-[14px] leading-[1.55] text-[var(--fitting-quiet)]">
        <b className="font-semibold text-[var(--fitting-ink)]">{opt.label}.</b>{" "}
        “{opt.quote}”
      </p>

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
