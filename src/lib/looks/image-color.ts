import type { ColorFamily } from "@/lib/photo-analysis/style-contract";

export type Rgb = { r: number; g: number; b: number };

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** Bucket a garment RGB into a contract colour family. Background whites/blacks should be stripped first. */
export function familyFromRgb(rgb: Rgb): ColorFamily {
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (s < 0.12) {
    if (l < 0.18) return "black";
    if (l > 0.82) return "white";
    if (l > 0.62 && h > 20 && h < 70) return "beige";
    return "grey";
  }
  if (l < 0.14) return "black";
  if (h < 12 || h >= 348) return l < 0.38 ? "burgundy" : "red";
  if (h < 28) return l < 0.35 ? "brown" : "orange";
  if (h < 48) {
    if (l > 0.72 && s < 0.45) return "white";
    if (s < 0.35 && l > 0.45) return "beige";
    return l < 0.42 ? "brown" : "gold";
  }
  if (h < 70) {
    if (l > 0.7 && s < 0.4) return "beige";
    return "yellow";
  }
  if (h < 95) return l < 0.45 ? "olive" : "green";
  if (h < 165) return "green";
  if (h < 200) return l < 0.4 ? "navy" : "blue";
  if (h < 255) {
    if (l < 0.32) return "navy";
    if (s < 0.28 && l < 0.5) return "denim";
    return "blue";
  }
  if (h < 290) return "purple";
  if (h < 330) return "pink";
  return l < 0.4 ? "burgundy" : "red";
}

const NEAR_FAMILY: Partial<Record<ColorFamily, ColorFamily[]>> = {
  navy: ["blue", "denim"],
  blue: ["navy", "denim"],
  denim: ["navy", "blue"],
  olive: ["green"],
  green: ["olive"],
  burgundy: ["red"],
  red: ["burgundy"],
  beige: ["white", "brown"],
  white: ["beige"],
  brown: ["beige"],
  grey: ["black", "silver"],
  black: ["grey"],
  gold: ["yellow", "beige"],
  yellow: ["gold"],
};

export function familiesCompatible(observed: ColorFamily, expected: ColorFamily): boolean {
  if (observed === expected) return true;
  return Boolean(NEAR_FAMILY[expected]?.includes(observed));
}

/**
 * Average RGB of a centre crop, skipping near-white / near-black background pixels.
 * `data` is RGBA (4 bytes/pixel).
 */
export function dominantRgbFromRgba(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Rgb | null {
  const x0 = Math.floor(width * 0.25);
  const x1 = Math.ceil(width * 0.75);
  const y0 = Math.floor(height * 0.2);
  const y1 = Math.ceil(height * 0.8);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const rr = data[i] ?? 0;
      const gg = data[i + 1] ?? 0;
      const bb = data[i + 2] ?? 0;
      const a = data[i + 3] ?? 255;
      if (a < 40) continue;
      const max = Math.max(rr, gg, bb);
      const min = Math.min(rr, gg, bb);
      if (max > 248 && min > 235) continue;
      if (max < 18) continue;
      r += rr;
      g += gg;
      b += bb;
      n += 1;
    }
  }
  if (n < 24) return null;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}
