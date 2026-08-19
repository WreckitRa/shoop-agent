export type Lab = { L: number; a: number; b: number };

export type Measure<T> = {
  value: T | "unknown";
  confidence: number;
};

export type Undertone = "olive" | "warm" | "cool" | "neutral";
export type ContrastBand = "high" | "medium" | "low";
export type DepthBand =
  | "very light"
  | "light"
  | "intermediate"
  | "tan"
  | "brown"
  | "deep";

export type ImagePixels = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type WhiteBalance = {
  gainR: number;
  gainB: number;
  cast: number;
  risk: boolean;
  neutralCount: number;
};

export type PhotoQuality = {
  shortEdge: number;
  facePresent: boolean;
  singleSubject: boolean;
  whiteBalanceRisk: boolean;
  fullLength: boolean;
  warnings: string[];
};

export type ColourMeasures = {
  skin: Measure<Lab>;
  hair: Measure<Lab>;
  iris: Measure<Lab>;
  ita: Measure<number>;
  hue: Measure<number>;
  chroma: Measure<number>;
  abRatio: Measure<number>;
  depth: Measure<DepthBand>;
  undertone: Measure<Undertone>;
  contrast: Measure<ContrastBand>;
  contrastValue: Measure<number>;
  whiteBalance: WhiteBalance;
};

export type FaceMeasures = {
  faceLW: Measure<number>;
  jawCheek: Measure<number>;
  foreheadCheek: Measure<number>;
  chinCheek: Measure<number>;
  neckLength: Measure<number>;
  /** Display trait only. No styling rule may read this. */
  shape: Measure<string>;
};

export type BodyMeasures = {
  available: boolean;
  unavailableReason?: string;
  shoulderOverHip: Measure<number>;
  waistOverHip: Measure<number>;
  waistDepth: Measure<number>;
  waistPct: Measure<number>;
  massCentroid: Measure<number>;
  torsoOverLeg: Measure<number>;
  legPctHeight: Measure<number>;
  calfPct: Measure<number>;
  taperBelowHip: Measure<number>;
  shoulderSlope: Measure<number>;
  headsTall: Measure<number>;
};

export type PhotoProfile = {
  source: "spec" | "gpt";
  engine: string;
  colour: ColourMeasures;
  face: FaceMeasures;
  body: BodyMeasures;
  quality: PhotoQuality;
  /** GPT lighting diagnosis / spec warnings. Never consumed by search. */
  notes: string[];
};

export type PhotoAnalysisPublic = {
  id: string;
  status: string;
  specStatus: string;
  gptStatus: string;
  specResult: PhotoProfile | null;
  gptResult: PhotoProfile | null;
  specError: string | null;
  gptError: string | null;
  specMs: number | null;
  gptMs: number | null;
  gptModel: string | null;
  engineVersion: string;
  createdAt: string;
};

export const PHOTO_ANALYSIS_ENGINE_VERSION = "five-looks-a3-v1";

export function unknownMeasure<T>(): Measure<T> {
  return { value: "unknown", confidence: 0 };
}

export function knownMeasure<T>(value: T, confidence: number): Measure<T> {
  return { value, confidence: Math.max(0, Math.min(1, confidence)) };
}

export function emptyFace(): FaceMeasures {
  return {
    faceLW: unknownMeasure(),
    jawCheek: unknownMeasure(),
    foreheadCheek: unknownMeasure(),
    chinCheek: unknownMeasure(),
    neckLength: unknownMeasure(),
    shape: unknownMeasure(),
  };
}

export function emptyBody(reason?: string): BodyMeasures {
  return {
    available: false,
    unavailableReason: reason,
    shoulderOverHip: unknownMeasure(),
    waistOverHip: unknownMeasure(),
    waistDepth: unknownMeasure(),
    waistPct: unknownMeasure(),
    massCentroid: unknownMeasure(),
    torsoOverLeg: unknownMeasure(),
    legPctHeight: unknownMeasure(),
    calfPct: unknownMeasure(),
    taperBelowHip: unknownMeasure(),
    shoulderSlope: unknownMeasure(),
    headsTall: unknownMeasure(),
  };
}
