"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "@/components/chat/chat-store";
import { cn } from "@/lib/ai-chat/cn";
import {
  CATALOG_IMAGE_PX,
  catalogDisplayImageUrl,
} from "@/lib/shopify/catalog-display-image";

type Phase = "scout" | "refine" | "curate";

const PHASES: ReadonlyArray<{ id: Phase; label: string }> = [
  { id: "scout", label: "Searching" },
  { id: "refine", label: "Refining" },
  { id: "curate", label: "Curating" },
];

const PHASE_INDEX: Record<Phase, number> = { scout: 0, refine: 1, curate: 2 };

/** Map an engine narration line to the funnel phase it belongs to. */
function phaseFromLine(line: string): Phase {
  const l = line.toLowerCase();
  if (/curat|pick|final|rack|styl|slot|hero/.test(l)) return "curate";
  if (
    /rank|verif|stock|in stock|refin|quality|fit|ready to buy|filter|miss|drop|widen|availab/.test(
      l,
    )
  ) {
    return "refine";
  }
  return "scout";
}

const RACK_CARD_COUNT = 5;
/** Concurrent hung drop slots beside the survivor rack. */
const DROP_SLOT_COUNT = 3;
/** Half of the CSS flip cycle — swap the front face while the back is showing. */
const RACK_SWAP_MS = 1650;
/** How long a dropped card hangs before falling off (ms). */
const DROP_HANG_MS = 900;
/** Fall animation duration — must match CSS `shoop-drop-fall`. */
const DROP_FALL_MS = 700;

function pickRandom(pool: string[], exclude?: string): string | undefined {
  if (pool.length === 0) return undefined;
  if (pool.length === 1) return pool[0];
  let next = pool[Math.floor(Math.random() * pool.length)]!;
  // Avoid repeating the same thumbnail on consecutive swaps when we can.
  if (exclude && pool.length > 1) {
    let guard = 0;
    while (next === exclude && guard < 6) {
      next = pool[Math.floor(Math.random() * pool.length)]!;
      guard += 1;
    }
  }
  return next;
}

function displayUrl(url: string): string {
  return catalogDisplayImageUrl(url, CATALOG_IMAGE_PX.thumb);
}

/**
 * Fashion-forward loading experience shown while the search → funnel → curation
 * pipeline runs. Subscribes to `streamingNarration` in isolation so it never
 * re-renders sibling message bubbles. Renders a rack of flipping garment cards
 * that cycle real product thumbnails as soon as queries return. During refine,
 * hard-dropped items hang on the same rail (red) and fall off once each.
 */
export const CurationLoader = memo(function CurationLoader({
  hasSearch,
  pipelineActive = false,
  productImages,
  droppedImages = [],
}: {
  hasSearch: boolean;
  /** Force the full rack UI (fashion pipeline) even before narration arrives. */
  pipelineActive?: boolean;
  productImages: string[];
  droppedImages?: string[];
}) {
  const narration = useChatStore((s) => s.streamingNarration);
  const latest = narration[narration.length - 1] ?? "";

  // Phase only ever advances forward, so the rail never flickers backwards.
  const reachedIndexRef = useRef(0);
  const phaseIndex = useMemo(() => {
    let max = reachedIndexRef.current;
    for (const line of narration) {
      max = Math.max(max, PHASE_INDEX[phaseFromLine(line)]);
    }
    // Drops arriving means refine has started even before the narration line lands.
    if (droppedImages.length > 0) {
      max = Math.max(max, PHASE_INDEX.refine);
    }
    reachedIndexRef.current = max;
    return max;
  }, [narration, droppedImages.length]);

  // No pipeline signal at all → fall back to a quiet generating indicator.
  if (!pipelineActive && !hasSearch && narration.length === 0) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
        <span className="size-2 animate-pulse rounded-full bg-ink-muted motion-reduce:animate-none" />
        Generating…
      </span>
    );
  }

  const foundCount = productImages.length;
  const showDrops = phaseIndex >= PHASE_INDEX.refine && droppedImages.length > 0;

  return (
    <div className="tp-shoop-reply-enter w-full max-w-[28rem] select-none">
      <div className="rounded-[20px] border border-hairline-soft bg-surface/70 px-4 pb-3.5 pt-4 shadow-[0_2px_12px_rgba(12,12,12,0.04)] backdrop-blur-sm">
        <FunnelRail phaseIndex={phaseIndex} />

        <div className={cn("mt-4", showDrops && "min-h-[8.5rem]")}>
          <Rack images={productImages} droppedImages={showDrops ? droppedImages : []} />
        </div>

        <div className="mt-3 flex min-h-[1.1rem] items-center justify-between gap-3">
          <NarrationLine line={latest} />
          {foundCount > 0 ? (
            <span className="shrink-0 text-[11px] font-medium tabular-nums text-ink-muted">
              {foundCount} found
              {droppedImages.length > 0
                ? ` · ${droppedImages.length} out`
                : ""}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
});

function FunnelRail({ phaseIndex }: { phaseIndex: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {PHASES.map((phase, i) => {
        const active = i === phaseIndex;
        const done = i < phaseIndex;
        return (
          <div key={phase.id} className="flex flex-1 items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors duration-500",
                active && "text-ink",
                done && "text-ink-muted",
                !active && !done && "text-ink-muted/45",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full transition-all duration-500",
                  active &&
                    "scale-125 bg-brand shadow-[0_0_0_3px_rgba(227,16,15,0.14)] motion-safe:animate-pulse",
                  done && "bg-ink-muted",
                  !active && !done && "bg-ink-muted/30",
                )}
              />
              {phase.label}
            </span>
            {i < PHASES.length - 1 ? (
              <span className="relative h-px flex-1 overflow-hidden rounded-full bg-hairline-soft">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full bg-ink-muted/60 transition-[width] duration-700 ease-out",
                    i < phaseIndex ? "w-full" : "w-0",
                  )}
                />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Rack({
  images,
  droppedImages,
}: {
  images: string[];
  droppedImages: string[];
}) {
  return (
    <div className="shoop-rack" aria-hidden>
      <div className="shoop-rack__bar" />
      <div className="shoop-rack__cards">
        {Array.from({ length: RACK_CARD_COUNT }).map((_, i) => (
          <RackCard key={`keep-${i}`} index={i} pool={images} />
        ))}
        {droppedImages.length > 0 ? (
          <>
            <span className="shoop-rack__divider" />
            <DropHangars images={droppedImages} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function RackCard({ index, pool }: { index: number; pool: string[] }) {
  const [front, setFront] = useState<string | undefined>(
    () => pool[index % Math.max(pool.length, 1)],
  );
  const [back, setBack] = useState<string | undefined>(() =>
    pool.length > 1 ? pool[(index + 1) % pool.length] : pool[0],
  );
  const frontRef = useRef(front);
  frontRef.current = front;

  // Seed immediately when the first thumbnails stream in.
  useEffect(() => {
    if (pool.length === 0) {
      setFront(undefined);
      setBack(undefined);
      return;
    }
    if (!frontRef.current || !pool.includes(frontRef.current)) {
      const next = pool[index % pool.length];
      setFront(next);
      setBack(
        pool.length > 1 ? pool[(index + 1) % pool.length] : next,
      );
    }
  }, [pool, index]);

  // Keep cycling different products for the life of the loader.
  useEffect(() => {
    if (pool.length < 2) return;
    const tick = () => {
      setFront((prev) => {
        const nextFront = pickRandom(pool, prev);
        setBack(pickRandom(pool, nextFront));
        return nextFront;
      });
    };
    const delay = RACK_SWAP_MS + index * 110;
    const t = setInterval(tick, delay);
    return () => clearInterval(t);
  }, [pool, index]);

  return (
    <div
      className="shoop-rack__hanger"
      style={{ "--rack-delay": `${index * -0.55}s` } as React.CSSProperties}
    >
      <span className="shoop-rack__hook" />
      <div className="shoop-rack__flip">
        <div className="shoop-rack__face shoop-rack__face--front">
          {front ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrl(front)}
              alt=""
              className="shoop-rack__img"
              loading="lazy"
            />
          ) : (
            <span className="shoop-rack__shimmer" />
          )}
        </div>
        <div className="shoop-rack__face shoop-rack__face--back">
          {back ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrl(back)}
              alt=""
              className="shoop-rack__img"
              loading="lazy"
            />
          ) : (
            <span className="shoop-rack__shimmer" />
          )}
        </div>
      </div>
    </div>
  );
}

type DropSlot = {
  key: number;
  url: string;
  /** hang = on the rail; fall = falling off once. */
  phase: "hang" | "fall";
};

/**
 * Hung drop cards beside the survivor rack — same hanger shape, red highlight,
 * each unique drop image shown once then falls off (no loop).
 */
function DropHangars({ images }: { images: string[] }) {
  const [slots, setSlots] = useState<DropSlot[]>([]);
  const shownRef = useRef(new Set<string>());
  const queueRef = useRef<string[]>([]);
  const keyRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const activeCountRef = useRef(0);

  const clearKeyTimers = (key: number) => {
    const t = timersRef.current.get(key);
    if (t) clearTimeout(t);
    timersRef.current.delete(key);
  };

  const startSlot = (url: string) => {
    const key = keyRef.current++;
    activeCountRef.current += 1;
    setSlots((prev) => [...prev, { key, url, phase: "hang" }]);

    const hangTimer = setTimeout(() => {
      setSlots((prev) =>
        prev.map((s) => (s.key === key ? { ...s, phase: "fall" } : s)),
      );
      const fallTimer = setTimeout(() => {
        setSlots((prev) => prev.filter((s) => s.key !== key));
        activeCountRef.current = Math.max(0, activeCountRef.current - 1);
        timersRef.current.delete(key);
      }, DROP_FALL_MS);
      timersRef.current.set(key, fallTimer);
    }, DROP_HANG_MS);
    timersRef.current.set(key, hangTimer);
  };

  // Enqueue newly arrived drop images (each URL at most once).
  useEffect(() => {
    for (const url of images) {
      if (shownRef.current.has(url)) continue;
      shownRef.current.add(url);
      queueRef.current.push(url);
    }
  }, [images]);

  // Fill free hangers from the queue — never reuses a shown URL.
  useEffect(() => {
    const id = setInterval(() => {
      while (
        activeCountRef.current < DROP_SLOT_COUNT &&
        queueRef.current.length > 0
      ) {
        const nextUrl = queueRef.current.shift();
        if (!nextUrl) break;
        startSlot(nextUrl);
      }
    }, 180);
    return () => clearInterval(id);
    // startSlot closes over refs; interval owns the pump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
    };
  }, []);

  return (
    <>
      {slots.map((slot, i) => (
        <div
          key={slot.key}
          className={cn(
            "shoop-rack__hanger shoop-rack__hanger--drop",
            slot.phase === "fall" && "shoop-rack__hanger--falling",
          )}
          style={
            {
              "--rack-delay": `${(RACK_CARD_COUNT + i) * -0.35}s`,
            } as React.CSSProperties
          }
        >
          <span className="shoop-rack__hook shoop-rack__hook--drop" />
          <div className="shoop-rack__face shoop-rack__face--drop">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayUrl(slot.url)}
              alt=""
              className="shoop-rack__img"
              loading="lazy"
            />
          </div>
        </div>
      ))}
    </>
  );
}

/** Cross-fades between narration lines so text swaps feel intentional. */
function NarrationLine({ line }: { line: string }) {
  const [display, setDisplay] = useState(line);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (line === display) return;
    setVisible(false);
    const t = setTimeout(() => {
      setDisplay(line);
      setVisible(true);
    }, 160);
    return () => clearTimeout(t);
  }, [line, display]);

  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-xs text-ink-soft transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
      )}
      aria-live="polite"
    >
      {display || "Warming up the rack…"}
    </span>
  );
}
