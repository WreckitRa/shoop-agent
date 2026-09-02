"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/ai-chat/cn";
import type {
  BodyShapeBand,
  BustFullnessBand,
  MuscularityBand,
} from "@/lib/tryon/types";
import type { BuildKey, SilhouetteForm } from "./types";
import {
  buildArmPath,
  buildLegPath,
  buildTorsoPath,
  computeBodyGeometry,
  heightScale,
  silhouetteLabel,
  silhouetteMorphStyle,
  SILHOUETTE_HEAD,
  SILHOUETTE_VIEWBOX,
  type LegLineVisual,
} from "./bodySilhouetteGeometry";

/** CSS `d: path(...)` morphs in supporting browsers; the attribute is the fallback. */
function morphPathStyle(
  d: string,
  reduced: boolean,
  extra?: CSSProperties,
): CSSProperties {
  return {
    d: `path("${d}")`,
    ...silhouetteMorphStyle(reduced),
    ...extra,
  } as CSSProperties;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

type Props = {
  form: SilhouetteForm;
  build: BuildKey | null;
  muscularity: MuscularityBand | null;
  bodyShape: BodyShapeBand | null;
  bustFullness: BustFullnessBand | null;
  legLine: LegLineVisual | null;
  heightCm: number | null;
  /** SVG head; THE MIRROR passes false because the face circle is HTML. */
  showHead?: boolean;
  className?: string;
  decorative?: boolean;
};

export function BodyTwinSilhouette({
  form,
  build,
  muscularity,
  bodyShape,
  bustFullness,
  legLine,
  heightCm,
  showHead = true,
  className,
  decorative = false,
}: Props) {
  const reduced = usePrefersReducedMotion();
  const morph = silhouetteMorphStyle(reduced);
  const input = useMemo(
    () => ({
      form,
      build,
      muscularity,
      bodyShape,
      bustFullness,
      legLine,
      heightCm,
    }),
    [form, build, muscularity, bodyShape, bustFullness, legLine, heightCm],
  );
  const g = useMemo(() => computeBodyGeometry(input), [input]);
  const torso = buildTorsoPath(g);
  const leftArm = buildArmPath(-1, g);
  const rightArm = buildArmPath(1, g);
  const leftLeg = buildLegPath(-1, g);
  const rightLeg = buildLegPath(1, g);
  const scale = heightScale(heightCm);

  return (
    <svg
      viewBox={`0 0 ${SILHOUETTE_VIEWBOX.w} ${SILHOUETTE_VIEWBOX.h}`}
      preserveAspectRatio="xMidYMin meet"
      className={cn("fitting-motion overflow-visible", className)}
      style={{
        transformOrigin: "50% 0%",
        transform: showHead ? `scale(${scale})` : undefined,
        ...morph,
      }}
      fill="currentColor"
      stroke="currentColor"
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : silhouetteLabel(input)}
    >
      {showHead ? (
        <circle
          cx={SILHOUETTE_HEAD.cx}
          cy={SILHOUETTE_HEAD.cy}
          r={SILHOUETTE_HEAD.r}
          stroke="none"
        />
      ) : null}
      <path
        d={leftArm}
        fill="none"
        strokeWidth={g.armWidth}
        strokeLinecap="round"
        className="fitting-motion"
        style={morphPathStyle(leftArm, reduced, { strokeWidth: g.armWidth })}
      />
      <path
        d={rightArm}
        fill="none"
        strokeWidth={g.armWidth}
        strokeLinecap="round"
        className="fitting-motion"
        style={morphPathStyle(rightArm, reduced, { strokeWidth: g.armWidth })}
      />
      <path
        d={leftLeg}
        fill="none"
        strokeWidth={g.thighWidth}
        strokeLinecap="round"
        className="fitting-motion"
        style={morphPathStyle(leftLeg, reduced, { strokeWidth: g.thighWidth })}
      />
      <path
        d={rightLeg}
        fill="none"
        strokeWidth={g.thighWidth}
        strokeLinecap="round"
        className="fitting-motion"
        style={morphPathStyle(rightLeg, reduced, { strokeWidth: g.thighWidth })}
      />
      <path
        d={torso}
        stroke="none"
        className="fitting-motion"
        style={morphPathStyle(torso, reduced)}
      />
    </svg>
  );
}
