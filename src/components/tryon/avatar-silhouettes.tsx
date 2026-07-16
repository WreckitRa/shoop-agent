/** SVG silhouette figures for avatar intake pickers — visual language only, never cm. */

export function BuildSilhouette({ width }: { width: number }) {
  const torso = width;
  const head = 8;
  return (
    <svg viewBox="0 0 40 72" className="h-14 w-7 text-ink" aria-hidden>
      <ellipse cx="20" cy="10" rx={head} ry="9" fill="currentColor" opacity="0.22" />
      <rect
        x={20 - torso / 2}
        y="20"
        width={torso}
        height="24"
        rx="5"
        fill="currentColor"
        opacity="0.38"
      />
      <rect x="12" y="44" width="6" height="22" rx="2" fill="currentColor" opacity="0.28" />
      <rect x="22" y="44" width="6" height="22" rx="2" fill="currentColor" opacity="0.28" />
    </svg>
  );
}

type BodyShapeId =
  | "rectangle"
  | "triangle"
  | "inverted_triangle"
  | "hourglass"
  | "oval";

/** Shoulder / waist / hip ratios that read clearly at small sizes. */
const BODY_SHAPE_PATHS: Record<BodyShapeId, string> = {
  // Even shoulders → waist → hips
  rectangle:
    "M14,22 L26,22 L25.5,46 L14.5,46 Z",
  // Narrower shoulders, fuller hips
  triangle:
    "M16,22 L24,22 L28,46 L12,46 Z",
  // Broader shoulders, narrower hips
  inverted_triangle:
    "M12,22 L28,22 L24,46 L16,46 Z",
  // Defined waist
  hourglass:
    "M13,22 L27,22 L24,32 L27,46 L13,46 L16,32 Z",
  // Fuller midsection
  oval:
    "M15,22 L25,22 C28,30 28,38 25,46 L15,46 C12,38 12,30 15,22 Z",
};

export function BodyShapeSilhouette({ shape }: { shape: BodyShapeId }) {
  return (
    <svg viewBox="0 0 40 72" className="h-16 w-8 text-ink" aria-hidden>
      <ellipse cx="20" cy="10" rx="7.5" ry="8.5" fill="currentColor" opacity="0.2" />
      <path d={BODY_SHAPE_PATHS[shape]} fill="currentColor" opacity="0.4" />
      <rect x="14" y="46" width="5" height="20" rx="2" fill="currentColor" opacity="0.26" />
      <rect x="21" y="46" width="5" height="20" rx="2" fill="currentColor" opacity="0.26" />
    </svg>
  );
}

type BustId = "subtle" | "average" | "full" | "very_full";

const BUST_RX: Record<BustId, number> = {
  subtle: 3.2,
  average: 4.2,
  full: 5.4,
  very_full: 6.6,
};

export function BustFullnessSilhouette({ band }: { band: BustId }) {
  const rx = BUST_RX[band];
  return (
    <svg viewBox="0 0 40 72" className="h-16 w-8 text-ink" aria-hidden>
      <ellipse cx="20" cy="10" rx="7.5" ry="8.5" fill="currentColor" opacity="0.2" />
      {/* Torso */}
      <path
        d="M14,22 L26,22 L25,48 L15,48 Z"
        fill="currentColor"
        opacity="0.28"
      />
      {/* Bust volume — two soft ellipses */}
      <ellipse
        cx={20 - rx * 0.55}
        cy="30"
        rx={rx}
        ry={rx * 0.85}
        fill="currentColor"
        opacity="0.42"
      />
      <ellipse
        cx={20 + rx * 0.55}
        cy="30"
        rx={rx}
        ry={rx * 0.85}
        fill="currentColor"
        opacity="0.42"
      />
      <rect x="14" y="48" width="5" height="18" rx="2" fill="currentColor" opacity="0.24" />
      <rect x="21" y="48" width="5" height="18" rx="2" fill="currentColor" opacity="0.24" />
    </svg>
  );
}
