import { CALIBRATE } from "./calibrate";
import type { RowProfile } from "./segment";
import {
  emptyBody,
  emptyFace,
  knownMeasure,
  type BodyMeasures,
  type FaceMeasures,
} from "./types";

function meanRange(arr: number[], y0: number, y1: number): number {
  let s = 0;
  let n = 0;
  const lo = Math.max(0, Math.floor(y0));
  const hi = Math.min(arr.length - 1, Math.floor(y1));
  for (let i = lo; i <= hi; i++) {
    const v = arr[i] ?? 0;
    if (v > 0) {
      s += v;
      n += 1;
    }
  }
  return n ? s / n : 0;
}

function maxRange(arr: number[], y0: number, y1: number): number {
  let m = 0;
  const lo = Math.max(0, Math.floor(y0));
  const hi = Math.min(arr.length - 1, Math.floor(y1));
  for (let i = lo; i <= hi; i++) m = Math.max(m, arr[i] ?? 0);
  return m;
}

function faceShapeTrait(faceLW: number, jawCheek: number, foreheadCheek: number): string {
  if (faceLW < 1.2) return "square";
  if (faceLW > 1.5) return "oblong";
  if (jawCheek < 0.84 && foreheadCheek > 0.95) return "heart";
  if (jawCheek > 0.95 && foreheadCheek < 0.9) return "triangle";
  if (jawCheek < 0.9 && foreheadCheek >= 0.9) return "oval";
  return "round";
}

export function faceGeometry(
  rp: RowProfile,
  componentSize: number,
  imageArea: number,
): FaceMeasures {
  const fh = rp.y1 - rp.y0 + 1;
  if (fh < 12) return emptyFace();

  const y0 = rp.y0;
  const band = (a: number, b: number) => [y0 + a * fh, y0 + b * fh] as const;
  const [f0, f1] = band(0.1, 0.24);
  const [c0, c1] = band(0.3, 0.5);
  const [j0, j1] = band(0.68, 0.82);
  const [ch0, ch1] = band(0.88, 0.97);

  const foreheadW = meanRange(rp.rowWidth, f0, f1);
  const cheekW = maxRange(rp.rowWidth, c0, c1);
  const jawW = meanRange(rp.rowWidth, j0, j1);
  const chinW = meanRange(rp.rowWidth, ch0, ch1);
  if (cheekW <= 0) return emptyFace();

  const faceLW = fh / cheekW;
  const jawCheek = jawW / cheekW;
  const foreheadCheek = foreheadW / cheekW;
  const chinCheek = chinW / cheekW;
  const headH = fh;
  const shoulderY = rp.y1 + fh * 0.15;
  const neckLength = Math.max(0, (shoulderY - rp.y1) / headH);
  const frac = componentSize / Math.max(imageArea, 1);
  const conf = frac > CALIBRATE.faceBoxMinFrameFrac ? 0.8 : 0.6;

  return {
    faceLW: knownMeasure(faceLW, conf),
    jawCheek: knownMeasure(jawCheek, conf),
    foreheadCheek: knownMeasure(foreheadCheek, conf),
    chinCheek: knownMeasure(chinCheek, conf),
    neckLength: knownMeasure(neckLength, 0.45),
    shape: knownMeasure(faceShapeTrait(faceLW, jawCheek, foreheadCheek), conf),
  };
}

export function volumeProfile(rp: RowProfile): number[] {
  const h = rp.y1 - rp.y0 + 1;
  const out = new Array<number>(100).fill(0);
  if (h <= 0) return out;
  for (let k = 0; k < 100; k++) {
    const y0 = rp.y0 + (k / 100) * h;
    const y1 = rp.y0 + ((k + 1) / 100) * h;
    out[k] = meanRange(rp.rowWidth, y0, y1 - 1e-6);
  }
  return out;
}

function argMax(arr: number[], lo: number, hi: number): number {
  let best = lo;
  let v = -Infinity;
  for (let i = lo; i <= hi; i++) {
    if ((arr[i] ?? 0) > v) {
      v = arr[i]!;
      best = i;
    }
  }
  return best;
}

function argMinPositive(arr: number[], lo: number, hi: number): number {
  let best = lo;
  let v = Infinity;
  for (let i = lo; i <= hi; i++) {
    const x = arr[i] ?? 0;
    if (x > 4 && x < v) {
      v = x;
      best = i;
    }
  }
  return best;
}

export function bodyMeasures(
  rp: RowProfile,
  imageHeight: number,
  faceHeight: number,
  chinY: number,
  backgroundSpread: number,
  hasFaceAnchor: boolean,
): BodyMeasures {
  const silH = rp.y1 - rp.y0 + 1;
  const fullLength =
    silH >= CALIBRATE.fullLengthMinHeightFrac * imageHeight;
  const profile = volumeProfile(rp);
  const h = silH;
  const toY = (k: number) => rp.y0 + (k / 99) * Math.max(h - 1, 1);

  let hasSplit = false;
  for (let k = 55; k < 100; k++) {
    const y = Math.round(toY(k));
    if ((rp.runs[y] ?? 0) >= 2) {
      hasSplit = true;
      break;
    }
  }

  if (!fullLength || !hasSplit) {
    return emptyBody(
      !fullLength
        ? "Not full-length — body group unavailable"
        : "No leg split found — body group unavailable",
    );
  }

  let shoulderK = 8;
  let sharpest = -Infinity;
  for (let k = 8; k <= 28; k++) {
    const inc = (profile[Math.min(99, k + 2)] ?? 0) - (profile[Math.max(0, k - 2)] ?? 0);
    if (inc > sharpest) {
      sharpest = inc;
      shoulderK = k;
    }
  }
  const bustK = argMax(profile, 20, 38);
  const waistK = argMinPositive(profile, 32, 54);
  const hipK = argMax(profile, 46, 64);

  let crotchK = 52;
  let crotchFallback = true;
  for (let k = hipK + 1; k <= 90; k++) {
    const y0 = Math.round(toY(k));
    const ok =
      (rp.runs[y0] ?? 0) >= 2 &&
      (rp.runs[Math.min(rp.runs.length - 1, y0 + 1)] ?? 0) >= 2 &&
      (rp.runs[Math.min(rp.runs.length - 1, y0 + 2)] ?? 0) >= 2;
    if (ok) {
      crotchK = k;
      crotchFallback = false;
      break;
    }
  }
  const calfLo = Math.min(99, crotchK + 8);
  const calfHi = Math.min(99, crotchK + 34);
  const calfK = argMax(profile, calfLo, calfHi);

  const shoulderW = Math.max(
    profile[shoulderK] ?? 0,
    profile[Math.min(99, shoulderK + 2)] ?? 0,
  );
  const bustW = profile[bustK] ?? 0;
  const waistW = profile[waistK] ?? 0;
  const hipW = profile[hipK] ?? 1;

  let massNum = 0;
  let massDen = 0;
  for (let k = 0; k < 100; k++) {
    massNum += (profile[k] ?? 0) * k;
    massDen += profile[k] ?? 0;
  }

  const crotchY = toY(crotchK);
  const feetY = rp.y1;
  const conf =
    backgroundSpread > CALIBRATE.backgroundSpreadRisk
      ? 0.52
      : hasFaceAnchor
        ? crotchFallback
          ? 0.72
          : 0.84
        : 0.72;

  const peakW = Math.max(...profile, 1);
  let fullWidthK = shoulderK;
  for (let k = shoulderK; k <= 40; k++) {
    if ((profile[k] ?? 0) >= 0.97 * peakW) {
      fullWidthK = k;
      break;
    }
  }
  const slopeSpan = Math.max(0, fullWidthK - shoulderK);

  return {
    available: true,
    shoulderOverHip: knownMeasure(shoulderW / Math.max(hipW, 1), conf),
    waistOverHip: knownMeasure(waistW / Math.max(hipW, 1), conf),
    waistDepth: knownMeasure(
      (Math.min(bustW, hipW) - waistW) / Math.max(Math.min(bustW, hipW), 1),
      conf,
    ),
    waistPct: knownMeasure(waistK, conf),
    massCentroid: knownMeasure(massDen ? massNum / massDen : 50, conf),
    torsoOverLeg: knownMeasure(
      (crotchY - chinY) / Math.max(feetY - crotchY, 1),
      conf,
    ),
    legPctHeight: knownMeasure(
      (feetY - crotchY) / Math.max(silH, 1),
      conf,
    ),
    calfPct: knownMeasure(calfK, conf),
    taperBelowHip: knownMeasure(
      (hipW - (profile[Math.min(99, crotchK + 18)] ?? hipW)) / Math.max(hipW, 1),
      conf,
    ),
    shoulderSlope: knownMeasure(slopeSpan, 0.55),
    headsTall: knownMeasure(silH / Math.max(faceHeight, 1), conf),
  };
}
