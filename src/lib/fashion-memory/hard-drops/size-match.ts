import { garmentToSizeBucket } from "../intake/garment-size-fields";
import type { NormalizedSize } from "../normalize/types";
import type {
  FashionFactRow,
  FashionFactSizeValue,
  WaistInseamSize,
} from "../types";
import type { FashionSearchBrief } from "../router/types";

export type SizeCorrespondence = "exact" | "possible" | "none";

export function recipientSizeForGarment(
  facts: FashionFactRow[],
  garment: string,
): FashionFactSizeValue | null {
  const bucket = garmentToSizeBucket(garment);
  const fact = facts.find(
    (f) => f.fact_type === "size" && f.garment_type === bucket,
  );
  if (!fact || fact.fact_type !== "size") return null;
  return fact.value as FashionFactSizeValue;
}

export function shouldRunSizeHardDrop(
  brief: FashionSearchBrief,
  garment: string,
  facts: FashionFactRow[],
): boolean {
  if (brief.knowledge_state?.sizes_unconfirmed.includes(garment)) return false;
  return recipientSizeForGarment(facts, garment) != null;
}

function alphaRecipient(value: FashionFactSizeValue): string | null {
  if (value.system !== "alpha") return null;
  return String(value.value).trim().toUpperCase();
}

function numericRecipient(
  value: FashionFactSizeValue,
): { numeric: number; system: "eu" | "us" | "uk" } | null {
  if (value.system === "eu" || value.system === "us" || value.system === "uk") {
    const n = Number(value.value);
    if (!Number.isFinite(n)) return null;
    return { numeric: n, system: value.system };
  }
  return null;
}

function waistRecipient(value: FashionFactSizeValue): WaistInseamSize | null {
  if (value.system !== "waist_inseam") return null;
  if (typeof value.value === "object" && value.value != null && "waist" in value.value) {
    return value.value as WaistInseamSize;
  }
  return null;
}

export function sizeCorresponds(
  normalized: NormalizedSize,
  recipient: FashionFactSizeValue,
): SizeCorrespondence {
  if (normalized.one_size) return "exact";

  const alpha = alphaRecipient(recipient);
  if (alpha) {
    if (normalized.alpha === alpha) return "exact";
    return "none";
  }

  const numeric = numericRecipient(recipient);
  if (numeric) {
    if (
      normalized.numeric != null &&
      normalized.numeric_system === numeric.system &&
      normalized.numeric === numeric.numeric
    ) {
      return "exact";
    }
    if (normalized.numeric != null && normalized.numeric_system === "ambiguous") {
      return "possible";
    }
    return "none";
  }

  const waist = waistRecipient(recipient);
  if (waist) {
    if (
      normalized.numeric_system === "waist" &&
      normalized.numeric === waist.waist
    ) {
      if (
        normalized.inseam != null &&
        waist.inseam != null &&
        normalized.inseam !== waist.inseam
      ) {
        return "none";
      }
      return "exact";
    }
    if (normalized.numeric != null && normalized.numeric_system === "ambiguous") {
      return "possible";
    }
    return "none";
  }

  return "none";
}

export function formatResolvedSizeList(
  sizes: Array<{ raw: string; size: NormalizedSize | null }>,
): string {
  return sizes
    .map((s) => {
      const parts: string[] = [s.raw];
      if (s.size?.alpha) parts.push(`alpha=${s.size.alpha}`);
      if (s.size?.numeric != null) {
        parts.push(`numeric=${s.size.numeric}(${s.size.numeric_system ?? "?"})`);
      }
      if (s.size?.one_size) parts.push("one_size");
      return parts.join(":");
    })
    .join("; ");
}
