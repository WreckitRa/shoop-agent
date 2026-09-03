"use client";

import { Fragment, useEffect, useState } from "react";
import { cn } from "@/lib/ai-chat/cn";

export type VerdictAnnoRegion = {
  id: "face" | "shoulders" | "body" | "legs";
  region: string;
  /** Landmark on a standing twin, object-cover / object-top. */
  x: number;
  y: number;
  side: "left" | "right";
  phrases: readonly string[];
};

/** Why we read each zone — short enough for the twin card. */
export const VERDICT_ANNO_REGIONS: readonly VerdictAnnoRegion[] = [
  {
    id: "face",
    region: "Face",
    x: 51,
    y: 12,
    side: "left",
    phrases: [
      "undertone lives here",
      "contrast sets the palette",
      "neckline has to work with this",
      "colour is judged against skin",
    ],
  },
  {
    id: "shoulders",
    region: "Shoulders",
    x: 67,
    y: 24,
    side: "right",
    phrases: [
      "everything hangs from here",
      "structure vs drape",
      "strap vs sleeve starts here",
      "the line clothes hang from",
    ],
  },
  {
    id: "body",
    region: "Body",
    x: 46,
    y: 46,
    side: "left",
    phrases: [
      "waist is a proportion",
      "rise and drape do the work",
      "cling vs structure",
      "where volume can sit",
    ],
  },
  {
    id: "legs",
    region: "Legs",
    x: 54,
    y: 86,
    side: "right",
    phrases: [
      "hem is a proportion",
      "break and crop",
      "shoe vs pant line",
      "length that reads as you",
    ],
  },
];

const REVEAL_MS = 2000;
const SHUFFLE_MS = 2400;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function FittingVerdictAnnotations({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [revealed, setRevealed] = useState(1);
  const [phraseTick, setPhraseTick] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setRevealed(VERDICT_ANNO_REGIONS.length);
      return;
    }
    const step = window.setInterval(() => {
      setRevealed((n) => Math.min(n + 1, VERDICT_ANNO_REGIONS.length));
    }, REVEAL_MS);
    return () => window.clearInterval(step);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (revealed < VERDICT_ANNO_REGIONS.length) return;
    const shuffle = window.setInterval(() => {
      setPhraseTick((t) => t + 1);
    }, SHUFFLE_MS);
    return () => window.clearInterval(shuffle);
  }, [revealed]);

  const visible = VERDICT_ANNO_REGIONS.slice(0, revealed);

  return (
    <div
      className={cn("fitting-anno", compact && "fitting-anno--compact")}
      aria-hidden
    >
      <svg
        className="fitting-anno__svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {visible.map((r) => {
          const endX = r.side === "left" ? 7 : 93;
          return (
            <g key={r.id} className="fitting-anno__lead">
              <path
                d={`M ${r.x} ${r.y} L ${endX} ${r.y}`}
                pathLength={1}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.15}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={endX}
                y1={r.y - 1.6}
                x2={endX}
                y2={r.y + 1.6}
                stroke="currentColor"
                strokeWidth={1.15}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </svg>

      {visible.map((r) => {
        const line =
          r.phrases[phraseTick % r.phrases.length] ?? r.phrases[0]!;
        return (
          <Fragment key={r.id}>
            <i
              className="fitting-anno__dot"
              style={{ left: `${r.x}%`, top: `${r.y}%` }}
            />
            <div
              className={cn(
                "fitting-anno__tag",
                r.side === "left"
                  ? "fitting-anno__tag--l"
                  : "fitting-anno__tag--r",
                r.id === "legs" && "fitting-anno__tag--legs",
              )}
              style={{ top: `${r.y}%` }}
            >
              <b>{r.region}</b>
              <em key={`${r.id}-${phraseTick}`}>{line}</em>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
