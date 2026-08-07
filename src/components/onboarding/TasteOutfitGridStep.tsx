"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/ai-chat/cn";
import {
  FittingNavRow,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";

export type OutfitGridCard = {
  id: string;
  productId?: string;
  label: string;
  title?: string;
  imageUrl: string;
  tasteTags?: string[];
  archetype?: string;
  cell?: number;
};

type Props = {
  mode: "worn" | "aspirational";
  cards: OutfitGridCard[];
  selectedIds: string[];
  maxPicks: number;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onSeeMore?: () => void;
  onToggle: (card: OutfitGridCard) => void;
  why: string;
  onContinue?: () => void;
  busy?: boolean;
};

const FALLBACK_GRADIENTS = [
  "linear-gradient(165deg,#2E3440 0%,#4A5468 55%,#6E7890 100%)",
  "linear-gradient(160deg,#4A3E36 0%,#77604E 60%,#A08668 100%)",
  "linear-gradient(165deg,#33402F 0%,#5C7050 60%,#84986E 100%)",
  "linear-gradient(165deg,#20263E 0%,#3A4470 60%,#5A6494 100%)",
  "linear-gradient(160deg,#482432 0%,#7C3A52 60%,#A85A74 100%)",
  "linear-gradient(165deg,#4E4A3C 0%,#847C60 60%,#B0A480 100%)",
  "linear-gradient(165deg,#22342A 0%,#3E6448 60%,#5E8A68 100%)",
  "linear-gradient(165deg,#32363E 0%,#5E6572 60%,#8A93A0 100%)",
  "linear-gradient(160deg,#44202C 0%,#7C3048 60%,#A84E68 100%)",
];

export function TasteOutfitGridStep({
  mode,
  cards,
  selectedIds,
  maxPicks,
  loading,
  loadingMore,
  hasMore,
  onSeeMore,
  onToggle,
  why,
  onContinue,
  busy,
}: Props) {
  const [maxHint, setMaxHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, []);

  function handleToggle(card: OutfitGridCard) {
    const selected = selectedIds.includes(card.id);
    if (!selected && selectedIds.length >= maxPicks) {
      setMaxHint(true);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setMaxHint(false), 1400);
      return;
    }
    onToggle(card);
  }

  const title =
    mode === "worn"
      ? ([
          { text: "Which three did you" },
          { text: "actually wear most?" },
        ] as const)
      : ([
          { text: "Whose closet" },
          { text: "would you %%steal?%%", red: true as const },
        ] as const);

  return (
    <section>
      <FittingTitle lines={[...title]} />
      <FittingWhisper>
        {mode === "worn" ? (
          <>
            No judgment... this is a safe space for that hoodie.{" "}
            <b>Your picks are voting on the print.</b>
          </>
        ) : (
          <>
            Pick two. Where you&apos;re headed matters as much as where you are...{" "}
            <b>I dress both.</b>
          </>
        )}
      </FittingWhisper>

      {maxHint ? (
        <p className="mb-3 text-xs font-bold text-[var(--fitting-red)]">
          Remove one to swap — max {maxPicks}.
        </p>
      ) : null}

      {loading ? (
        <div className="columns-2 gap-3 max-w-[680px] sm:columns-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="mb-3.5 animate-pulse break-inside-avoid rounded-[14px] bg-[#E9E9EE]"
              style={{ aspectRatio: i % 2 === 0 ? "4/5" : "3/4" }}
            />
          ))}
        </div>
      ) : (
        <div className="max-w-[680px] columns-2 gap-3 sm:columns-3">
          {cards.map((card, index) => {
            const selected = selectedIds.includes(card.id);
            const bg =
              FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length]!;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => handleToggle(card)}
                className={cn(
                  "relative mb-3.5 w-full break-inside-avoid overflow-hidden rounded-[14px] border-[2.5px] border-transparent text-left transition-all duration-150",
                  "aspect-[4/5] [filter:saturate(0.9)] hover:[filter:saturate(1.05)] hover:-translate-y-0.5",
                  selected &&
                    "border-[var(--fitting-ink)] [filter:saturate(1.12)] shadow-[inset_0_5px_6px_-2px_rgba(0,0,0,0.55),0_10px_24px_-14px_rgba(14,14,17,0.5)]",
                  !selected &&
                    selectedIds.length >= maxPicks &&
                    "opacity-50",
                )}
                style={{
                  background: card.imageUrl
                    ? undefined
                    : bg,
                }}
              >
                {card.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.imageUrl}
                    alt=""
                    className="absolute inset-0 size-full object-cover"
                    draggable={false}
                  />
                ) : null}
                <span
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(90% 60% at 50% 22%,rgba(255,255,255,.16),transparent 60%),linear-gradient(0deg,rgba(0,0,0,.38) 0%,transparent 45%)",
                  }}
                />
                <span
                  className={cn(
                    "absolute right-2.5 top-2.5 z-[3] font-display text-[13px] font-extrabold text-white transition-opacity",
                    selected ? "opacity-100" : "opacity-0",
                  )}
                >
                  ✓
                </span>
                <span className="absolute inset-0 z-[2] grid place-items-center px-3.5 text-center font-display text-[13.5px] font-extrabold uppercase leading-[1.35] tracking-[0.16em] text-white [text-shadow:0_2px_16px_rgba(0,0,0,.5)]">
                  {card.label}
                </span>
              </button>
            );
          })}
          {loadingMore
            ? Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={`more-skel-${i}`}
                  className="mb-3.5 animate-pulse break-inside-avoid rounded-[14px] bg-[#E9E9EE]"
                  style={{ aspectRatio: i % 2 === 0 ? "4/5" : "3/4" }}
                />
              ))
            : null}
        </div>
      )}

      {hasMore && onSeeMore && !loading ? (
        <div className="mt-5 max-w-[680px]">
          <button
            type="button"
            onClick={onSeeMore}
            disabled={loadingMore || busy}
            className="inline-flex h-12 items-center gap-2 rounded-[14px] border-[1.5px] border-[var(--fitting-ink)] bg-white px-5 font-display text-[13.5px] font-extrabold text-[var(--fitting-ink)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_20px_-12px_rgba(14,14,17,0.35)] disabled:opacity-50"
          >
            {loadingMore ? "Loading more…" : "See more styles"}
            {!loadingMore ? (
              <span aria-hidden className="text-[15px] leading-none">
                ↓
              </span>
            ) : null}
          </button>
        </div>
      ) : null}

      <p className="mt-3 max-w-[480px] text-[11.5px] leading-[1.6] text-[var(--fitting-quiet)]">
        {why}
      </p>

      {onContinue ? (
        <FittingNavRow onNext={onContinue} busy={busy} enterHint={false} />
      ) : null}
    </section>
  );
}
