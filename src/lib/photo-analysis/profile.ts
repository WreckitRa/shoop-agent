import { CALIBRATE } from "./calibrate";
import {
  abRatio,
  applyWhiteBalance,
  chroma,
  contrastBandFrom,
  depthFromIta,
  estimateWhiteBalance,
  hueAngle,
  ita,
  luma,
  medianRgb,
  rgbToLab,
  undertoneConfidence,
  undertoneFrom,
} from "./colour";
import { bodyMeasures, faceGeometry } from "./geometry";
import {
  backgroundModel,
  isSkin,
  largestComponent,
  rowProfile,
  silhouetteMask,
  skinMask,
  type RowProfile,
} from "./segment";
import {
  PHOTO_ANALYSIS_ENGINE_VERSION,
  emptyBody,
  emptyFace,
  knownMeasure,
  unknownMeasure,
  type ColourMeasures,
  type ImagePixels,
  type Lab,
  type PhotoProfile,
  type PhotoQuality,
} from "./types";

const HEAD_FRAC_OF_SILHOUETTE = 0.16;

function collectPixels(
  img: ImagePixels,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  pred?: (r: number, g: number, b: number) => boolean,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const xa = Math.max(0, Math.floor(Math.min(x0, x1)));
  const xb = Math.min(img.width - 1, Math.floor(Math.max(x0, x1)));
  const ya = Math.max(0, Math.floor(Math.min(y0, y1)));
  const yb = Math.min(img.height - 1, Math.floor(Math.max(y0, y1)));
  const d = img.data;
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const i = (y * img.width + x) * 4;
      const r = d[i]!;
      const g = d[i + 1]!;
      const b = d[i + 2]!;
      if (pred && !pred(r, g, b)) continue;
      out.push([r, g, b]);
    }
  }
  return out;
}

function darkestPercent(
  pixels: Array<[number, number, number]>,
  pct: number,
): Array<[number, number, number]> {
  if (!pixels.length) return [];
  const sorted = [...pixels].sort(
    (a, b) => luma(a[0], a[1], a[2]) - luma(b[0], b[1], b[2]),
  );
  const n = Math.max(1, Math.floor(sorted.length * pct));
  return sorted.slice(0, n);
}

function meanRgb(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  return { r: (a.r + b.r) / 2, g: (a.g + b.g) / 2, b: (a.b + b.b) / 2 };
}

function clipLabelsAbove(
  labels: Int32Array,
  width: number,
  yMaxInclusive: number,
): Int32Array {
  const copy = new Int32Array(labels);
  const cut = (yMaxInclusive + 1) * width;
  for (let i = Math.max(0, cut); i < copy.length; i++) copy[i] = 0;
  return copy;
}

function emptyColour(): ColourMeasures {
  return {
    skin: unknownMeasure(),
    hair: unknownMeasure(),
    iris: unknownMeasure(),
    ita: unknownMeasure(),
    hue: unknownMeasure(),
    chroma: unknownMeasure(),
    abRatio: unknownMeasure(),
    depth: unknownMeasure(),
    undertone: unknownMeasure(),
    contrast: unknownMeasure(),
    contrastValue: unknownMeasure(),
    whiteBalance: {
      gainR: 1,
      gainB: 1,
      cast: 1,
      risk: true,
      neutralCount: 0,
    },
  };
}

function labFromMedian(
  pixels: Array<[number, number, number]>,
): Lab | null {
  if (pixels.length < 8) return null;
  const m = medianRgb(pixels);
  return rgbToLab(m.r, m.g, m.b);
}

/**
 * Spec A.3 order is fixed: white balance, face box, medians, ITA/undertone,
 * contrast last. One onboarding photo stands in for the spec's face + optional
 * full frame — on a full-length silhouette the face box is the head, not the
 * whole body.
 */
export function computeProfile(img: ImagePixels): PhotoProfile {
  const notes: string[] = [];
  const warnings: string[] = [];
  const shortEdge = Math.min(img.width, img.height);
  if (shortEdge < CALIBRATE.minShortEdge) {
    warnings.push(`Short edge ${shortEdge}px is under ${CALIBRATE.minShortEdge}px`);
  }

  const wb = estimateWhiteBalance(img);
  const corrected = applyWhiteBalance(img, wb);
  const area = img.width * img.height;

  const mask = skinMask(corrected);
  const skinComp = largestComponent(mask, img.width, img.height);
  const facePresent =
    skinComp.size / Math.max(area, 1) >= CALIBRATE.faceMinFrameFrac;
  const singleSubject =
    skinComp.secondSize === 0 ||
    skinComp.size >= CALIBRATE.singleSubjectRatio * skinComp.secondSize;

  if (!facePresent) warnings.push("No face found — colour and face groups unavailable");
  if (!singleSubject) warnings.push("More than one subject — using the largest skin region");
  if (wb.risk) {
    notes.push(
      wb.neutralCount < CALIBRATE.whiteBalanceMinNeutrals
        ? "White-balance neutrals were scarce; undertone confidence is capped"
        : "Estimated colour cast is high; undertone confidence is capped",
    );
  }

  const bg = backgroundModel(corrected);
  const silMask = silhouetteMask(corrected, bg);
  const silComp = largestComponent(silMask, img.width, img.height);
  const silRp =
    silComp.best && silComp.size
      ? rowProfile(silComp.labels, silComp.best, img.width, img.height)
      : null;
  const silH = silRp ? silRp.y1 - silRp.y0 + 1 : 0;
  const looksFullLength =
    silH >= CALIBRATE.fullLengthMinHeightFrac * img.height;

  let faceRp: RowProfile | null = null;
  if (skinComp.best && skinComp.size) {
    const skinRp = rowProfile(
      skinComp.labels,
      skinComp.best,
      img.width,
      img.height,
    );
    if (looksFullLength && silRp) {
      const headBottom = silRp.y0 + Math.round(HEAD_FRAC_OF_SILHOUETTE * silH);
      const clipped = clipLabelsAbove(skinComp.labels, img.width, headBottom);
      faceRp = rowProfile(clipped, skinComp.best, img.width, img.height);
    } else {
      faceRp = skinRp;
    }
  }

  const faceH = faceRp ? faceRp.y1 - faceRp.y0 + 1 : 0;
  const face =
    faceRp && facePresent
      ? faceGeometry(faceRp, skinComp.size, area)
      : emptyFace();

  const colour = emptyColour();
  colour.whiteBalance = wb;

  if (faceRp && facePresent) {
    const fw = faceRp.x1 - faceRp.x0 + 1;
    const fh = faceH;
    const cx = (faceRp.x0 + faceRp.x1) / 2;
    const y0 = faceRp.y0;
    const y1 = faceRp.y1;

    const jaw = collectPixels(
      corrected,
      cx - 0.18 * fw,
      cx + 0.18 * fw,
      y0 + 0.7 * fh,
      y0 + 0.86 * fh,
      isSkin,
    );
    const neck = collectPixels(
      corrected,
      cx - 0.2 * fw,
      cx + 0.2 * fw,
      y1 + 2,
      y1 + 0.16 * fh,
      isSkin,
    );

    const jawMed = jaw.length >= 8 ? medianRgb(jaw) : null;
    const neckMed = neck.length >= 8 ? medianRgb(neck) : null;
    const skinRgb =
      jawMed && neckMed
        ? meanRgb(jawMed, neckMed)
        : jawMed ?? neckMed;
    if (skinRgb) {
      const skinLab = rgbToLab(skinRgb.r, skinRgb.g, skinRgb.b);
      const skinConf = wb.risk ? 0.55 : 0.86;
      colour.skin = knownMeasure(skinLab, skinConf);
      const itaV = ita(skinLab);
      const hueV = hueAngle(skinLab);
      const chromaV = chroma(skinLab);
      const ratio = abRatio(skinLab);
      colour.ita = knownMeasure(itaV, skinConf);
      colour.hue = knownMeasure(hueV, skinConf);
      colour.chroma = knownMeasure(chromaV, skinConf);
      colour.abRatio = knownMeasure(ratio, skinConf);
      colour.depth = knownMeasure(depthFromIta(itaV), skinConf);
      colour.undertone = knownMeasure(
        undertoneFrom(skinLab),
        undertoneConfidence(hueV, wb.risk),
      );
    }

    const hairPx = darkestPercent(
      collectPixels(
        corrected,
        cx - 0.44 * fw,
        cx + 0.44 * fw,
        y0 - 0.36 * fh,
        y0 + 0.04 * fh,
      ),
      0.35,
    );
    const hairLab = labFromMedian(hairPx);
    if (hairLab) colour.hair = knownMeasure(hairLab, 0.66);

    const leftIris = darkestPercent(
      collectPixels(
        corrected,
        cx - 0.34 * fw,
        cx - 0.12 * fw,
        y0 + 0.34 * fh,
        y0 + 0.46 * fh,
      ),
      0.35,
    );
    const rightIris = darkestPercent(
      collectPixels(
        corrected,
        cx + 0.12 * fw,
        cx + 0.34 * fw,
        y0 + 0.34 * fh,
        y0 + 0.46 * fh,
      ),
      0.35,
    );
    const leftLab = labFromMedian(leftIris);
    const rightLab = labFromMedian(rightIris);
    if (leftLab && rightLab) {
      colour.iris = knownMeasure(
        {
          L: (leftLab.L + rightLab.L) / 2,
          a: (leftLab.a + rightLab.a) / 2,
          b: (leftLab.b + rightLab.b) / 2,
        },
        0.45,
      );
    } else if (leftLab || rightLab) {
      colour.iris = knownMeasure(leftLab ?? rightLab!, 0.45);
    }

    const skinL =
      colour.skin.value === "unknown" ? null : colour.skin.value.L;
    const hairL =
      colour.hair.value === "unknown" ? null : colour.hair.value.L;
    const eyeL =
      colour.iris.value === "unknown" ? null : colour.iris.value.L;
    const parts: number[] = [];
    if (skinL != null && hairL != null) parts.push(Math.abs(hairL - skinL));
    if (skinL != null && eyeL != null) parts.push(Math.abs(skinL - eyeL));
    const samples = (hairL != null ? 1 : 0) + (eyeL != null ? 1 : 0);
    const contrastConf = samples === 2 ? 0.85 : samples === 1 ? 0.6 : 0;
    if (parts.length && contrastConf > 0) {
      const contrastV = Math.max(...parts);
      colour.contrastValue = knownMeasure(contrastV, contrastConf);
      colour.contrast = knownMeasure(contrastBandFrom(contrastV), contrastConf);
    }
  }

  const body = silRp
    ? bodyMeasures(
        silRp,
        img.height,
        Math.max(faceH, 1),
        faceRp?.y1 ?? silRp.y0,
        bg.spread,
        facePresent,
      )
    : emptyBody("No silhouette found — body group unavailable");

  const quality: PhotoQuality = {
    shortEdge,
    facePresent,
    singleSubject,
    whiteBalanceRisk: wb.risk,
    fullLength: body.available,
    warnings,
  };

  return {
    source: "spec",
    engine: PHOTO_ANALYSIS_ENGINE_VERSION,
    colour,
    face,
    body,
    quality,
    notes,
  };
}
