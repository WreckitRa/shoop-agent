"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import { OnboardingWhy } from "@/components/onboarding/onboarding-ui";

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
  cards: OutfitGridCard[];
  selectedIds: string[];
  maxPicks: number;
  loading?: boolean;
  onToggle: (card: OutfitGridCard) => void;
  why: string;
};

const FALLBACK_GRADIENTS = [
  "from-[#cfd6dd] to-[#5b6b78]",
  "from-[#d9ccc0] to-[#7a6a58]",
  "from-[#e0c9cf] to-[#8a5866]",
  "from-[#23232f] to-[#6d4750]",
  "from-[#ccd9cc] to-[#5f7860]",
  "from-[#d0d0dd] to-[#5c5c78]",
  "from-[#ddd3c2] to-[#8a7a58]",
  "from-[#c9d8d8] to-[#587a78]",
  "from-[#d8c9d6] to-[#785c74]",
];

const CARD_HEIGHT = "h-[320px]";
const CARD_BASIS = "flex-[0_0_calc((100%-1.5rem)/3)]";
const DRAG_THRESHOLD_PX = 8;

export function TasteOutfitGridStep({
  cards,
  selectedIds,
  maxPicks,
  loading,
  onToggle,
  why,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [maxHint, setMaxHint] = useState(false);
  const [trayPulse, setTrayPulse] = useState(false);

  const pickedCount = selectedIds.length;
  const atMax = pickedCount >= maxPicks;
  const selectedCards = selectedIds
    .map((id) => cards.find((c) => c.id === id))
    .filter((c): c is OutfitGridCard => Boolean(c));

  function updateScrollState() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [cards.length, loading]);

  useEffect(() => {
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, []);

  function scrollByPage(direction: -1 | 1) {
    const el = scrollRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-outfit-card]");
    const step = card ? card.offsetWidth + 12 : el.clientWidth * 0.34;
    el.scrollBy({ left: direction * step * 3, behavior: "smooth" });
  }

  function flashMaxHint() {
    setMaxHint(true);
    setTrayPulse(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => {
      setMaxHint(false);
      setTrayPulse(false);
    }, 1600);
  }

  function handleCardActivate(card: OutfitGridCard, selected: boolean) {
    if (didDrag.current) return;
    if (!selected && atMax) {
      flashMaxHint();
      return;
    }
    onToggle(card);
  }

  if (loading) {
    return (
      <div className="mt-3 space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-3.5 w-24 animate-pulse rounded bg-neutral-100" />
          <div className="flex gap-2">
            {Array.from({ length: maxPicks }).map((_, i) => (
              <div
                key={i}
                className="size-9 animate-pulse rounded-lg bg-neutral-100"
              />
            ))}
          </div>
        </div>
        <div className={cn("flex gap-3 overflow-hidden", CARD_HEIGHT)}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-full min-w-0 animate-pulse rounded-xl bg-neutral-100",
                CARD_BASIS,
              )}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="mt-3 space-y-4">
      {/* Selection tray — the real status UI */}
      <div
        className={cn(
          "flex items-center justify-between gap-4 rounded-xl px-1 transition-colors duration-300",
          trayPulse && "bg-[#FDF1F0]",
        )}
      >
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight text-ink">
            <span className="tabular-nums">{pickedCount}</span>
            <span className="font-medium text-ink-muted"> / {maxPicks}</span>
          </p>
          <p
            className={cn(
              "mt-0.5 text-[11px] transition-colors",
              maxHint ? "text-[#C43B35]" : "text-ink-muted",
            )}
            aria-live="polite"
          >
            {maxHint
              ? "Remove one below to swap"
              : pickedCount === 0
                ? "Choose looks that feel like you"
                : atMax
                  ? "Your set is full"
                  : "Keep going"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {Array.from({ length: maxPicks }).map((_, slot) => {
            const card = selectedCards[slot];
            if (!card) {
              return (
                <div
                  key={`empty-${slot}`}
                  className="size-10 rounded-lg border border-dashed border-neutral-300/90 bg-white/60"
                  aria-hidden
                />
              );
            }
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onToggle(card)}
                className="group relative size-10 overflow-hidden rounded-lg bg-neutral-100 shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06] transition hover:ring-ink/20"
                aria-label={`Remove ${card.label}`}
              >
                {card.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.imageUrl}
                    alt=""
                    className="size-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div
                    className={cn(
                      "size-full bg-gradient-to-br",
                      FALLBACK_GRADIENTS[slot % FALLBACK_GRADIENTS.length],
                    )}
                  />
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-ink/0 transition group-hover:bg-ink/45">
                  <X
                    className="size-3.5 text-white opacity-0 transition group-hover:opacity-100"
                    strokeWidth={2.25}
                    aria-hidden
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Carousel */}
      <div className="relative">
        {canScrollLeft ? (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 z-[5] w-8 bg-gradient-to-r from-white to-transparent"
            />
            <button
              type="button"
              onClick={() => scrollByPage(-1)}
              className="absolute left-1 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-[0_2px_12px_rgba(0,0,0,0.1)] ring-1 ring-black/[0.06] backdrop-blur-sm transition hover:bg-white"
              aria-label="Previous looks"
            >
              <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          </>
        ) : null}
        {canScrollRight ? (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 z-[5] w-8 bg-gradient-to-l from-white to-transparent"
            />
            <button
              type="button"
              onClick={() => scrollByPage(1)}
              className="absolute right-1 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow-[0_2px_12px_rgba(0,0,0,0.1)] ring-1 ring-black/[0.06] backdrop-blur-sm transition hover:bg-white"
              aria-label="More looks"
            >
              <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          </>
        ) : null}

        <div
          ref={scrollRef}
          className={cn(
            "flex gap-3 overflow-x-auto overscroll-x-contain py-0.5",
            "snap-x snap-mandatory scroll-smooth",
            "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            CARD_HEIGHT,
          )}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Outfit looks"
        >
          {cards.map((card, index) => {
            const selected = selectedIds.includes(card.id);

            return (
              <button
                key={card.id}
                type="button"
                role="option"
                aria-selected={selected}
                data-outfit-card
                onPointerDown={(e) => {
                  pointerStart.current = { x: e.clientX, y: e.clientY };
                  didDrag.current = false;
                }}
                onPointerMove={(e) => {
                  if (!pointerStart.current || didDrag.current) return;
                  const dx = Math.abs(e.clientX - pointerStart.current.x);
                  const dy = Math.abs(e.clientY - pointerStart.current.y);
                  if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) {
                    didDrag.current = true;
                  }
                }}
                onPointerCancel={() => {
                  pointerStart.current = null;
                  didDrag.current = false;
                }}
                onClick={() => {
                  if (didDrag.current) {
                    didDrag.current = false;
                    pointerStart.current = null;
                    return;
                  }
                  handleCardActivate(card, selected);
                  pointerStart.current = null;
                }}
                className={cn(
                  "group relative h-full min-w-0 snap-start overflow-hidden rounded-xl text-left",
                  "bg-neutral-100 transition-[transform,opacity] duration-300 ease-out",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2",
                  "active:scale-[0.99]",
                  CARD_BASIS,
                  selected
                    ? "opacity-100"
                    : atMax
                      ? "opacity-45"
                      : "opacity-100 hover:opacity-95",
                )}
              >
                {card.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.imageUrl}
                    alt=""
                    className={cn(
                      "absolute inset-0 size-full object-cover transition-transform duration-500 ease-out",
                      "group-hover:scale-[1.03]",
                      selected && "scale-[1.02]",
                    )}
                    draggable={false}
                  />
                ) : (
                  <div
                    className={cn(
                      "absolute inset-0 bg-gradient-to-br",
                      FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length],
                    )}
                  />
                )}

                <span
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
                  aria-hidden
                />

                {/* Quiet selection mark — no border frame */}
                <span
                  className={cn(
                    "absolute right-2.5 top-2.5 flex size-6 items-center justify-center rounded-full transition-all duration-300",
                    selected
                      ? "bg-white text-ink shadow-[0_2px_8px_rgba(0,0,0,0.18)]"
                      : "bg-white/0 text-transparent ring-1 ring-white/0 group-hover:bg-white/20 group-hover:ring-white/50",
                  )}
                  aria-hidden
                >
                  <Check
                    className={cn(
                      "size-3.5 transition-opacity duration-200",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                    strokeWidth={2.5}
                  />
                </span>

                <span className="absolute inset-x-0 bottom-0 px-3 pb-3">
                  <span className="block text-[12px] font-semibold leading-snug text-white">
                    {card.label}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {pickedCount} of {maxPicks} looks selected
      </p>

      <OnboardingWhy>{why}</OnboardingWhy>
    </section>
  );
}
