import type {
  BodyShapeBand,
  BustFullnessBand,
  MuscularityBand,
} from "@/lib/tryon/types";
import type { BuildKey, SilhouetteForm } from "./types";

export type LegLineVisual = "long_torso" | "even" | "long_leg";

export type BodyGeometry = {
  shoulder: number;
  chest: number;
  waist: number;
  belly: number;
  hip: number;
  armWidth: number;
  thighWidth: number;
  torsoBottomY: number;
};

export type BodySilhouetteInput = {
  form: SilhouetteForm;
  build: BuildKey | null;
  muscularity: MuscularityBand | null;
  bodyShape: BodyShapeBand | null;
  bustFullness: BustFullnessBand | null;
  legLine: LegLineVisual | null;
  heightCm: number | null;
};

type WidthKey = Exclude<keyof BodyGeometry, "torsoBottomY">;

const CX = 90;
const HEAD_CY = 34;
const HEAD_R = 29;
const FOOT_Y = 312;
const ARM_Y0 = 91;
const ARM_Y1 = 184;
const MAX_HALF = 72;
const MIN_HALF = 10;
const MIN_LIMB = 12;
const MAX_LIMB = 48;

export const SILHOUETTE_MORPH_MS = 280;

export const MASCULINE_AVERAGE: BodyGeometry = {
  shoulder: 38,
  chest: 36,
  waist: 30,
  belly: 31,
  hip: 29,
  armWidth: 20,
  thighWidth: 24,
  torsoBottomY: 210,
};

export const FEMININE_AVERAGE: BodyGeometry = {
  shoulder: 32,
  chest: 38,
  waist: 24,
  belly: 27,
  hip: 42,
  armWidth: 19,
  thighWidth: 24,
  torsoBottomY: 220,
};

const BUILD_MOD: Record<BuildKey, Partial<Record<WidthKey, number>>> = {
  slim: {
    shoulder: 0.84,
    chest: 0.82,
    waist: 0.78,
    belly: 0.8,
    hip: 0.82,
    armWidth: 0.82,
    thighWidth: 0.82,
  },
  average: {
    shoulder: 1,
    chest: 1,
    waist: 1,
    belly: 1,
    hip: 1,
    armWidth: 1,
    thighWidth: 1,
  },
  athletic: {
    shoulder: 1.16,
    chest: 1.12,
    waist: 0.9,
    belly: 0.92,
    hip: 1,
    armWidth: 1.15,
    thighWidth: 1.12,
  },
  broad: {
    shoulder: 1.2,
    chest: 1.18,
    waist: 1.13,
    belly: 1.12,
    hip: 1.12,
    armWidth: 1.16,
    thighWidth: 1.16,
  },
  plus: {
    shoulder: 1.18,
    chest: 1.28,
    waist: 1.45,
    belly: 1.55,
    hip: 1.38,
    armWidth: 1.32,
    thighWidth: 1.34,
  },
};

const SHAPE_MOD: Record<BodyShapeBand, Partial<Record<WidthKey, number>>> = {
  rectangle: { shoulder: 1, chest: 1, waist: 1.12, belly: 1.05, hip: 0.95 },
  triangle: { shoulder: 0.92, chest: 0.96, waist: 0.98, belly: 1.02, hip: 1.18 },
  inverted_triangle: {
    shoulder: 1.18,
    chest: 1.1,
    waist: 0.96,
    belly: 0.96,
    hip: 0.88,
  },
  hourglass: { shoulder: 1.06, chest: 1.08, waist: 0.82, belly: 0.92, hip: 1.12 },
  oval: { shoulder: 0.96, chest: 1.02, waist: 1.2, belly: 1.3, hip: 1.03 },
};

const DEF_MOD: Record<MuscularityBand, Partial<Record<WidthKey, number>>> = {
  low: { shoulder: 0.98, chest: 0.99, waist: 1.04, armWidth: 0.96, thighWidth: 0.98 },
  moderate: { shoulder: 1, chest: 1, waist: 1, armWidth: 1, thighWidth: 1 },
  high: { shoulder: 1.05, chest: 1.04, waist: 0.94, armWidth: 1.08, thighWidth: 1.06 },
};

const BUST_MOD: Record<BustFullnessBand, number> = {
  subtle: 0.9,
  average: 1,
  full: 1.12,
  very_full: 1.24,
};

const LEG_OFFSET: Record<LegLineVisual, number> = {
  long_torso: 14,
  even: 0,
  long_leg: -14,
};

const WIDTH_KEYS: WidthKey[] = [
  "shoulder",
  "chest",
  "waist",
  "belly",
  "hip",
  "armWidth",
  "thighWidth",
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function mixGeometry(a: BodyGeometry, b: BodyGeometry, t: number): BodyGeometry {
  const out = { ...a };
  for (const k of WIDTH_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  out.torsoBottomY = a.torsoBottomY + (b.torsoBottomY - a.torsoBottomY) * t;
  return out;
}

function scaleWidths(
  g: BodyGeometry,
  mods: Partial<Record<WidthKey, number>> | undefined,
): BodyGeometry {
  if (!mods) return g;
  const out = { ...g };
  for (const k of WIDTH_KEYS) {
    const m = mods[k];
    if (m != null) out[k] *= m;
  }
  return out;
}

function baselineForForm(form: SilhouetteForm): BodyGeometry {
  if (form === "f") return { ...FEMININE_AVERAGE };
  if (form === "m") return { ...MASCULINE_AVERAGE };
  return mixGeometry(MASCULINE_AVERAGE, FEMININE_AVERAGE, 0.5);
}

/** Visual default only — never write this into form state. */
export function resolveVisualDefinition(
  build: BuildKey | null | undefined,
  selected: MuscularityBand | null,
): MuscularityBand {
  if (selected) return selected;
  if (build === "athletic") return "high";
  if (build === "slim") return "low";
  return "moderate";
}

export function heightScale(heightCm: number | null): number {
  const cm = heightCm ?? 170;
  return clamp(1 + (cm - 170) / 500, 0.95, 1.05);
}

export function computeBodyGeometry(input: BodySilhouetteInput): BodyGeometry {
  let g = baselineForForm(input.form);
  g = scaleWidths(g, BUILD_MOD[input.build ?? "average"]);
  if (input.bodyShape) g = scaleWidths(g, SHAPE_MOD[input.bodyShape]);
  g = scaleWidths(g, DEF_MOD[resolveVisualDefinition(input.build, input.muscularity)]);
  if (input.form === "f") {
    g.chest *= BUST_MOD[input.bustFullness ?? "average"];
  }
  g.torsoBottomY += LEG_OFFSET[input.legLine ?? "even"];
  g.torsoBottomY = clamp(g.torsoBottomY, 188, 242);

  for (const k of WIDTH_KEYS) {
    const lim = k === "armWidth" || k === "thighWidth" ? MAX_LIMB : MAX_HALF;
    const lo = k === "armWidth" || k === "thighWidth" ? MIN_LIMB : MIN_HALF;
    g[k] = round(clamp(g[k], lo, lim));
  }
  g.torsoBottomY = round(g.torsoBottomY);
  return g;
}

function R(w: number) {
  return round(CX + w);
}
function L(w: number) {
  return round(CX - w);
}

/** Identical command structure for every variant so `d` can ease. */
export function buildTorsoPath(g: BodyGeometry): string {
  const top = 70;
  const shY = 88;
  const chY = 118;
  const waY = 148;
  const beY = 176;
  const bot = g.torsoBottomY;
  return [
    `M ${CX} ${top}`,
    `C ${R(g.shoulder * 0.35)} ${top} ${R(g.shoulder)} ${shY - 10} ${R(g.shoulder)} ${shY}`,
    `C ${R(g.shoulder)} ${shY + 16} ${R(g.chest)} ${chY - 12} ${R(g.chest)} ${chY}`,
    `C ${R(g.chest)} ${chY + 14} ${R(g.waist)} ${waY - 10} ${R(g.waist)} ${waY}`,
    `C ${R(g.waist)} ${waY + 12} ${R(g.belly)} ${beY - 8} ${R(g.belly)} ${beY}`,
    `C ${R(g.belly)} ${beY + 14} ${R(g.hip)} ${bot - 8} ${R(g.hip * 0.92)} ${bot}`,
    `C ${R(g.hip * 0.4)} ${bot + 4} ${L(g.hip * 0.4)} ${bot + 4} ${L(g.hip * 0.92)} ${bot}`,
    `C ${L(g.hip)} ${bot - 8} ${L(g.belly)} ${beY + 14} ${L(g.belly)} ${beY}`,
    `C ${L(g.belly)} ${beY - 8} ${L(g.waist)} ${waY + 12} ${L(g.waist)} ${waY}`,
    `C ${L(g.waist)} ${waY - 10} ${L(g.chest)} ${chY + 14} ${L(g.chest)} ${chY}`,
    `C ${L(g.chest)} ${chY - 12} ${L(g.shoulder)} ${shY + 16} ${L(g.shoulder)} ${shY}`,
    `C ${L(g.shoulder)} ${shY - 10} ${L(g.shoulder * 0.35)} ${top} ${CX} ${top}`,
    "Z",
  ].join(" ");
}

export function buildArmPath(side: -1 | 1, g: BodyGeometry): string {
  const x0 = round(CX + side * (g.shoulder - 2));
  const x1 = round(CX + side * (g.shoulder + 28));
  return `M ${x0} ${ARM_Y0} L ${x1} ${ARM_Y1}`;
}

export function buildLegPath(side: -1 | 1, g: BodyGeometry): string {
  const x = round(CX + side * Math.max(11, g.hip * 0.28));
  const y0 = round(g.torsoBottomY - 12);
  return `M ${x} ${y0} L ${x} ${FOOT_Y}`;
}

export function pathCommandSignature(d: string): string {
  return d.replace(/-?\d+(\.\d+)?/g, "#");
}

export function silhouetteMorphStyle(reducedMotion: boolean): {
  transition: string;
} {
  if (reducedMotion) return { transition: "none" };
  return {
    transition: `d ${SILHOUETTE_MORPH_MS}ms ease-out, stroke-width ${SILHOUETTE_MORPH_MS}ms ease-out, opacity ${SILHOUETTE_MORPH_MS}ms ease-out`,
  };
}

const BUILD_LABEL: Record<BuildKey, string> = {
  slim: "slim",
  average: "average",
  athletic: "athletic",
  broad: "broad",
  plus: "plus",
};
const DEF_LABEL: Record<MuscularityBand, string> = {
  low: "soft",
  moderate: "toned",
  high: "defined",
};
const SHAPE_LABEL: Record<BodyShapeBand, string> = {
  rectangle: "rectangle shape",
  triangle: "triangle shape",
  inverted_triangle: "inverted-triangle shape",
  hourglass: "hourglass shape",
  oval: "oval shape",
};
const BUST_LABEL: Record<BustFullnessBand, string> = {
  subtle: "subtle bust",
  average: "average bust",
  full: "full bust",
  very_full: "very full bust",
};
const LEG_LABEL: Record<LegLineVisual, string> = {
  long_torso: "long torso",
  even: "even split",
  long_leg: "long legs",
};

export function silhouetteLabel(input: BodySilhouetteInput): string {
  const who =
    input.form === "f" ? "Feminine" : input.form === "m" ? "Masculine" : "Androgynous";
  const bits = [who];
  if (input.build) bits.push(BUILD_LABEL[input.build]);
  bits.push("silhouette");
  const extras: string[] = [];
  if (input.muscularity) extras.push(DEF_LABEL[input.muscularity]);
  if (input.bodyShape) extras.push(SHAPE_LABEL[input.bodyShape]);
  if (input.form === "f" && input.bustFullness) extras.push(BUST_LABEL[input.bustFullness]);
  if (input.legLine && input.legLine !== "even") extras.push(LEG_LABEL[input.legLine]);
  if (!extras.length) return bits.join(" ");
  return `${bits.join(" ")}, ${extras.join(", ")}`;
}

export const SILHOUETTE_HEAD = { cx: CX, cy: HEAD_CY, r: HEAD_R } as const;
