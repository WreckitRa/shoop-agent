import { z } from "zod";
import {
  emptyBody,
  emptyFace,
  knownMeasure,
  unknownMeasure,
  type BodyMeasures,
  type ColourMeasures,
  type FaceMeasures,
  type Lab,
  type Measure,
  type PhotoProfile,
  type PhotoQuality,
} from "./types";

const undertoneEnum = z.enum(["olive", "warm", "cool", "neutral"]);
const contrastEnum = z.enum(["high", "medium", "low"]);
const depthEnum = z.enum([
  "very light",
  "light",
  "intermediate",
  "tan",
  "brown",
  "deep",
]);

const labSchema = z.object({
  L: z.number(),
  a: z.number(),
  b: z.number(),
});

function asMeasure<T>(
  raw: unknown,
  parseValue: (v: unknown) => T | "unknown",
): Measure<T> {
  if (!raw || typeof raw !== "object") return unknownMeasure();
  const o = raw as Record<string, unknown>;
  if (o.value === "unknown" || o.value == null) return unknownMeasure();
  const value = parseValue(o.value);
  if (value === "unknown") return unknownMeasure();
  const conf = typeof o.confidence === "number" ? o.confidence : 0;
  return knownMeasure(value, conf);
}

function asLab(v: unknown): Lab | "unknown" {
  const parsed = labSchema.safeParse(v);
  return parsed.success ? parsed.data : "unknown";
}

function asNumber(v: unknown): number | "unknown" {
  return typeof v === "number" && Number.isFinite(v) ? v : "unknown";
}

function asString(v: unknown): string | "unknown" {
  return typeof v === "string" && v.trim() && v !== "unknown"
    ? v.trim()
    : "unknown";
}

function coerceColour(raw: unknown): ColourMeasures {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const wbRaw =
    o.whiteBalance && typeof o.whiteBalance === "object"
      ? (o.whiteBalance as Record<string, unknown>)
      : {};
  return {
    skin: asMeasure(o.skin, asLab),
    hair: asMeasure(o.hair, asLab),
    iris: asMeasure(o.iris, asLab),
    ita: asMeasure(o.ita, asNumber),
    hue: asMeasure(o.hue, asNumber),
    chroma: asMeasure(o.chroma, asNumber),
    abRatio: asMeasure(o.abRatio, asNumber),
    depth: asMeasure(o.depth, (v) => {
      const p = depthEnum.safeParse(v);
      return p.success ? p.data : "unknown";
    }),
    undertone: asMeasure(o.undertone, (v) => {
      const p = undertoneEnum.safeParse(v);
      return p.success ? p.data : "unknown";
    }),
    contrast: asMeasure(o.contrast, (v) => {
      const p = contrastEnum.safeParse(v);
      return p.success ? p.data : "unknown";
    }),
    contrastValue: asMeasure(o.contrastValue, asNumber),
    whiteBalance: {
      gainR: typeof wbRaw.gainR === "number" ? wbRaw.gainR : 1,
      gainB: typeof wbRaw.gainB === "number" ? wbRaw.gainB : 1,
      cast: typeof wbRaw.cast === "number" ? wbRaw.cast : 1,
      risk: Boolean(wbRaw.risk),
      neutralCount:
        typeof wbRaw.neutralCount === "number" ? wbRaw.neutralCount : 0,
    },
  };
}

function coerceFace(raw: unknown): FaceMeasures {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (!raw) return emptyFace();
  return {
    faceLW: asMeasure(o.faceLW, asNumber),
    jawCheek: asMeasure(o.jawCheek, asNumber),
    foreheadCheek: asMeasure(o.foreheadCheek, asNumber),
    chinCheek: asMeasure(o.chinCheek, asNumber),
    neckLength: asMeasure(o.neckLength, asNumber),
    shape: asMeasure(o.shape, asString),
  };
}

function coerceBody(raw: unknown): BodyMeasures {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (!raw) return emptyBody("GPT did not return a body group");
  const available = o.available === true;
  const reason =
    typeof o.unavailableReason === "string" ? o.unavailableReason : undefined;
  return {
    available,
    unavailableReason: available ? undefined : reason ?? "Body group unavailable",
    shoulderOverHip: asMeasure(o.shoulderOverHip, asNumber),
    waistOverHip: asMeasure(o.waistOverHip, asNumber),
    waistDepth: asMeasure(o.waistDepth, asNumber),
    waistPct: asMeasure(o.waistPct, asNumber),
    massCentroid: asMeasure(o.massCentroid, asNumber),
    torsoOverLeg: asMeasure(o.torsoOverLeg, asNumber),
    legPctHeight: asMeasure(o.legPctHeight, asNumber),
    calfPct: asMeasure(o.calfPct, asNumber),
    taperBelowHip: asMeasure(o.taperBelowHip, asNumber),
    shoulderSlope: asMeasure(o.shoulderSlope, asNumber),
    headsTall: asMeasure(o.headsTall, asNumber),
  };
}

function coerceQuality(raw: unknown): PhotoQuality {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const warnings = Array.isArray(o.warnings)
    ? o.warnings.filter((w): w is string => typeof w === "string")
    : [];
  return {
    shortEdge: typeof o.shortEdge === "number" ? o.shortEdge : 0,
    facePresent: o.facePresent === true,
    singleSubject: o.singleSubject !== false,
    whiteBalanceRisk: o.whiteBalanceRisk === true,
    fullLength: o.fullLength === true,
    warnings,
  };
}

export function coercePhotoProfile(
  raw: unknown,
  engine: string,
): PhotoProfile {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const notes = Array.isArray(o.notes)
    ? o.notes.filter((n): n is string => typeof n === "string")
    : [];
  return {
    source: "gpt",
    engine,
    colour: coerceColour(o.colour),
    face: coerceFace(o.face),
    body: coerceBody(o.body),
    quality: coerceQuality(o.quality),
    notes,
  };
}

export function isPhotoProfile(value: unknown): value is PhotoProfile {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    (o.source === "spec" || o.source === "gpt") &&
    typeof o.engine === "string" &&
    o.colour != null &&
    o.face != null &&
    o.body != null &&
    o.quality != null
  );
}
