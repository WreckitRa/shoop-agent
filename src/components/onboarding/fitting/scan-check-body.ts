import type { StylePhotoAnalysis } from "@/lib/photo-analysis/result";
import type {
  BodyShapeBand,
  BuildBand,
  MuscularityBand,
} from "@/lib/tryon/types";
import { resolveVisualDefinition } from "./bodySilhouetteGeometry";
import type { FittingPhotoValues } from "./FittingPhotoStep";
import type { BuildKey } from "./types";

export type ScanCheckBody = {
  build: BuildKey;
  muscularity: MuscularityBand;
  bodyShape: BodyShapeBand | null;
};

const BUILDS = new Set<BuildKey>([
  "slim",
  "average",
  "athletic",
  "broad",
  "plus",
]);
const MUSCLES = new Set<MuscularityBand>(["low", "moderate", "high"]);
const SHAPES = new Set<BodyShapeBand>([
  "rectangle",
  "triangle",
  "inverted_triangle",
  "hourglass",
  "oval",
]);

function textOf(
  analysis: StylePhotoAnalysis | null | undefined,
  key: keyof StylePhotoAnalysis["visible_profile"]["body_proportions"],
): string {
  return analysis?.visible_profile?.body_proportions?.[key]?.value?.trim() ?? "";
}

export function mapBuildFromText(raw: string): BuildKey | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (BUILDS.has(t as BuildKey)) return t as BuildKey;
  if (/\b(plus|curvy|fuller|large|heavy)\b/.test(t)) return "plus";
  if (/\b(athletic|muscular|sporty)\b/.test(t)) return "athletic";
  if (/\b(broad|stocky|wide frame|wide-frame)\b/.test(t)) return "broad";
  if (/\b(slim|slender|narrow|thin|lean)\b/.test(t)) return "slim";
  if (/\b(average|medium|regular|typical)\b/.test(t)) return "average";
  return null;
}

export function mapMuscularityFromText(raw: string): MuscularityBand | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (MUSCLES.has(t as MuscularityBand)) return t as MuscularityBand;
  if (/high|defined|ripped|muscular|strong/.test(t)) return "high";
  if (/low|soft|none|untoned|relaxed/.test(t)) return "low";
  if (/mod|tone|light|decent|some/.test(t)) return "moderate";
  return null;
}

export function mapBodyShapeFromText(raw: string): BodyShapeBand | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!t) return null;
  if (SHAPES.has(t as BodyShapeBand)) return t as BodyShapeBand;
  if (t.includes("hour")) return "hourglass";
  if (t.includes("invert")) return "inverted_triangle";
  if (t.includes("triangle") || t.includes("pear")) return "triangle";
  if (t.includes("rect") || t.includes("straight")) return "rectangle";
  if (t.includes("oval") || t.includes("apple")) return "oval";
  return null;
}

export function inferBodyFromPhotoAnalysis(
  analysis: StylePhotoAnalysis | null | undefined,
): {
  build: BuildKey | null;
  muscularity: MuscularityBand | null;
  bodyShape: BodyShapeBand | null;
} {
  return {
    build:
      mapBuildFromText(textOf(analysis, "visual_frame")) ??
      mapBuildFromText(textOf(analysis, "body_shape_summary")),
    muscularity: mapMuscularityFromText(
      textOf(analysis, "visible_muscular_distribution"),
    ),
    bodyShape: mapBodyShapeFromText(textOf(analysis, "body_shape_summary")),
  };
}

/**
 * CHECK chips: Fit selection wins, then photo inference, then the same
 * visual defaults the twin already uses. Does not invent a Shape.
 */
export function resolveScanCheckBody(
  values: Pick<FittingPhotoValues, "build" | "muscularity" | "bodyShape">,
  analysis?: StylePhotoAnalysis | null,
): ScanCheckBody {
  const inferred = inferBodyFromPhotoAnalysis(analysis);
  const build =
    values.build ?? inferred.build ?? ("average" satisfies BuildBand);
  const muscularity =
    values.muscularity ?? resolveVisualDefinition(build, null);
  const bodyShape = values.bodyShape ?? inferred.bodyShape ?? null;
  return { build, muscularity, bodyShape };
}
