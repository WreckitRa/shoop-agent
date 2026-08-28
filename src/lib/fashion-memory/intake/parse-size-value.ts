/**
 * Parse user/onboarding size strings into fashion_facts.size shape.
 * Same classifier as clerk apply-ops (Medium → M, 42 → eu 42).
 */
import type { FashionFactSizeValue } from "../types";
import { normalizeSizeValue } from "../extraction/normalize-fact-write";

export function parseSizeValue(raw: string): FashionFactSizeValue {
  return (
    normalizeSizeValue(raw, null) ?? {
      system: "alpha",
      value: raw.trim(),
    }
  );
}
