import type { ColorBucket } from "../normalize/types";
import type { PaletteSource } from "../search-planner/palette-ladder";

export type PaletteMatch = "in" | "partial" | "out";

type KeywordRule = { pattern: RegExp; buckets: ColorBucket[] };

const PALETTE_KEYWORD_RULES: KeywordRule[] = [
  { pattern: /\bblack\b/, buckets: ["black"] },
  { pattern: /\bnavy\b/, buckets: ["navy"] },
  { pattern: /\bcharcoal\b/, buckets: ["grey", "black"] },
  { pattern: /\bwhite\b/, buckets: ["white"] },
  { pattern: /\bgrey\b|\bgray\b/, buckets: ["grey"] },
  { pattern: /\bbeige\b|\bsand\b|\btan\b|\boat\b|\becru\b/, buckets: ["beige"] },
  { pattern: /\blight neutral/, buckets: ["beige", "white", "grey"] },
  { pattern: /\bdark neutral/, buckets: ["black", "navy", "grey"] },
  { pattern: /\bneutral/, buckets: ["grey", "beige", "white", "black", "navy"] },
  { pattern: /\bmonochrome/, buckets: ["black", "white", "grey"] },
  { pattern: /\bsoft blue\b|\blight blue\b|\bblue\b/, buckets: ["blue", "navy"] },
  { pattern: /\bbrown\b|\bearth\b|\bkhaki\b/, buckets: ["brown", "beige", "olive"] },
  { pattern: /\bolive\b|\barmy\b/, buckets: ["olive", "green"] },
  { pattern: /\bgreen\b/, buckets: ["green", "olive"] },
  { pattern: /\bred\b|\bburgundy\b|\bwine\b/, buckets: ["red", "burgundy"] },
  { pattern: /\bpink\b|\blush\b/, buckets: ["pink"] },
  { pattern: /\bdenim\b/, buckets: ["denim", "blue"] },
];

const BROAD_NEUTRAL_BUCKETS: ColorBucket[] = [
  "grey",
  "beige",
  "white",
  "black",
  "navy",
  "brown",
  "blue",
];

export function allowedBucketsForConstraint(constraint: string): Set<ColorBucket> {
  const out = new Set<ColorBucket>();
  const lower = constraint.toLowerCase();
  for (const rule of PALETTE_KEYWORD_RULES) {
    if (rule.pattern.test(lower)) {
      for (const b of rule.buckets) out.add(b);
    }
  }
  if (!out.size && /neutral|palette|tone|family/i.test(lower)) {
    for (const b of BROAD_NEUTRAL_BUCKETS) out.add(b);
  }
  return out;
}

export function paletteMatch(
  buckets: ColorBucket[],
  constraint: string,
): PaletteMatch {
  if (!buckets.length) return "out";
  const allowed = allowedBucketsForConstraint(constraint);
  if (!allowed.size) return "partial";

  const inPalette = buckets.filter((b) => allowed.has(b));
  if (inPalette.length === buckets.length) return "in";
  if (inPalette.length > 0) return "partial";
  return "out";
}

const PALETTE_SCORE_BY_SOURCE: Record<
  Exclude<PaletteSource, "spread">,
  Record<PaletteMatch, number>
> = {
  stated: { in: 1.0, partial: 0.7, out: 0.1 },
  profile: { in: 1.0, partial: 0.7, out: 0.3 },
  occasion_default: { in: 1.0, partial: 0.75, out: 0.5 },
};

export function paletteComponentScore(params: {
  buckets: ColorBucket[];
  colorStatus: "resolved" | "unknown";
  constraint: string;
  source: PaletteSource;
}): number {
  if (params.source === "spread") return 0.5;
  if (params.colorStatus === "unknown") return 0.5;
  const match = paletteMatch(params.buckets, params.constraint);
  return PALETTE_SCORE_BY_SOURCE[params.source][match];
}
