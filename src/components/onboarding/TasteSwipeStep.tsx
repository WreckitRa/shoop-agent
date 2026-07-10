"use client";

import { Heart, Minus, ThumbsDown } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { OnboardingLoadingPanel } from "@/components/onboarding/OnboardingLoadingPanel";
import { useDeckImagePreloader } from "@/components/onboarding/use-deck-image-preloader";
import { cn } from "@/lib/ai-chat/cn";

export type TasteDeckCard = {
  id: string;
  productId?: string;
  category: string;
  categoryLabel: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  tasteTags?: string[];
};

export type TasteSwipeValue = "like" | "dislike" | "neutral";

export type TasteSwipeResult = {
  cardId: string;
  swipe: TasteSwipeValue;
  tasteTags?: string[];
  productTitle?: string;
  category?: string;
};

type Props = {
  deck: TasteDeckCard[];
  loading?: boolean;
  busy?: boolean;
  compact?: boolean;
  onComplete: (responses: TasteSwipeResult[]) => void;
  onSkip: () => void;
  onBack?: () => void;
};

const SWIPE_THRESHOLD = 72;

function ActionButton({
  label,
  onClick,
  disabled,
  variant,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant: "dislike" | "neutral" | "like";
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        className={cn(
          "flex size-11 items-center justify-center rounded-full bg-white shadow-sm transition-transform active:scale-95 disabled:opacity-50",
          variant === "dislike" && "border-2 border-red-200 text-red-600",
          variant === "neutral" && "border border-hairline text-ink-secondary",
          variant === "like" && "border-2 border-brand/30 text-brand",
        )}
      >
        {variant === "dislike" ? (
          <ThumbsDown className="size-5" />
        ) : variant === "neutral" ? (
          <Minus className="size-4" />
        ) : (
          <Heart className="size-5" />
        )}
      </button>
      <span className="text-[10px] font-medium text-ink-muted">{label}</span>
    </div>
  );
}

export function TasteSwipeStep({
  deck,
  loading,
  busy,
  compact = false,
  onComplete,
  onSkip,
  onBack,
}: Props) {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [animating, setAnimating] = useState(false);
  const [responses, setResponses] = useState<TasteSwipeResult[]>([]);
  const pointerId = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0 });

  const card = deck[index];
  const progress = deck.length ? ((index + 1) / deck.length) * 100 : 0;
  const imageUrls = useMemo(() => deck.map((c) => c.imageUrl), [deck]);
  const { currentReady, markReady } = useDeckImagePreloader(imageUrls, card?.imageUrl);

  const commitSwipe = useCallback(
    (swipe: TasteSwipeValue) => {
      if (!card || animating || busy) return;
      setAnimating(true);
      const nextResponses: TasteSwipeResult[] = [
        ...responses,
        {
          cardId: card.id,
          swipe,
          tasteTags: card.tasteTags,
          productTitle: card.title,
          category: card.category,
        },
      ];
      setResponses(nextResponses);

      const exitX = swipe === "like" ? 420 : swipe === "dislike" ? -420 : 0;
      const exitY = swipe === "neutral" ? -280 : 0;
      setDrag({ x: exitX, y: exitY });

      window.setTimeout(() => {
        setDrag({ x: 0, y: 0 });
        setAnimating(false);
        if (index + 1 >= deck.length) {
          onComplete(nextResponses);
        } else {
          setIndex((i) => i + 1);
        }
      }, 220);
    },
    [animating, busy, card, deck.length, index, onComplete, responses],
  );

  function onPointerDown(e: React.PointerEvent) {
    if (animating || busy || !card || !currentReady) return;
    pointerId.current = e.pointerId;
    start.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (pointerId.current !== e.pointerId || animating) return;
    setDrag({
      x: e.clientX - start.current.x,
      y: e.clientY - start.current.y,
    });
  }

  function onPointerUp(e: React.PointerEvent) {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    const x = e.clientX - start.current.x;
    const y = e.clientY - start.current.y;
    if (x > SWIPE_THRESHOLD) {
      commitSwipe("like");
      return;
    }
    if (x < -SWIPE_THRESHOLD) {
      commitSwipe("dislike");
      return;
    }
    if (y < -SWIPE_THRESHOLD) {
      commitSwipe("neutral");
      return;
    }
    setDrag({ x: 0, y: 0 });
  }

  const rotate = drag.x * 0.04;
  const likeOpacity = Math.min(1, Math.max(0, drag.x / SWIPE_THRESHOLD));
  const dislikeOpacity = Math.min(1, Math.max(0, -drag.x / SWIPE_THRESHOLD));

  if (loading) {
    return <OnboardingLoadingPanel variant="deck" compact={compact} />;
  }

  if (!deck.length) {
    return (
      <div className={cn("space-y-4 text-center", compact && "flex flex-1 flex-col justify-center")}>
        <p className="text-sm text-ink-secondary">
          Nothing to show right now — feel free to skip and continue.
        </p>
        <button type="button" onClick={onSkip} className="btn-primary rounded-full px-5 py-2">
          Continue
        </button>
      </div>
    );
  }

  const actionButtons = (
    <div className="flex items-start justify-center gap-4 sm:justify-start">
      <ActionButton
        label="Nope"
        variant="dislike"
        disabled={busy || animating || !currentReady}
        onClick={() => commitSwipe("dislike")}
      />
      <ActionButton
        label="Unsure"
        variant="neutral"
        disabled={busy || animating || !currentReady}
        onClick={() => commitSwipe("neutral")}
      />
      <ActionButton
        label="Love it"
        variant="like"
        disabled={busy || animating || !currentReady}
        onClick={() => commitSwipe("like")}
      />
    </div>
  );

  const swipeCard = (
    <div className="relative aspect-[3/4] w-[188px] shrink-0 sm:w-[210px]">
      {deck[index + 1] ? (
        <div
          className="absolute inset-0 translate-y-1.5 scale-[0.98] rounded-2xl bg-neutral-200/60"
          aria-hidden
        />
      ) : null}

      <div
        className={cn(
          "relative h-full w-full touch-none select-none overflow-hidden rounded-2xl border border-hairline bg-surface-tint shadow-[0_8px_24px_rgba(0,0,0,0.1)]",
          !currentReady && "pointer-events-none",
        )}
        style={{
          transform: `translate(${drag.x}px, ${drag.y}px) rotate(${rotate}deg)`,
          transition: animating ? "transform 220ms ease-out" : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {!currentReady ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-tint">
            <div className="size-full animate-pulse bg-gradient-to-br from-surface-tint via-white to-surface-tint" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
              <div className="size-8 animate-spin rounded-full border-2 border-brand/20 border-t-brand" />
              <p className="text-xs font-medium text-ink-muted">Loading photo…</p>
            </div>
          </div>
        ) : null}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={card.id}
          src={card.imageUrl}
          alt={card.title}
          onLoad={() => markReady(card.imageUrl)}
          className={cn(
            "h-full w-full object-cover object-center transition-opacity duration-300",
            currentReady ? "opacity-100" : "opacity-0",
          )}
          draggable={false}
        />

        {currentReady ? (
          <>
            <span
              className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-red-600/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm"
              style={{ opacity: dislikeOpacity }}
            >
              Nope
            </span>
            <span
              className="pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm"
              style={{ opacity: likeOpacity }}
            >
              Like
            </span>
          </>
        ) : null}
      </div>
    </div>
  );

  if (compact) {
    return (
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 shrink-0">
          <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
            <span>
              {card.categoryLabel} · {index + 1} of {deck.length}
            </span>
            <span className="hidden sm:inline">Tap a button or drag the card</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-tint">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center gap-8 lg:gap-12">
          {swipeCard}

          <div className="flex w-[min(100%,240px)] shrink-0 flex-col gap-4 sm:w-[220px]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">
                {card.categoryLabel}
              </p>
              <h3 className="mt-1 line-clamp-2 text-base font-semibold leading-snug text-ink sm:text-lg">
                {card.title}
              </h3>
              <p className="mt-0.5 text-sm text-ink-secondary">{card.subtitle}</p>
            </div>
            {actionButtons}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
          <span>
            {card.categoryLabel} · {index + 1} of {deck.length}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-surface-tint">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="relative mx-auto">{swipeCard}</div>
      <div className="flex justify-center">{actionButtons}</div>

      {onBack ? (
        <div className="flex justify-between text-sm">
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="font-medium text-ink-secondary hover:text-ink disabled:opacity-50"
          >
            ← Go back
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="font-medium text-ink-muted hover:text-ink disabled:opacity-50"
          >
            Skip for now
          </button>
        </div>
      ) : null}
    </section>
  );
}
