/**
 * Provenance tags on brief fields — downstream can weight and explain honestly.
 */
import type { SearchBrief } from "./types";

export type ProvenanceSource = "user_stated" | "persona_inferred" | "profile_default";

export type BriefProvenance = {
  query?: ProvenanceSource;
  category?: ProvenanceSource;
  useCase?: ProvenanceSource;
  mustHaves?: Record<string, ProvenanceSource>;
  niceToHaves?: Record<string, ProvenanceSource>;
  genderScope?: ProvenanceSource;
  variantConstraints?: Partial<Record<"size" | "color", ProvenanceSource>>;
  occasionResolution?: string;
};

export function tagListProvenance(
  items: string[],
  source: ProvenanceSource,
): Record<string, ProvenanceSource> {
  const out: Record<string, ProvenanceSource> = {};
  for (const item of items) {
    const k = item.trim().toLowerCase();
    if (k) out[k] = source;
  }
  return out;
}

export function mergeProvenance(
  base: BriefProvenance | undefined,
  patch: BriefProvenance,
): BriefProvenance {
  return {
    ...base,
    ...patch,
    mustHaves: { ...base?.mustHaves, ...patch.mustHaves },
    niceToHaves: { ...base?.niceToHaves, ...patch.niceToHaves },
    variantConstraints: {
      ...base?.variantConstraints,
      ...patch.variantConstraints,
    },
  };
}

export function applyProvenanceToBrief(
  brief: SearchBrief,
  provenance: BriefProvenance,
): SearchBrief {
  return { ...brief, provenance: mergeProvenance(brief.provenance, provenance) };
}
