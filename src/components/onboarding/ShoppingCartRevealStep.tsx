"use client";

import type { StyleMix } from "@/lib/onboarding/style-mix";
import { formatStyleMixNarration } from "@/lib/onboarding/style-mix";

type Props = {
  preferredName: string;
  styleMix: StyleMix | null;
  busy?: boolean;
  onContinue: () => void;
  onSaveCard?: () => void;
};

export function ShoppingCartRevealStep({
  preferredName,
  styleMix,
  busy,
  onContinue,
  onSaveCard,
}: Props) {
  const mix: StyleMix = styleMix ?? {
    axes: [
      { label: "Minimal", percent: 50 },
      { label: "Classic", percent: 30 },
      { label: "Parisian", percent: 20 },
    ],
    headingToward: "Polished",
    headingPercent: 25,
  };
  const copy = formatStyleMixNarration(mix, preferredName);

  return (
    <section className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <div className="flex h-[260px] w-full max-w-[210px] shrink-0 flex-col rounded-[18px] bg-gradient-to-br from-[#1A1A2E] via-[#4a2c35] to-[#c98a74] p-4 text-white shadow-[0_18px_40px_-16px_rgba(26,26,46,0.5)]">
        <div className="text-[10px] tracking-[0.14em] opacity-80">
          SHOOPING CART
        </div>
        <div className="mt-auto text-[13px] font-bold leading-relaxed">
          {mix.axes.map((a) => (
            <div key={a.label}>
              {a.percent}% {a.label}
            </div>
          ))}
          {mix.headingToward && mix.headingPercent ? (
            <div className="mt-1 text-[11.5px] font-normal opacity-85">
              heading {mix.headingPercent}% more {mix.headingToward}
            </div>
          ) : null}
        </div>
        <div className="mt-2.5 text-[9px] opacity-70">
          SHOOP · the better we know you, the better you look
        </div>
      </div>

      <div className="flex-1 space-y-3 text-[13.5px] leading-6 text-ink">
        <p className="whitespace-pre-line">{copy.body}</p>
        <p className="text-[15px] font-extrabold">{copy.locked}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onContinue}
            className="text-sm font-semibold text-[#007AFF] transition hover:underline disabled:opacity-50"
          >
            {busy ? "Saving…" : "Let's find you something →"}
          </button>
          {onSaveCard ? (
            <button
              type="button"
              disabled={busy}
              onClick={onSaveCard}
              className="rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-[13px] font-semibold disabled:opacity-50"
            >
              Save my card
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
