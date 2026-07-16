import type { HydratedCandidate } from "./types";
import type { HydrateCandidateParams } from "./hydrate-candidate";
import { hydrateCandidate } from "./hydrate-candidate";
import { verifyTtlMs } from "./pool-lifecycle-config";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";

export function isHydrationStale(candidate: HydratedCandidate): boolean {
  if (!candidate.hydrated_at) return true;
  const age = Date.now() - new Date(candidate.hydrated_at).getTime();
  return age > verifyTtlMs();
}

export type ReverificationResult =
  | { ok: true; candidate: HydratedCandidate }
  | { ok: false; soldOut: true; productId: string }
  | { ok: false; soldOut: false; productId: string };

/** One fresh get_product re-verify via the tier-3 on-demand path. */
export async function reverifyCandidate(params: {
  candidate: HydratedCandidate;
  hydrateParams: Omit<HydrateCandidateParams, "product">;
  hydrateFn?: (
    p: HydrateCandidateParams,
  ) => Promise<import("./types").HydrateCandidateResult>;
}): Promise<ReverificationResult> {
  const product: FashionSlotCatalogProduct = {
    ...params.candidate,
    raw: params.candidate.raw ?? ({ id: params.candidate.id } as FashionSlotCatalogProduct["raw"]),
  };
  const hydrate =
    params.hydrateFn ??
    ((p: HydrateCandidateParams) => hydrateCandidate(p));
  const result = await hydrate({
    ...params.hydrateParams,
    product,
  });
  if (result.outcome === "verified") {
    return { ok: true, candidate: result.candidate };
  }
  const soldOut =
    result.death.cause === "size_out_of_stock" ||
    result.death.cause === "gone" ||
    result.death.cause === "size_not_offered";
  return { ok: false, soldOut, productId: params.candidate.id };
}

export const STALE_SOLD_OUT_LINE =
  "That one just sold out in this size — here's the next strongest option.";
