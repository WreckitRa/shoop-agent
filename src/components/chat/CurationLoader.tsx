"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "@/components/chat/chat-store";
import { cn } from "@/lib/ai-chat/cn";

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
  if (/rank|verif|stock|in stock|refin|quality|fit|ready to buy/.test(l)) {
    return "refine";
  }
  return "scout";
}

const RACK_CARD_COUNT = 5;

/**
 * Fashion-forward loading experience shown while the search → funnel → curation
 * pipeline runs. Subscribes to `streamingNarration` in isolation so it never
 * re-renders sibling message bubbles. Renders a rack of gently flipping garment
 * cards (with real thumbnails woven in as they stream), a three-step funnel
 * rail, and the latest engine narration line.
 */
export const CurationLoader = memo(function CurationLoader({
  hasSearch,
  productImages,
}: {
  hasSearch: boolean;
  productImages: string[];
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
    reachedIndexRef.current = max;
    return max;
  }, [narration]);

  // No pipeline signal at all → fall back to a quiet generating indicator.
  if (!hasSearch && narration.length === 0) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
        <span className="size-2 animate-pulse rounded-full bg-ink-muted motion-reduce:animate-none" />
        Generating…
      </span>
    );
  }

  const foundCount = productImages.length;

  return (
    <div className="tp-shoop-reply-enter w-full max-w-[22rem] select-none">
      <div className="rounded-[20px] border border-hairline-soft bg-surface/70 px-4 pb-3.5 pt-4 shadow-[0_2px_12px_rgba(12,12,12,0.04)] backdrop-blur-sm">
        <FunnelRail phaseIndex={phaseIndex} />

        <Rack images={productImages} />

        <div className="mt-3 flex min-h-[1.1rem] items-center justify-between gap-3">
          <NarrationLine line={latest} />
          {foundCount > 0 ? (
            <span className="shrink-0 text-[11px] font-medium tabular-nums text-ink-muted">
              {foundCount} found
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

function Rack({ images }: { images: string[] }) {
  return (
    <div className="shoop-rack mt-4" aria-hidden>
      <div className="shoop-rack__bar" />
      <div className="shoop-rack__cards">
        {Array.from({ length: RACK_CARD_COUNT }).map((_, i) => (
          <RackCard key={i} index={i} image={images[i]} />
        ))}
      </div>
    </div>
  );
}

function RackCard({ index, image }: { index: number; image?: string }) {
  return (
    <div
      className="shoop-rack__hanger"
      style={{ "--rack-delay": `${index * -0.55}s` } as React.CSSProperties}
    >
      <span className="shoop-rack__hook" />
      <div className="shoop-rack__flip">
        <div className="shoop-rack__face shoop-rack__face--front">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="shoop-rack__img" loading="lazy" />
          ) : (
            <span className="shoop-rack__shimmer" />
          )}
        </div>
        <div className="shoop-rack__face shoop-rack__face--back" />
      </div>
    </div>
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
