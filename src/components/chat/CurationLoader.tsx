"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "@/components/chat/chat-store";
import { BuildSilhouette } from "@/components/tryon/avatar-silhouettes";
import { cn } from "@/lib/ai-chat/cn";
import {
  CATALOG_IMAGE_PX,
  catalogDisplayImageUrl,
} from "@/lib/shopify/catalog-display-image";

type Phase = "read" | "scout" | "refine" | "curate";

const PHASES: ReadonlyArray<{ id: Phase; label: string }> = [
  { id: "read", label: "Read" },
  { id: "scout", label: "Search" },
  { id: "refine", label: "Check" },
  { id: "curate", label: "Style" },
];

const PHASE_INDEX: Record<Phase, number> = {
  read: 0,
  scout: 1,
  refine: 2,
  curate: 3,
};

const PHASE_HEADLINE: Record<Phase, string> = {
  read: "Getting your ask straight",
  scout: "Searching the stores",
  refine: "Narrowing the rack",
  curate: "Styling what lands on you",
};

/** Map an engine narration line to the funnel phase it belongs to. */
function phaseFromLine(line: string): Phase {
  const l = line.toLowerCase();
  if (/curat|styl|hanging verified|put on you|finalist|finish styl/.test(l)) {
    return "curate";
  }
  if (
    /check|stock|size|cut|match the brief|budget|room|filter|miss|drop|widen|verif|availab|refin/.test(
      l,
    )
  ) {
    return "refine";
  }
  if (
    /search|pulling|stores|angle|scanning|looking through|scout/.test(l)
  ) {
    return "scout";
  }
  if (/read|plan|ask|mapping/.test(l)) return "read";
  return "scout";
}

const RACK_CARD_MAX = 5;
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
 * Fashion search progress — Mirror-adjacent card while find → check → style runs.
 * Never shows empty hangers: scout pulse until real thumbs arrive, then only
 * as many cards as we have images.
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
    if (droppedImages.length > 0) {
      max = Math.max(max, PHASE_INDEX.refine);
    }
    if (productImages.length > 0) {
      max = Math.max(max, PHASE_INDEX.scout);
    }
    reachedIndexRef.current = max;
    return max;
  }, [narration, droppedImages.length, productImages.length]);

  if (!pipelineActive && !hasSearch && narration.length === 0) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
        <span className="size-2 animate-pulse rounded-full bg-ink-muted motion-reduce:animate-none" />
        Working on it…
      </span>
    );
  }

  const phase = PHASES[phaseIndex]?.id ?? "scout";
  const headline = PHASE_HEADLINE[phase];
  const showDrops = phaseIndex >= PHASE_INDEX.refine && droppedImages.length > 0;
  const hasThumbs = productImages.length > 0;

  return (
    <div className="tp-shoop-reply-enter w-full max-w-[28rem] select-none">
      <aside
        className={cn(
          "flex flex-col rounded-[18px] border border-hairline",
          "bg-gradient-to-b from-[#FCFCFD] to-[#F5F5F7] px-[18px] py-4",
        )}
        aria-live="polite"
        aria-busy="true"
      >
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <span className="font-display text-[9.5px] font-extrabold tracking-[0.22em] text-ink">
            FIND
          </span>
          <span className="text-[9px] font-semibold text-ink-muted">
            in progress
          </span>
        </div>

        <h2 className="font-display text-[15px] font-extrabold tracking-tight text-ink">
          {headline}
        </h2>

        <NarrationLine line={latest} className="mt-1.5" />

        <div className="mt-3.5">
          <FunnelRail phaseIndex={phaseIndex} />
        </div>

        <div className={cn("mt-4", showDrops && "min-h-[8.5rem]")}>
          {hasThumbs ? (
            <Rack
              images={productImages}
              droppedImages={showDrops ? droppedImages : []}
            />
          ) : (
            <ScoutPulse phase={phase} />
          )}
        </div>
      </aside>
    </div>
  );
});

function FunnelRail({ phaseIndex }: { phaseIndex: number }) {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {PHASES.map((phase, i) => {
        const active = i === phaseIndex;
        const done = i < phaseIndex;
        return (
          <div key={phase.id} className="flex flex-1 items-center gap-1">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors duration-500",
                active && "text-ink",
                done && "text-ink-muted",
                !active && !done && "text-ink-muted/40",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full transition-all duration-500",
                  active &&
                    "scale-125 bg-brand shadow-[0_0_0_3px_rgba(227,16,15,0.14)] motion-safe:animate-pulse",
                  done && "bg-ink-muted",
                  !active && !done && "bg-ink-muted/25",
                )}
              />
              {phase.label}
            </span>
            {i < PHASES.length - 1 ? (
              <span className="relative h-px flex-1 overflow-hidden rounded-full bg-hairline-soft">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full bg-ink-muted/55 transition-[width] duration-700 ease-out",
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

/** Calm pre-image state — no empty hangers. */
function ScoutPulse({ phase }: { phase: Phase }) {
  const hint =
    phase === "read"
      ? "Lining up the search…"
      : phase === "curate"
        ? "Almost ready…"
        : "Pieces will hang here as they land…";

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-hairline bg-white px-6 py-8 text-center">
      <span className="opacity-55 motion-safe:animate-pulse" aria-hidden>
        <BuildSilhouette width={14} />
      </span>
      <span className="text-[11px] font-medium text-ink-muted">{hint}</span>
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
  const cardCount = Math.min(RACK_CARD_MAX, Math.max(1, images.length));

  return (
    <div className="shoop-rack" aria-hidden>
      <div className="shoop-rack__bar" />
      <div className="shoop-rack__cards">
        {Array.from({ length: cardCount }).map((_, i) => (
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

  useEffect(() => {
    if (pool.length === 0) {
      setFront(undefined);
      setBack(undefined);
      return;
    }
    if (!frontRef.current || !pool.includes(frontRef.current)) {
      const next = pool[index % pool.length];
      setFront(next);
      setBack(pool.length > 1 ? pool[(index + 1) % pool.length] : next);
    }
  }, [pool, index]);

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

  // Only mount hangers when we have a real image — never shimmer empties.
  if (!front) return null;

  return (
    <div
      className="shoop-rack__hanger"
      style={{ "--rack-delay": `${index * -0.55}s` } as React.CSSProperties}
    >
      <span className="shoop-rack__hook" />
      <div className="shoop-rack__flip">
        <div className="shoop-rack__face shoop-rack__face--front">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayUrl(front)}
            alt=""
            className="shoop-rack__img"
            loading="lazy"
          />
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
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrl(front)}
              alt=""
              className="shoop-rack__img"
              loading="lazy"
            />
          )}
        </div>
      </div>
    </div>
  );
}

type DropSlot = {
  key: number;
  url: string;
  phase: "hang" | "fall";
};

function DropHangars({ images }: { images: string[] }) {
  const [slots, setSlots] = useState<DropSlot[]>([]);
  const shownRef = useRef(new Set<string>());
  const queueRef = useRef<string[]>([]);
  const keyRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const activeCountRef = useRef(0);

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

  useEffect(() => {
    for (const url of images) {
      if (shownRef.current.has(url)) continue;
      shownRef.current.add(url);
      queueRef.current.push(url);
    }
  }, [images]);

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
              "--rack-delay": `${(RACK_CARD_MAX + i) * -0.35}s`,
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

function NarrationLine({
  line,
  className,
}: {
  line: string;
  className?: string;
}) {
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
    <p
      className={cn(
        "min-w-0 text-[12px] font-medium leading-snug text-ink-muted transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      {display || "Warming up…"}
    </p>
  );
}
