"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/ai-chat/cn";
import {
  FittingKick,
  FittingMulti,
  FittingNavRow,
  FittingTitle,
  FittingWhisper,
} from "@/components/onboarding/onboarding-ui";
import { OUTFIT_DECK_PAGE_SIZE } from "@/lib/onboarding/outfit-grid";
import { styleTileAspect } from "@/lib/onboarding/outfit-shuffle";

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
];

const SKELETON_ASPECTS = ["3/4", "1/1", "4/5", "2/3", "5/6", "3/4"] as const;

function pagesOf<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

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
      <FittingKick>
        {mode === "worn" ? "EVIDENCE · WORN" : "DIRECTION · WANTED"}
      </FittingKick>
      <FittingTitle lines={[...title]} />
      <FittingWhisper>
        {mode === "worn" ? (
          <>
            No judgment... this is a safe space for that hoodie.{" "}
            <b>Your picks are voting on the twin.</b>
          </>
        ) : (
          <>
            Pick two. Where you&apos;re headed matters as much as where you are...{" "}
            <b>I dress both.</b>
          </>
        )}
      </FittingWhisper>
      <FittingMulti>
        {mode === "worn" ? "PICK UP TO THREE" : "PICK TWO"}
      </FittingMulti>

      {maxHint ? (
        <p className="mb-3 text-xs font-bold text-[var(--fitting-red)]">
          Remove one to swap — max {maxPicks}.
        </p>
      ) : null}

      {loading ? (
        <div className="fitting-brand-grid max-w-[680px]">
          {SKELETON_ASPECTS.map((aspect, i) => (
            <div
              key={i}
              className="fitting-brand-card mb-3 animate-pulse rounded-2xl bg-[var(--fitting-g2)]"
              style={{ aspectRatio: aspect }}
            />
          ))}
        </div>
      ) : (
        pagesOf(cards, OUTFIT_DECK_PAGE_SIZE).map((page, pageIndex) => (
          <div
            key={page[0]?.id ?? pageIndex}
            className="fitting-brand-grid max-w-[680px]"
          >
            {page.map((card, index) => {
              const selected = selectedIds.includes(card.id);
              const globalIndex = pageIndex * OUTFIT_DECK_PAGE_SIZE + index;
              const bg =
                FALLBACK_GRADIENTS[globalIndex % FALLBACK_GRADIENTS.length]!;
              const aspect = styleTileAspect(card.id);
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => handleToggle(card)}
                  className={cn(
                    "fitting-brand-card mb-3 block w-full overflow-hidden rounded-2xl border-2 border-transparent text-left transition duration-200 hover:-translate-y-[3px]",
                    selected &&
                      "shadow-[inset_0_0_0_3px_var(--fitting-ink)] [filter:saturate(1.08)]",
                    !selected &&
                      selectedIds.length >= maxPicks &&
                      "opacity-50",
                  )}
                >
                  <span
                    className="relative block w-full overflow-hidden"
                    style={{
                      aspectRatio: aspect,
                      background: card.imageUrl ? undefined : bg,
                    }}
                  >
                    {card.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={card.imageUrl}
                        alt=""
                        className="fitting-brand-im absolute inset-0 size-full object-cover object-[center_18%]"
                        draggable={false}
                      />
                    ) : null}
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-2/5 bg-[linear-gradient(0deg,rgba(0,0,0,.55),transparent)]" />
                    <span
                      className={cn(
                        "absolute right-2.5 top-2.5 z-[5] grid size-[26px] place-items-center rounded-[9px] bg-[var(--fitting-ink)] text-[12px] font-extrabold text-white transition-opacity",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    >
                      ✓
                    </span>
                    <span className="absolute inset-x-0 bottom-0 z-[3] px-3 pb-2.5 font-display text-[12.5px] font-extrabold uppercase leading-[1.25] tracking-[0.14em] text-white [text-shadow:0_1px_10px_rgba(0,0,0,.45)]">
                      {card.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))
      )}

      {hasMore && onSeeMore && !loading ? (
        <div className="mt-2 max-w-[680px]">
          <button
            type="button"
            onClick={onSeeMore}
            disabled={loadingMore || busy}
            aria-busy={loadingMore || undefined}
            className="inline-flex h-[52px] items-center gap-2 rounded-[14px] border-[1.5px] border-[var(--fitting-ink)] bg-white px-5 font-display text-[13.5px] font-extrabold text-[var(--fitting-ink)] transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
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
