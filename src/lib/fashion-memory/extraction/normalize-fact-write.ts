import {
  garmentToSizeBucket,
  type SizeGarmentBucket,
} from "../intake/garment-size-fields";
import { resolveSizeDeterministic } from "../normalize/size";
import type { SizeCategory } from "../normalize/types";
import {
  fashionFactBudgetBandValueSchema,
  fashionFactDepthDefaultValueSchema,
  fashionFactFitValueSchema,
  fashionFactGenderPresentationValueSchema,
  fashionFactMeasurementValueSchema,
  fashionFactNoGoValueSchema,
} from "./fact-value-schemas";
import type {
  FashionFactNoGoKind,
  FashionFactNoGoValue,
  FashionFactSizeValue,
  FashionFactType,
} from "../types";

const SIZE_FAMILIES = new Set<SizeGarmentBucket>([
  "tops",
  "bottoms",
  "shoes",
  "dresses",
]);

const MATERIAL_NO_GOS = new Set([
  "leather",
  "wool",
  "fur",
  "nickel",
  "silk",
  "cashmere",
  "suede",
  "polyester",
  "synthetic fragrances",
  "animal products",
]);

export type NormalizedFactWrite = {
  garmentType: string | null;
  value: unknown;
};

export type NormalizeFactWriteResult =
  | { ok: true; write: NormalizedFactWrite }
  | { ok: false; reason: string };

function sizeFamilyFromString(
  garmentType: string | null | undefined,
): SizeGarmentBucket | null {
  const raw = garmentType?.trim().toLowerCase() ?? "";
  if (!raw) return null;
  if (raw === "top") return "tops";
  if (raw === "bottom") return "bottoms";
  if (raw === "shoe") return "shoes";
  if (raw === "dress") return "dresses";
  if (SIZE_FAMILIES.has(raw as SizeGarmentBucket)) {
    return raw as SizeGarmentBucket;
  }
  return garmentToSizeBucket(raw);
}

function sizeFamily(
  garmentType: string | null | undefined,
  value: unknown,
): SizeGarmentBucket | null {
  const fromGarment = sizeFamilyFromString(garmentType);
  if (fromGarment) return fromGarment;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["category", "garment_type", "family", "bucket"] as const) {
      if (typeof rec[key] === "string") {
        const fromValue = sizeFamilyFromString(rec[key]);
        if (fromValue) return fromValue;
      }
    }
  }
  const guessed = normalizeSizeValue(value, null);
  if (!guessed) return null;
  if (guessed.system === "alpha") return "tops";
  if (guessed.system === "eu") return "shoes";
  if (guessed.system === "waist_inseam") return "bottoms";
  if (typeof guessed.value === "number") {
    if (guessed.value >= 35 && guessed.value <= 50) return "shoes";
    if (guessed.value >= 24 && guessed.value <= 44) return "bottoms";
    if (guessed.value >= 5 && guessed.value <= 15) return "shoes";
  }
  return "tops";
}

function sizeCategory(family: SizeGarmentBucket | null): SizeCategory {
  return family ?? "general";
}

function fromNormalizedSize(
  raw: string,
  category: SizeCategory,
): FashionFactSizeValue | null {
  const det = resolveSizeDeterministic(raw, category);
  if (det.resolved && det.size.alpha) {
    return { system: "alpha", value: det.size.alpha };
  }
  if (det.resolved && det.size.numeric != null && det.size.inseam != null) {
    return {
      system: "waist_inseam",
      value: { waist: det.size.numeric, inseam: det.size.inseam },
    };
  }
  if (det.resolved && det.size.numeric != null) {
    const n = det.size.numeric;
    const sys = det.size.numeric_system;
    if (sys === "eu") return { system: "eu", value: n };
    if (sys === "uk") return { system: "uk", value: n };
    if (sys === "us") return { system: "us", value: n };
    if (sys === "waist") return { system: "us", value: n };
    if (category === "shoes" && n >= 35 && n <= 50) {
      return { system: "eu", value: n };
    }
    if (n >= 35 && n <= 50) return { system: "eu", value: n };
    if (n >= 5 && n <= 15) return { system: "us", value: n };
    return { system: "us", value: n };
  }
  return null;
}

function rawSizeString(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.value === "string" || typeof rec.value === "number") {
    return String(rec.value).trim() || null;
  }
  if (typeof rec.size === "string" || typeof rec.size === "number") {
    return String(rec.size).trim() || null;
  }
  if (
    rec.value &&
    typeof rec.value === "object" &&
    "waist" in rec.value &&
    "inseam" in rec.value
  ) {
    const waist = Number((rec.value as { waist: unknown }).waist);
    const inseam = Number((rec.value as { inseam: unknown }).inseam);
    if (Number.isFinite(waist) && Number.isFinite(inseam)) {
      return `${waist}x${inseam}`;
    }
  }
  return null;
}

/** Catalog size classifier (deterministic half) → fashion_facts.size. */
export function normalizeSizeValue(
  value: unknown,
  garmentType?: string | null,
): FashionFactSizeValue | null {
  const family = sizeFamilyFromString(garmentType);
  const raw = rawSizeString(value);
  if (!raw) return null;
  const category = sizeCategory(family);
  const fromDet = fromNormalizedSize(raw, category);
  if (fromDet) return fromDet;

  if (
    value &&
    typeof value === "object" &&
    "system" in value &&
    "value" in value
  ) {
    const rec = value as FashionFactSizeValue;
    if (rec.system === "alpha" && typeof rec.value === "string") {
      const alpha = fromNormalizedSize(rec.value, "general");
      if (alpha) return alpha;
    }
  }
  return null;
}

export function noGoGarmentKey(
  kind: FashionFactNoGoKind,
  value: string,
): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `nogo-${kind}-${slug || "x"}`;
}

export function classifyNoGo(raw: string): FashionFactNoGoValue | null {
  const value = raw.trim().toLowerCase();
  if (!value || value.length > 80) return null;
  if (
    MATERIAL_NO_GOS.has(value) ||
    /\b(leather|wool|fur|silk|polyester)\b/.test(value)
  ) {
    return { kind: "material", value };
  }
  if (
    /\b(red|blue|green|yellow|pink|orange|purple|white|black|navy)\b/.test(
      value,
    )
  ) {
    return { kind: "color", value };
  }
  if (/\b(shorts|skirt|dress|heels?|sandals?|tie|suit)\b/.test(value)) {
    return { kind: "garment", value };
  }
  return { kind: "style", value };
}

function normalizeNoGo(value: unknown): FashionFactNoGoValue | null {
  const parsed = fashionFactNoGoValueSchema.safeParse(value);
  if (parsed.success) {
    return {
      kind: parsed.data.kind,
      value: parsed.data.value.trim().toLowerCase(),
    };
  }
  if (typeof value === "string") return classifyNoGo(value);
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const kind of ["material", "style", "color", "garment"] as const) {
      const raw = rec[kind];
      if (typeof raw === "string" && raw.trim()) {
        return { kind, value: raw.trim().toLowerCase() };
      }
    }
  }
  return null;
}

function normalizeMeasurement(value: unknown): {
  garmentType: string;
  value: unknown;
} | null {
  const parsed = fashionFactMeasurementValueSchema.safeParse(value);
  if (!parsed.success) return null;
  return { garmentType: parsed.data.metric, value: parsed.data };
}

function normalizeDepth(value: unknown): unknown | null {
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const count = Number(rec.count);
    const unit = rec.unit;
    const coerced = {
      count,
      unit: unit === "looks" || unit === "options" ? unit : undefined,
    };
    const parsed = fashionFactDepthDefaultValueSchema.safeParse(coerced);
    return parsed.success ? parsed.data : null;
  }
  return null;
}

export function normalizeFactWrite(params: {
  factType: FashionFactType | string;
  garmentType?: string | null;
  value: unknown;
}): NormalizeFactWriteResult {
  const garmentIn = params.garmentType?.trim() || null;

  switch (params.factType) {
    case "size": {
      const family = sizeFamily(garmentIn, params.value);
      if (!family) {
        return { ok: false, reason: "size_garment_type_required" };
      }
      const value = normalizeSizeValue(params.value, family);
      if (!value) return { ok: false, reason: "size_value_invalid" };
      return { ok: true, write: { garmentType: family, value } };
    }
    case "no_go": {
      const value = normalizeNoGo(params.value);
      if (!value) return { ok: false, reason: "no_go_value_invalid" };
      return {
        ok: true,
        write: { garmentType: noGoGarmentKey(value.kind, value.value), value },
      };
    }
    case "measurement": {
      const write = normalizeMeasurement(params.value);
      if (!write) return { ok: false, reason: "measurement_value_invalid" };
      return { ok: true, write };
    }
    case "depth_default": {
      const value = normalizeDepth(params.value);
      if (!value) return { ok: false, reason: "depth_default_value_invalid" };
      return { ok: true, write: { garmentType: null, value } };
    }
    case "fit": {
      const raw =
        typeof params.value === "string"
          ? { fit: params.value.trim().toLowerCase() }
          : params.value;
      const parsed = fashionFactFitValueSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, reason: "fit_value_invalid" };
      return { ok: true, write: { garmentType: garmentIn, value: parsed.data } };
    }
    case "gender_presentation": {
      const parsed = fashionFactGenderPresentationValueSchema.safeParse(
        params.value,
      );
      if (!parsed.success) {
        return { ok: false, reason: "gender_presentation_value_invalid" };
      }
      return { ok: true, write: { garmentType: null, value: parsed.data } };
    }
    case "budget_band": {
      const parsed = fashionFactBudgetBandValueSchema.safeParse(params.value);
      if (!parsed.success) {
        return { ok: false, reason: "budget_band_value_invalid" };
      }
      return { ok: true, write: { garmentType: garmentIn, value: parsed.data } };
    }
    default:
      return {
        ok: true,
        write: { garmentType: garmentIn, value: params.value },
      };
  }
}

export function factValuesEqualNormalized(params: {
  factType: FashionFactType | string;
  garmentType?: string | null;
  a: unknown;
  b: unknown;
}): boolean {
  const left = normalizeFactWrite({
    factType: params.factType,
    garmentType: params.garmentType,
    value: params.a,
  });
  const right = normalizeFactWrite({
    factType: params.factType,
    garmentType: params.garmentType,
    value: params.b,
  });
  if (!left.ok || !right.ok) {
    return JSON.stringify(params.a) === JSON.stringify(params.b);
  }
  return (
    (left.write.garmentType ?? null) === (right.write.garmentType ?? null) &&
    JSON.stringify(left.write.value) === JSON.stringify(right.write.value)
  );
}
