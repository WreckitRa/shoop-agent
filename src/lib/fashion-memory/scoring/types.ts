import type { ScoringComponentKey } from "./weights";

export type ScoreComponents = Record<ScoringComponentKey, number>;

export type ProductScore = {
  final: number;
  components: ScoreComponents;
  active_components: ScoringComponentKey[];
  penalties_applied: number;
  weights_version: string;
};

export type ScoringMetrics = {
  products: number;
  score_distribution: { p10: number; p50: number; p90: number };
  component_coverage: {
    rated: number;
    size_confirmed: number;
    palette_active: boolean;
    with_shopify_rank: number;
  };
  ms: number;
};
