"use client";

import { useEffect, useState } from "react";
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
    y: 13,
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
    y: 25.5,
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
    y: 45,
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
    y: 64,
    side: "right",
    phrases: [
      "hem is a proportion",
      "break and crop",
      "shoe vs pant line",
      "length that reads as you",
    ],
  },
];

const SHUFFLE_MS = 2400;
const STAGGER_MS = 520;

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
  const [indexes, setIndexes] = useState(() =>
    VERDICT_ANNO_REGIONS.map(() => 0),
  );

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const intervals: number[] = [];
    const starts = VERDICT_ANNO_REGIONS.map((_, i) =>
      window.setTimeout(() => {
        intervals.push(
          window.setInterval(() => {
            setIndexes((prev) => {
              const next = [...prev];
              const phrases = VERDICT_ANNO_REGIONS[i]!.phrases;
              next[i] = ((next[i] ?? 0) + 1) % phrases.length;
              return next;
            });
          }, SHUFFLE_MS),
        );
      }, 700 + i * STAGGER_MS),
    );
    return () => {
      for (const id of starts) window.clearTimeout(id);
      for (const id of intervals) window.clearInterval(id);
    };
  }, []);

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
        {VERDICT_ANNO_REGIONS.map((r, i) => {
          const endX = r.side === "left" ? 7 : 93;
          return (
            <g
              key={r.id}
              className="fitting-anno__lead"
              style={{ animationDelay: `${140 + i * 140}ms` }}
            >
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

      {VERDICT_ANNO_REGIONS.map((r, i) => {
        const phrase = r.phrases[indexes[i] ?? 0] ?? r.phrases[0]!;
        return (
          <div key={r.id}>
            <i
              className="fitting-anno__dot"
              style={{
                left: `${r.x}%`,
                top: `${r.y}%`,
                animationDelay: `${80 + i * 140}ms`,
              }}
            />
            <div
              className={cn(
                "fitting-anno__tag",
                r.side === "left"
                  ? "fitting-anno__tag--l"
                  : "fitting-anno__tag--r",
              )}
              style={{
                top: `${r.y}%`,
                animationDelay: `${220 + i * 140}ms`,
              }}
            >
              <b>{r.region}</b>
              <em key={`${r.id}-${indexes[i] ?? 0}`}>{phrase}</em>
            </div>
          </div>
        );
      })}
    </div>
  );
}
