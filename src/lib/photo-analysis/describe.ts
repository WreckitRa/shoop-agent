import type {
  BodyMeasures,
  ColourMeasures,
  ContrastBand,
  DepthBand,
  FaceMeasures,
  Lab,
  Measure,
  PhotoProfile,
  Undertone,
} from "./types";

const UNKNOWN = "Couldn't read this from the photo";

function known<T>(m: Measure<T>): T | null {
  return m.value === "unknown" ? null : m.value;
}

function hedge(confidence: number, text: string): string {
  if (confidence < 0.55) return `Might be ${text[0]!.toLowerCase()}${text.slice(1)}`;
  if (confidence < 0.75) return `Looks like ${text[0]!.toLowerCase()}${text.slice(1)}`;
  return text;
}

const UNDERTONE: Record<Undertone, string> = {
  olive: "Olive undertone — green-gold, not warm and not cool",
  warm: "Warm undertone — golden / peach",
  cool: "Cool undertone — pink / rosy",
  neutral: "Neutral undertone — not clearly warm or cool",
};

const DEPTH: Record<DepthBand, string> = {
  "very light": "Very light skin",
  light: "Light skin",
  intermediate: "Light-medium skin",
  tan: "Medium skin",
  brown: "Medium-deep skin",
  deep: "Deep skin",
};

const CONTRAST: Record<ContrastBand, string> = {
  high: "High contrast — hair and features sit far from the skin",
  medium: "Medium contrast — some difference between hair, skin, and eyes",
  low: "Low contrast — hair, skin, and eyes sit close together",
};

function hairTone(lab: Lab): string {
  if (lab.L < 22) return "Very dark hair";
  if (lab.L < 38) return "Dark hair";
  if (lab.L < 55) return "Medium hair";
  return "Light hair";
}

function eyeTone(lab: Lab): string {
  if (lab.L < 28) return "Dark eyes";
  if (lab.L < 48) return "Medium eyes";
  return "Lighter eyes";
}

export type ColourReadout = {
  lines: string[];
  skin: Lab | null;
  hair: Lab | null;
  iris: Lab | null;
};

export function describeColour(c: ColourMeasures): ColourReadout {
  const lines: string[] = [];
  const undertone = known(c.undertone);
  if (undertone) lines.push(hedge(c.undertone.confidence, UNDERTONE[undertone]));
  const depth = known(c.depth);
  if (depth) lines.push(DEPTH[depth]);
  const contrast = known(c.contrast);
  if (contrast) lines.push(CONTRAST[contrast]);

  const hair = known(c.hair);
  const iris = known(c.iris);
  const extras: string[] = [];
  if (hair) extras.push(hairTone(hair));
  if (iris) extras.push(eyeTone(iris));
  if (extras.length) lines.push(extras.join(". ") + ".");

  if (c.whiteBalance.risk) {
    lines.push("The light in this photo may be throwing the colour off a little.");
  }
  if (!lines.length) lines.push(UNKNOWN);

  return {
    lines,
    skin: known(c.skin),
    hair,
    iris,
  };
}

function faceLength(faceLW: number): string {
  if (faceLW < 1.2) return "about as wide as it is long";
  if (faceLW > 1.5) return "noticeably longer than it is wide";
  return "a little longer than it is wide";
}

function jawLine(jawCheek: number): string {
  if (jawCheek < 0.84) return "the jaw tapers in from the cheeks";
  if (jawCheek > 0.95) return "the jaw is about as wide as the cheeks";
  return "the jaw sits close to the cheek width";
}

function foreheadLine(foreheadCheek: number): string {
  if (foreheadCheek < 0.9) return "the forehead is narrower than the cheeks";
  return "the forehead matches the cheek width";
}

function chinLine(chinCheek: number): string {
  if (chinCheek < 0.7) return "the chin tapers in";
  return "the chin is fuller";
}

function neckLine(neckLength: number): string {
  if (neckLength < 0.2) return "neck on the shorter side";
  if (neckLength > 0.35) return "a longer neck";
  return "an average-length neck";
}

export function describeFace(f: FaceMeasures): string {
  const parts: string[] = [];
  const shape = known(f.shape);
  const faceLW = known(f.faceLW);
  if (shape && faceLW != null) {
    parts.push(`A ${shape} face, ${faceLength(faceLW)}`);
  } else if (shape) {
    parts.push(`A ${shape} face`);
  } else if (faceLW != null) {
    parts.push(`The face is ${faceLength(faceLW)}`);
  }

  const mid: string[] = [];
  const jaw = known(f.jawCheek);
  const forehead = known(f.foreheadCheek);
  const chin = known(f.chinCheek);
  if (jaw != null) mid.push(jawLine(jaw));
  if (forehead != null) mid.push(foreheadLine(forehead));
  if (chin != null) mid.push(chinLine(chin));
  if (mid.length) {
    const sentence = mid.join(", ");
    parts.push(sentence.charAt(0).toUpperCase() + sentence.slice(1));
  }

  const neck = known(f.neckLength);
  if (neck != null) {
    const n = neckLine(neck);
    parts.push(n.charAt(0).toUpperCase() + n.slice(1));
  }

  return parts.length ? `${parts.join(". ")}.` : UNKNOWN;
}

function shoulderLine(v: number): string {
  if (v > 1.08) return "shoulders wider than the hips";
  if (v < 0.92) return "hips wider than the shoulders";
  return "shoulders and hips in similar balance";
}

function waistLine(overHip: number, depth: number): string {
  if (depth > 0.18 && overHip < 0.82) return "a clearly nipped waist";
  if (overHip > 0.9 || depth < 0.1) return "a straighter line through the middle";
  return "a gently marked waist";
}

function verticalLine(torsoOverLeg: number, legPct: number): string {
  if (torsoOverLeg > 1.05) return "a longer torso than leg line";
  if (legPct > 0.5 || torsoOverLeg < 0.9) return "a longer leg line than torso";
  return "torso and legs in similar proportion";
}

export function describeBody(b: BodyMeasures): string {
  if (!b.available) {
    return "Need a full-length photo, feet in frame, to read the body.";
  }
  const parts: string[] = [];
  const sh = known(b.shoulderOverHip);
  const wh = known(b.waistOverHip);
  const wd = known(b.waistDepth);
  if (sh != null) parts.push(shoulderLine(sh));
  if (wh != null && wd != null) parts.push(waistLine(wh, wd));
  else if (wh != null) {
    parts.push(wh < 0.85 ? "waist narrower than the hips" : "a straighter waist-to-hip line");
  }
  const torso = known(b.torsoOverLeg);
  const legs = known(b.legPctHeight);
  if (torso != null && legs != null) parts.push(verticalLine(torso, legs));
  const heads = known(b.headsTall);
  if (heads != null && heads >= 5 && heads <= 10) {
    parts.push(`about ${heads.toFixed(1)} heads tall in this photo`);
  }
  if (!parts.length) return UNKNOWN;
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

export function describeNotes(profile: PhotoProfile): string[] {
  const out: string[] = [];
  for (const w of profile.quality.warnings) {
    if (w.startsWith("Short edge")) out.push("This photo is a bit small.");
    else if (w.startsWith("No face")) out.push("Couldn't find a clear face.");
    else if (w.startsWith("More than one")) out.push("More than one person — reading the closest face.");
    else out.push(w);
  }
  for (const n of profile.notes) {
    if (/white-balance|colour cast|tungsten|illuminant/i.test(n)) {
      out.push("The lighting may be warming or cooling the colour.");
    } else {
      out.push(n);
    }
  }
  return [...new Set(out)];
}
