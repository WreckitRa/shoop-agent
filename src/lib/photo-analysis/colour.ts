import { CALIBRATE } from "./calibrate";
import type {
  ContrastBand,
  DepthBand,
  ImagePixels,
  Lab,
  Undertone,
  WhiteBalance,
} from "./types";

export function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  const v =
    c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

function labFInv(t: number): number {
  const t3 = t * t * t;
  return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  let X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  let Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  let Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  X /= 0.95047;
  Y /= 1.0;
  Z /= 1.08883;
  const fx = labF(X);
  const fy = labF(Y);
  const fz = labF(Z);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function labToRgb(lab: Lab): { r: number; g: number; b: number } {
  const fy = (lab.L + 16) / 116;
  const fx = lab.a / 500 + fy;
  const fz = fy - lab.b / 200;
  let X = labFInv(fx) * 0.95047;
  let Y = labFInv(fy);
  let Z = labFInv(fz) * 1.08883;
  const R = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314;
  const G = X * -0.969266 + Y * 1.8760108 + Z * 0.041556;
  const B = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252;
  return { r: linearToSrgb(R), g: linearToSrgb(G), b: linearToSrgb(B) };
}

export function labToHex(lab: Lab): string {
  const { r, g, b } = labToRgb(lab);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function lchToLab(L: number, C: number, hDeg: number): Lab {
  const rad = (hDeg * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

export function ita(lab: Lab): number {
  return (Math.atan2(lab.L - 50, lab.b) * 180) / Math.PI;
}

export function hueAngle(lab: Lab): number {
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return h;
}

export function chroma(lab: Lab): number {
  return Math.sqrt(lab.a * lab.a + lab.b * lab.b);
}

export function hueDistance(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

export function deltaE76(l1: Lab, l2: Lab): number {
  const dL = l1.L - l2.L;
  const da = l1.a - l2.a;
  const db = l1.b - l2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

export function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function medianRgb(pixels: Array<[number, number, number]>): {
  r: number;
  g: number;
  b: number;
} {
  return {
    r: median(pixels.map((p) => p[0])),
    g: median(pixels.map((p) => p[1])),
    b: median(pixels.map((p) => p[2])),
  };
}

function isNearNeutral(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx < 245 && mx > 25 && (mx - mn) / mx < CALIBRATE.whiteBalanceNeutralSpread;
}

export function estimateWhiteBalance(img: ImagePixels): WhiteBalance {
  const { data, width, height } = img;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (!isNearNeutral(r, g, b)) continue;
    sumR += r;
    sumG += g;
    sumB += b;
    n += 1;
  }
  if (n === 0) {
    return { gainR: 1, gainB: 1, cast: 1, risk: true, neutralCount: 0 };
  }
  const meanR = sumR / n;
  const meanG = sumG / n;
  const meanB = sumB / n;
  const gainR = meanG / Math.max(meanR, 1e-6);
  const gainB = meanG / Math.max(meanB, 1e-6);
  const cast = Math.max(Math.abs(1 - gainR), Math.abs(1 - gainB));
  return {
    gainR,
    gainB,
    cast,
    risk: cast > CALIBRATE.whiteBalanceCast || n < CALIBRATE.whiteBalanceMinNeutrals,
    neutralCount: n,
  };
}

export function applyWhiteBalance(img: ImagePixels, wb: WhiteBalance): ImagePixels {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, data[i]! * wb.gainR));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2]! * wb.gainB));
  }
  return { data, width: img.width, height: img.height };
}

export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function scaleChroma(hex: string, k: number): string {
  const { r, g, b } = hexToRgb(hex);
  const lab = rgbToLab(r, g, b);
  return labToHex(lchToLab(lab.L, chroma(lab) * k, hueAngle(lab)));
}

export function depthFromIta(itaValue: number): DepthBand {
  if (itaValue > 55) return "very light";
  if (itaValue >= 41) return "light";
  if (itaValue >= 28) return "intermediate";
  if (itaValue >= 10) return "tan";
  if (itaValue >= -30) return "brown";
  return "deep";
}

/** a/b. Olive is a yellow-green axis — only defined when b is positive. */
export function abRatio(lab: Lab): number {
  if (Math.abs(lab.b) < 1e-6) return lab.a >= 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  return lab.a / lab.b;
}

export function undertoneFrom(lab: Lab): Undertone {
  const ratio = abRatio(lab);
  if (lab.b > 0 && ratio < CALIBRATE.oliveAbRatio) return "olive";
  const h = hueAngle(lab);
  if (h > CALIBRATE.warmHue) return "warm";
  if (h < CALIBRATE.coolHue) return "cool";
  return "neutral";
}

export function contrastBandFrom(value: number): ContrastBand {
  if (value > CALIBRATE.contrastHigh) return "high";
  if (value >= CALIBRATE.contrastMedium) return "medium";
  return "low";
}

export function undertoneConfidence(
  hue: number,
  whiteBalanceRisk: boolean,
): number {
  if (whiteBalanceRisk) return 0.5;
  return Math.min(
    0.92,
    0.55 + Math.min(0.37, Math.abs(hue - CALIBRATE.undertoneCentreHue) / 22),
  );
}
