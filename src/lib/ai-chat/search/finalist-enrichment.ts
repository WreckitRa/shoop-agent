/**
 * Query-time deep fetch for tier-judge finalists.
 *
 * Verify calls `get_product` with buyer `selected` options — good for stock/price,
 * but the judge only sees a narrowed variant slice. One parallel round on the top
 * N finalists (no selected) restores full description, materials, variant matrix,
 * size chart, shipping, and review snippets for judgment.
 */
import {
  getProduct,
  type CatalogProductDetail,
  type CatalogSearchContext,
} from "@/lib/shopify/catalog";
import type { CatalogMcpExchange } from "@/lib/shopify/catalog-mcp-audit";
import { FINALIST_ENRICHMENT_LIMIT } from "../constants";
import { logAiChat } from "../observability";
import type { VerifiedCandidate } from "./verify";

export type FinalistEnrichmentParams = {
  accessToken: string;
  verified: VerifiedCandidate[];
  limit?: number;
  shipsToCountry?: string;
  context?: CatalogSearchContext;
  signal?: AbortSignal;
  concurrency?: number;
  onMcpExchange?: (exchange: CatalogMcpExchange) => void;
};

export type FinalistEnrichmentResult = {
  verified: VerifiedCandidate[];
  attempted: number;
  enriched: number;
  latencyMs: number;
};

async function deepFetchOne(
  accessToken: string,
  candidate: VerifiedCandidate,
  params: Omit<FinalistEnrichmentParams, "verified" | "limit" | "concurrency">,
): Promise<CatalogProductDetail | null> {
  try {
    const { product } = await getProduct(accessToken, candidate.product.id, [], {
      filters: {
        available: false,
        ...(params.shipsToCountry
          ? { ships_to: { country: params.shipsToCountry } }
          : {}),
      },
      context: params.context,
      signal: params.signal,
      onMcpExchange: params.onMcpExchange,
    });
    return product ?? null;
  } catch (err) {
    logAiChat("warn", "finalist_enrich_failed", {
      productId: candidate.product.id,
      error: String(err).slice(0, 160),
    });
    return null;
  }
}

/**
 * Attach `judgeDetail` on each finalist — full catalog payload for prompt formatting.
 * Verify fields (availability, resolved price, checkout URL) stay untouched.
 */
export async function enrichFinalistsForJudgment(
  params: FinalistEnrichmentParams,
): Promise<FinalistEnrichmentResult> {
  const started = Date.now();
  const limit = Math.min(
    params.limit ?? FINALIST_ENRICHMENT_LIMIT,
    params.verified.length,
  );
  if (limit <= 0) {
    return {
      verified: params.verified,
      attempted: 0,
      enriched: 0,
      latencyMs: 0,
    };
  }

  const targets = params.verified.slice(0, limit);
  const concurrency = Math.max(1, params.concurrency ?? 6);
  const judgeDetailById = new Map<string, CatalogProductDetail>();
  let cursor = 0;

  while (cursor < targets.length) {
    const batch = targets.slice(cursor, cursor + concurrency);
    cursor += batch.length;
    const results = await Promise.all(
      batch.map((candidate) =>
        deepFetchOne(params.accessToken, candidate, params).then((detail) => ({
          id: candidate.product.id,
          detail,
        })),
      ),
    );
    for (const { id, detail } of results) {
      if (detail) judgeDetailById.set(id, detail);
    }
  }

  const verified = params.verified.map((vc) => {
    const judgeDetail = judgeDetailById.get(vc.product.id);
    return judgeDetail ? { ...vc, judgeDetail } : vc;
  });

  const enriched = judgeDetailById.size;
  const latencyMs = Date.now() - started;
  logAiChat("info", "finalist_enrichment_complete", {
    attempted: targets.length,
    enriched,
    latencyMs,
  });

  return {
    verified,
    attempted: targets.length,
    enriched,
    latencyMs,
  };
}
