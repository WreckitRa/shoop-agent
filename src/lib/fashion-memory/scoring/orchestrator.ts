import { logAiChat } from "@/lib/ai-chat/observability";
import { recordPipelineEvent } from "../observability/trace";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import type { FashionFactRow } from "../types";
import type {
  FashionSlotCatalogProduct,
  FashionSlotCatalogResult,
} from "../catalog-search/types";
import {
  detectPriceOutlierLowSuspicions,
  isPaletteComponentActive,
  isSizeComponentActive,
  scoreProduct,
} from "./components";
import { detectAttireConflictTitle } from "./attire-conflict";
import { buildBestRankByProductId, bestRankForProduct } from "./rank";
import type { ScoringMetrics } from "./types";
import type { ProductSuspicion } from "../hard-drops/types";

function percentileOfScores(scores: number[], p: number): number {
  if (!scores.length) return 0;
  const sorted = [...scores].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * (sorted.length - 1))),
  );
  return sorted[idx]!;
}

function stableSortProducts(
  products: FashionSlotCatalogProduct[],
): FashionSlotCatalogProduct[] {
  return products
    .map((product, index) => ({ product, index }))
    .sort((a, b) => {
      const fa = a.product.score?.final ?? 0;
      const fb = b.product.score?.final ?? 0;
      if (fb !== fa) return fb - fa;
      const ra = a.product.score?.components.shopify_rank ?? 0;
      const rb = b.product.score?.components.shopify_rank ?? 0;
      if (rb !== ra) return rb - ra;
      return a.index - b.index;
    })
    .map(({ product }) => product);
}

export function scoreSlotProducts(params: {
  slot: FashionSearchPlanSlot;
  brief: FashionSearchBrief;
  recipientFacts: FashionFactRow[];
  products: FashionSlotCatalogProduct[];
  queryLogs: FashionSlotCatalogResult["query_logs"];
}): { products: FashionSlotCatalogProduct[]; metrics: ScoringMetrics } {
  const started = Date.now();
  const inputIds = params.products.map((p) => p.id);
  const rankMap = buildBestRankByProductId(params.queryLogs);
  const priceOutliers = detectPriceOutlierLowSuspicions(params.products);

  const scored = params.products.map((product) => {
    const extra = priceOutliers.get(product.id);
    const attire = detectAttireConflictTitle({
      title: product.title ?? "",
      garment: params.slot.garment,
    });
    const extras: ProductSuspicion[] = [
      ...(extra ? [extra] : []),
      ...(attire ? [attire] : []),
    ];
    const suspicions = extras.length
      ? [...(product.suspicions ?? []), ...extras]
      : product.suspicions;

    const withSuspicions = extras.length ? { ...product, suspicions } : product;
    const score = scoreProduct({
      product: withSuspicions,
      slot: params.slot,
      brief: params.brief,
      recipientFacts: params.recipientFacts,
      bestRank: bestRankForProduct(product.id, rankMap),
      extraSuspicions: extras.length ? extras : undefined,
    });

    return { ...withSuspicions, score };
  });

  const products = stableSortProducts(scored);
  const finals = products.map((p) => p.score!.final);
  const sizeActive = isSizeComponentActive(
    params.brief,
    params.slot.garment,
    params.recipientFacts,
  );
  const paletteActive = isPaletteComponentActive(params.slot);

  const metrics: ScoringMetrics = {
    products: products.length,
    score_distribution: {
      p10: percentileOfScores(finals, 0.1),
      p50: percentileOfScores(finals, 0.5),
      p90: percentileOfScores(finals, 0.9),
    },
    component_coverage: {
      rated: products.filter(
        (p) =>
          p.rating_value != null &&
          p.review_count != null &&
          p.review_count > 0,
      ).length,
      size_confirmed: sizeActive
        ? products.filter((p) => p.score?.components.size_confirmed === 1).length
        : 0,
      palette_active: paletteActive,
      with_shopify_rank: products.filter((p) => rankMap.has(p.id)).length,
    },
    ms: Date.now() - started,
  };

  const outputIds = products.map((p) => p.id);
  if (inputIds.length !== outputIds.length) {
    logAiChat("error", "fashion_scoring_length_mismatch", {
      slot_id: params.slot.slot_id,
      in: inputIds.length,
      out: outputIds.length,
    });
  }

  return { products, metrics };
}

export function scoreCatalogSlots<T extends FashionSlotCatalogResult>(params: {
  traceId?: string | null;
  planSlots: FashionSearchPlanSlot[];
  brief: FashionSearchBrief;
  recipientFacts: FashionFactRow[];
  slots: T[];
}): { slots: T[]; metrics: ScoringMetrics[] } {
  const metrics: ScoringMetrics[] = [];

  for (const slot of params.slots) {
    const planSlot =
      params.planSlots.find((s) => s.slot_id === slot.slot_id) ??
      params.planSlots.find((s) => s.garment === slot.garment);

    if (!planSlot) {
      metrics.push({
        products: slot.products.length,
        score_distribution: { p10: 0, p50: 0, p90: 0 },
        component_coverage: {
          rated: 0,
          size_confirmed: 0,
          palette_active: false,
          with_shopify_rank: 0,
        },
        ms: 0,
      });
      continue;
    }

    const result = scoreSlotProducts({
      slot: planSlot,
      brief: params.brief,
      recipientFacts: params.recipientFacts,
      products: slot.products,
      queryLogs: slot.query_logs,
    });

    slot.products = result.products;

    recordPipelineEvent({
      traceId: params.traceId,
      stage: "scoring",
      payload: {
        slot_id: slot.slot_id,
        garment: slot.garment,
        ...result.metrics,
      },
    });

    const finals = result.products.map((p) => p.score?.final ?? 0);
    const uniqueScores = new Set(finals.map((f) => f.toFixed(4)));
    if (result.products.length > 1 && uniqueScores.size === 1) {
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "invariant_warning",
        payload: {
          kind: "scoring_identical_scores",
          slot_id: slot.slot_id,
          score: finals[0],
          products: result.products.length,
        },
      });
      logAiChat("warn", "fashion_scoring_identical_scores", {
        slot_id: slot.slot_id,
        products: result.products.length,
      });
    }

    const top10 = result.products.slice(0, 10);
    const suspiciousTop = top10.filter((p) => (p.suspicions?.length ?? 0) > 0);
    if (
      top10.length >= 4 &&
      suspiciousTop.length / top10.length > 0.5
    ) {
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "invariant_warning",
        payload: {
          kind: "scoring_top10_suspicious",
          slot_id: slot.slot_id,
          suspicious: suspiciousTop.length,
          top10: top10.length,
        },
      });
    }

    metrics.push(result.metrics);
  }

  return { slots: params.slots, metrics };
}
