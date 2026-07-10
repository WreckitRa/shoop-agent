import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import { effectiveCorroboration } from "../pool-health";
import type { PoolCandidate } from "../types";
import type { TasteHypothesis } from "./types";
import { cosineSimilarity } from "../voyage";
import { candidateText } from "../scoring-internals";

export type SimilarScoringParams = {
  hypothesis: TasteHypothesis | null;
  seedPriceCents: number | null;
  seedVector?: number[] | null;
  differentiatorVectors?: Map<string, number[]>;
};

function literalDifferentiatorMatch(
  text: string,
  hypothesis: TasteHypothesis | null,
): number {
  if (!hypothesis?.differentiators.length) return 0.3;
  let score = 0;
  let weightSum = 0;
  for (const d of hypothesis.differentiators) {
    const tokens = d.attribute
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3);
    if (!tokens.length) continue;
    const hits = tokens.filter((t) => text.includes(t)).length / tokens.length;
    const w = d.weight * d.confidence;
    score += hits * w;
    weightSum += w;
  }
  return weightSum > 0 ? score / weightSum : 0.3;
}

function embeddingDifferentiatorMatch(
  upid: string,
  vec: number[] | undefined,
  params: SimilarScoringParams,
): number {
  const { hypothesis, differentiatorVectors } = params;
  if (!hypothesis?.differentiators.length || !vec?.length || !differentiatorVectors) {
    return 0;
  }
  let score = 0;
  let weightSum = 0;
  for (const d of hypothesis.differentiators) {
    const dv = differentiatorVectors.get(d.attribute.toLowerCase());
    if (!dv?.length) continue;
    const cos = (cosineSimilarity(vec, dv) + 1) / 2;
    const w = d.weight * d.confidence;
    score += cos * w;
    weightSum += w;
  }
  return weightSum > 0 ? score / weightSum : 0;
}

function seedSimilarityScore(
  vec: number[] | undefined,
  seedVector: number[] | null | undefined,
): number {
  if (!vec?.length || !seedVector?.length) return 0.4;
  return (cosineSimilarity(vec, seedVector) + 1) / 2;
}

export function similarRelPrior(
  c: PoolCandidate,
  params: SimilarScoringParams,
  candidateVectors?: Map<string, number[]>,
): number {
  const text = candidateText(c.product);
  const vec = candidateVectors?.get(c.upid);
  const diffLiteral = literalDifferentiatorMatch(text, params.hypothesis);
  const diffEmbed = embeddingDifferentiatorMatch(c.upid, vec, params);
  const diffScore = 0.55 * diffLiteral + 0.45 * (diffEmbed || diffLiteral);
  const seedSim = seedSimilarityScore(vec, params.seedVector);
  const decay = 1 / (1 + c.bestRank * 0.12);
  const corroborationBonus =
    Math.min(effectiveCorroboration(c) - 1, 3) * 0.06;
  const blended =
    0.62 * diffScore + 0.23 * seedSim + 0.15 * Math.max(decay, corroborationBonus);
  return Math.max(0, Math.min(1, blended));
}

/** Anchor-relative price band around the seed's price. */
export function similarValueScore(
  priceCents: number | null,
  seedPriceCents: number | null,
): number {
  if (priceCents == null || seedPriceCents == null || seedPriceCents <= 0) {
    return 0.55;
  }
  const ratio = priceCents / seedPriceCents;
  if (ratio >= 0.75 && ratio <= 1.35) return 1;
  if (ratio >= 0.55 && ratio <= 1.6) return 0.65;
  if (ratio >= 0.4 && ratio <= 2) return 0.35;
  return 0.15;
}

export function seedEmbeddingText(product: CatalogProductSummary): string {
  const parts: string[] = [product.title ?? ""];
  for (const a of extractCatalogAttributes(product)) {
    parts.push(a.name, a.value);
  }
  return parts.join(" ").slice(0, 400);
}
