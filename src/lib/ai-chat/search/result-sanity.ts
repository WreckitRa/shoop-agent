/**
 * Pre-render sanity checks (search hardening combined guard).
 */
import { titleTokenSimilarity } from "./query-diversity";
import type { CuratedPick } from "../types";
import type { SearchBrief } from "./types";
import type { VerifiedCandidate } from "./verify";

export type SanityReport = {
  ok: boolean;
  reasons: string[];
};

function isGiftArchetype(brief: SearchBrief): boolean {
  return brief.archetype === "gift_directed" || brief.archetype === "gift_vague";
}

/** True when picks span multiple distinct product types (not one cluster). */
export function picksSpanMultipleProductTypes(picks: CuratedPick[]): boolean {
  if (picks.length <= 1) return true;
  const titles = picks.map((p) => p.title);
  for (let i = 0; i < titles.length; i++) {
    for (let j = i + 1; j < titles.length; j++) {
      if (titleTokenSimilarity(titles[i]!, titles[j]!) < 0.45) return true;
    }
  }
  return false;
}

function sellerCounts(picks: CuratedPick[], verified: VerifiedCandidate[]): Map<string, number> {
  const domainByUpid = new Map(verified.map((v) => [v.upid, v.sellerDomain]));
  const counts = new Map<string, number>();
  for (const p of picks) {
    const upid = (p as CuratedPick & { upid?: string }).upid;
    const domain = upid ? domainByUpid.get(upid) : null;
    if (!domain) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return counts;
}

function priceSpreadReasonable(
  verified: VerifiedCandidate[],
  brief: SearchBrief,
): boolean {
  if (!isGiftArchetype(brief) || brief.budget.amountCents == null) return true;
  const prices = verified
    .map((v) => v.resolvedPriceCents)
    .filter((p): p is number => p != null);
  if (prices.length < 2) return true;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max <= min) return false;
  const floor = brief.budget.amountCents * 0.35;
  const aboveFloor = prices.filter((p) => p >= floor).length;
  return aboveFloor >= Math.ceil(prices.length * 0.3);
}

export function evaluateResultSanity(params: {
  brief: SearchBrief;
  picks: CuratedPick[];
  verified: VerifiedCandidate[];
}): SanityReport {
  const reasons: string[] = [];
  const { brief, picks, verified } = params;

  if (isGiftArchetype(brief) && picks.length >= 2 && !picksSpanMultipleProductTypes(picks)) {
    reasons.push("gift picks lack product-type diversity");
  }

  for (const [domain, n] of sellerCounts(picks, verified)) {
    if (n > 2) reasons.push(`seller ${domain} appears ${n} times`);
  }

  if (!priceSpreadReasonable(verified, brief)) {
    reasons.push("prices clustered at gift budget floor");
  }

  return { ok: reasons.length === 0, reasons };
}
