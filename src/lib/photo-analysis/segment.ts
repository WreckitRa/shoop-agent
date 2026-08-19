import { CALIBRATE } from "./calibrate";
import { median } from "./colour";
import type { ImagePixels } from "./types";

export function isSkin(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const kovac =
    r > 95 &&
    g > 40 &&
    b > 20 &&
    mx - mn > 15 &&
    Math.abs(r - g) > 15 &&
    r > g &&
    r > b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const ycbcr = cb >= 77 && cb <= 135 && cr >= 133 && cr <= 180;
  return kovac || ycbcr;
}

export type ComponentResult = {
  labels: Int32Array;
  best: number;
  size: number;
  secondSize: number;
};

export function largestComponent(
  mask: Uint8Array,
  w: number,
  h: number,
): ComponentResult {
  const labels = new Int32Array(w * h);
  let next = 1;
  let best = 0;
  let bestSize = 0;
  let secondSize = 0;
  const stack: number[] = [];

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    const id = next++;
    let size = 0;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      if (labels[p]) continue;
      labels[p] = id;
      size += 1;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) stack.push(p - 1);
      if (x + 1 < w && mask[p + 1] && !labels[p + 1]) stack.push(p + 1);
      if (y > 0 && mask[p - w] && !labels[p - w]) stack.push(p - w);
      if (y + 1 < h && mask[p + w] && !labels[p + w]) stack.push(p + w);
    }
    if (size > bestSize) {
      secondSize = bestSize;
      bestSize = size;
      best = id;
    } else if (size > secondSize) {
      secondSize = size;
    }
  }

  return { labels, best, size: bestSize, secondSize };
}

export type RowProfile = {
  rowWidth: number[];
  rowMin: number[];
  rowMax: number[];
  runs: number[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};

export function rowProfile(
  labels: Int32Array,
  best: number,
  w: number,
  h: number,
): RowProfile {
  const rowWidth = new Array<number>(h).fill(0);
  const rowMin = new Array<number>(h).fill(w);
  const rowMax = new Array<number>(h).fill(-1);
  const runs = new Array<number>(h).fill(0);
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;

  for (let y = 0; y < h; y++) {
    let inRun = false;
    let runCount = 0;
    let minX = w;
    let maxX = -1;
    for (let x = 0; x < w; x++) {
      const on = labels[y * w + x] === best;
      if (on) {
        if (!inRun) {
          runCount += 1;
          inRun = true;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      } else if (inRun) {
        inRun = false;
      }
    }
    runs[y] = runCount;
    if (maxX >= 0) {
      rowMin[y] = minX;
      rowMax[y] = maxX;
      rowWidth[y] = maxX - minX + 1;
      if (minX < x0) x0 = minX;
      if (maxX > x1) x1 = maxX;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }

  return { rowWidth, rowMin, rowMax, runs, x0, x1, y0, y1 };
}

export function skinMask(img: ImagePixels): Uint8Array {
  const mask = new Uint8Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    mask[p] = isSkin(d[i]!, d[i + 1]!, d[i + 2]!) ? 1 : 0;
  }
  return mask;
}

export type BackgroundModel = {
  rgb: [number, number, number];
  spread: number;
  threshold: number;
};

export function backgroundModel(img: ImagePixels): BackgroundModel {
  const { data, width, height } = img;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    rs.push(data[i]!);
    gs.push(data[i + 1]!);
    bs.push(data[i + 2]!);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) push(x, y);
    }
  }
  const rgb: [number, number, number] = [median(rs), median(gs), median(bs)];
  let distSum = 0;
  for (let i = 0; i < rs.length; i++) {
    const dr = rs[i]! - rgb[0];
    const dg = gs[i]! - rgb[1];
    const db = bs[i]! - rgb[2];
    distSum += Math.sqrt(dr * dr + dg * dg + db * db);
  }
  const spread = rs.length ? distSum / rs.length : 0;
  return {
    rgb,
    spread,
    threshold: Math.max(CALIBRATE.backgroundSpreadFloor, spread * CALIBRATE.backgroundSpreadMul),
  };
}

export function silhouetteMask(img: ImagePixels, bg: BackgroundModel): Uint8Array {
  const mask = new Uint8Array(img.width * img.height);
  const d = img.data;
  const [br, bgc, bb] = bg.rgb;
  const th = bg.threshold;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const dr = d[i]! - br;
    const dg = d[i + 1]! - bgc;
    const db = d[i + 2]! - bb;
    mask[p] = Math.sqrt(dr * dr + dg * dg + db * db) > th ? 1 : 0;
  }
  return mask;
}
