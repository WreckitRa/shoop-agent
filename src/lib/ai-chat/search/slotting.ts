/**
 * Stage 5 — Slotting & Presentation (docs/search-improvements.md §11).
 *
 * Turns verified, ranked candidates into labeled `CuratedPick`s: a hero
 * (shop_pick, with a fast-Haiku hook), best_value, most_popular, gem, plus a
 * gallery. For gift_diversity we apply MMR so the directions/styles vary.
 * Honest caveat lines (budget overage, small shop, relaxed match) are attached.
 */
import {
  extractCatalogAttributes,
} from "@/lib/shopify/catalog-attributes";
import {
  extractCatalogImageUrl,
  parseCatalogRating,
  resolvePurchasableVariant,
  type CatalogProductDetail,
  type CatalogSearchContext,
} from "@/lib/shopify/catalog";
import { createLightweightMessage } from "../anthropic";
import {
  AI_CHAT_LIGHTWEIGHT_MODEL,
  AI_CHAT_TIER_JUDGE_TIMEOUT_MS,
  TIER_JUDGE_CANDIDATE_LIMIT,
} from "../constants";
import type { TierOneSelfCheck } from "../judgment/tier-one-self-check";
import { buildHeuristicInsight, type VerificationFacts } from "../curation/pick-insight";
import {
  logReasonViolation,
  thinSetCaveat,
  validatePickReason,
  verdictForTierPlacement,
} from "../judgment/reason-validation";
import {
  runTierJudgeComparePhase,
  runTierJudgeTriagePhase,
  selectFinalistsForCompare,
  type TierJudgeOmission,
  type TierPlacement,
  type TriageVerdict,
  type HeadToHeadComparison,
} from "../judgment/tier-judge";
import { startFinalistImagePrefetch } from "../judgment/finalist-images";
import { buildShoppingMemoryPromptXml } from "../shopping-memory/context";
import { logAiChat } from "../observability";
import type { CuratedPick, CurationSlot, ProductCard } from "../types";
import {
  headToHeadRowsForDebug,
  pipelineProductFromVerified,
  type PipelineFallbackRow,
  type PipelineListingHygieneRow,
  type PipelineSlotRow,
  type PipelineSlotSource,
  type PipelineTriageRow,
  type SlottingPipelineDebug,
  explainSlotAssignment,
  slotRowsFromCuratedPicks,
} from "./pipeline-debug";
import { enrichFinalistsForJudgment } from "./finalist-enrichment";
import { budgetOverageCaveat, judgePriceAgainstBudget } from "./budget";
import {
  isAnchorBrandProduct,
} from "./brand-anchors";
import {
  applyListingHygieneGate,
  attachListingHygieneToVerified,
} from "./listing-hygiene";
import {
  enforceRackBrandComposition,
} from "./rack-composition";
import {
  applyConstraintGate,
  colorConstraintViolation,
  genderConstraintViolation,
  mustHaveColorViolation,
  violatesStructuredConstraints,
  type ConstraintGateDrop,
} from "./constraint-gate";
import {
  eligibleForBestValue,
  eligibleForGem,
  eligibleForMostPopular,
  eligibleForShopPick,
  curatedVerifiedFromPlacements,
  isNearDuplicateOfUsed,
} from "./slot-eligibility";
import type { SearchBrief } from "./types";
import type { VerifiedCandidate } from "./verify";

function priceRangeFromDetail(
  detail: CatalogProductDetail,
): ProductCard["priceRange"] {
  const prices = (detail.variants ?? [])
    .map((v) => v.price)
    .filter((p): p is { amount: number; currency: string } => Boolean(p));
  if (!prices.length) return undefined;
  let min = prices[0]!;
  let max = prices[0]!;
  for (const p of prices) {
    if (p.amount < min.amount) min = p;
    if (p.amount > max.amount) max = p;
  }
  return { min, max };
}

function cardFromVerified(vc: VerifiedCandidate): ProductCard {
  const detail = vc.detail;
  const variant = resolvePurchasableVariant(detail) ?? detail.variants?.[0];
  const imageUrl =
    (variant && extractCatalogImageUrl(variant)) ||
    extractCatalogImageUrl(detail) ||
    undefined;
  const catalogAttributes = extractCatalogAttributes(detail);
  const card: ProductCard = {
    id: detail.id,
    title: detail.title,
    priceRange: priceRangeFromDetail(detail),
    options: detail.options?.map((o) => ({
      name: o.name,
      values: o.values.map((v) => ({ label: v.label })),
    })),
    imageUrl: imageUrl ?? undefined,
    preferredOptions: vc.resolvedOptions.map((o) => ({
      name: o.name,
      label: o.label,
    })),
    availability: vc.availability,
    rating: parseCatalogRating(detail.rating),
    catalogAttributes,
  };
  if (variant?.id) {
    card.featuredVariant = {
      id: variant.id,
      price: variant.price,
      checkoutUrl: variant.checkout_url,
      options: vc.resolvedOptions,
    };
  }
  if (vc.resolvedPriceCents != null) {
    const currency =
      variant?.price?.currency ?? vc.detail.variants?.[0]?.price?.currency ?? "USD";
    card.displayPrice = { amount: vc.resolvedPriceCents, currency };
  }
  return card;
}

function caveatFor(vc: VerifiedCandidate, brief: SearchBrief): string | undefined {
  const isGift =
    brief.archetype === "gift_directed" || brief.archetype === "gift_vague";
  const verdict = judgePriceAgainstBudget(vc.resolvedPriceCents, brief.budget, {
    isGift,
  });
  if (verdict.over && verdict.overageFraction > 0) {
    return budgetOverageCaveat(verdict.overageFraction);
  }
  if (vc.relaxedNote) return vc.relaxedNote;
  if (vc.availability.sizeNeedsVerification) {
    return "Verify size before buying — merchant label didn't map cleanly";
  }
  if (vc.loosened) return "Shown after relaxing your budget/filters";
  const reviews = parseCatalogRating(vc.detail.rating)?.count ?? 0;
  if (reviews > 0 && reviews < 10) return "Small shop · fewer reviews";
  return undefined;
}

const FALLBACK_SLOT_REASON: Record<CurationSlot, string> = {
  shoop_pick: "Solid option among what's available — compare attributes below",
  best_value: "Best price-to-quality among the curated finalists",
  most_popular: "Most-reviewed option among the curated finalists",
  gem: "High ratings from a smaller shop — worth a look",
  gallery: "Alternative direction worth comparing",
  loosened: "Surfaced after relaxing your budget or filters",
  reframed: "From a broader take on your search",
};

function reasonContextFromVerified(vc: VerifiedCandidate) {
  const card = cardFromVerified(vc);
  return {
    title: card.title,
    attributes: card.catalogAttributes,
    options: card.options,
    productId: card.id,
  };
}

function candidateTextFromDetail(detail: CatalogProductDetail): string {
  return [detail.title ?? "", ...(detail.options ?? []).flatMap((o) => o.values.map((v) => v.label))]
    .join(" ")
    .toLowerCase();
}

function verificationFactsFor(
  vc: VerifiedCandidate,
  brief: SearchBrief,
): VerificationFacts {
  const text = candidateTextFromDetail(vc.detail);
  const hasColorReq = Boolean(
    brief.variantConstraints?.color?.trim() ||
      brief.mustHaves.some((m) => /black|white|navy|beige|olive/i.test(m)),
  );
  const hasSizeReq = Boolean(brief.variantConstraints?.size?.trim());
  const hasGenderReq =
    brief.recipient.kind === "self" &&
    (brief.genderScope === "mens" || brief.genderScope === "womens");
  const colorOk =
    !colorConstraintViolation(brief, text) && !mustHaveColorViolation(brief, text);
  const genderOk = !genderConstraintViolation(brief, text);
  return {
    priceVerified: true,
    sizeExactMatch: hasSizeReq ? vc.exactMatch : null,
    colorGatePassed: hasColorReq ? colorOk : null,
    genderGatePassed: hasGenderReq ? genderOk : null,
    candidateCount: 0,
  };
}

function buildPick(
  vc: VerifiedCandidate,
  slot: CurationSlot,
  brief: SearchBrief,
  candidateCount: number,
  reasonOverride?: string,
  opts?: {
    tier?: number;
    forceVerdict?: CuratedPick["verdict"];
    extraCaveat?: string;
    verificationFacts?: VerificationFacts;
    selfCheck?: TierOneSelfCheck;
  },
): CuratedPick {
  const card = cardFromVerified(vc);
  const rawReason = reasonOverride?.trim() || FALLBACK_SLOT_REASON[slot];
  const validation = validatePickReason(rawReason, {
    ...reasonContextFromVerified(vc),
    tier: opts?.tier,
    slot,
  });
  logReasonViolation(rawReason, { ...reasonContextFromVerified(vc), slot, tier: opts?.tier }, validation);

  let reason = rawReason;
  if (!validation.ok && slot === "shoop_pick") {
    reason =
      "Could not confirm a strong feature match — compare the attributes and image before buying.";
  }

  let caveat = caveatFor(vc, brief);
  if (opts?.extraCaveat) {
    caveat = caveat ? `${opts.extraCaveat} · ${caveat}` : opts.extraCaveat;
  }

  const isGift =
    brief.archetype === "gift_directed" || brief.archetype === "gift_vague";
  const overBudget = judgePriceAgainstBudget(
    vc.resolvedPriceCents,
    brief.budget,
    { isGift },
  ).over;

  const verdict =
    opts?.forceVerdict ??
    (overBudget
      ? "wait"
      : slot === "shoop_pick" && !validation.ok
        ? "wait"
        : slot === "shoop_pick"
          ? "buy"
          : slot === "best_value" || slot === "most_popular" || slot === "gem"
            ? validation.ok
              ? "buy"
              : "wait"
            : "wait");
  const insightSlot: "shoop_pick" | "best_value" | "most_popular" | "gallery" =
    slot === "best_value" || slot === "most_popular" || slot === "shoop_pick"
      ? slot
      : "gallery";
  const facts = opts?.verificationFacts ?? verificationFactsFor(vc, brief);
  facts.candidateCount = candidateCount;
  const insight = opts?.selfCheck
    ? buildHeuristicInsight(card, candidateCount, insightSlot, reason, facts, opts.selfCheck)
    : buildHeuristicInsight(card, candidateCount, insightSlot, reason, facts);
  return {
    ...card,
    slot,
    reason,
    verdict,
    insight,
    caveat,
    upid: vc.upid,
    nativeCheckoutUrl: vc.nativeCheckoutUrl ?? undefined,
    sourceEngine: "engine",
    score: vc.score,
    directionLabel: vc.directionLabel,
    tier: opts?.tier,
  } as CuratedPick & { directionLabel?: string; tier?: number };
}

/** Fast-Haiku hook for the hero pick (~1 sentence). Degrades to deterministic. */
export async function craftShopPickReason(
  hero: VerifiedCandidate,
  brief: SearchBrief,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<string | undefined> {
  const timeoutMs = options?.timeoutMs ?? 2500;
  const attrs = extractCatalogAttributes(hero.detail);
  const attrLine = attrs.map((a) => `${a.name}: ${a.value}`).join("; ");
  const prompt = JSON.stringify({
    task:
      "Write ONE short sentence (max 20 words) on why this product fits the shopper. MUST name at least one concrete product feature (material, color, style, sole, silhouette). Never say top-ranked or best match. No markdown, no quotes.",
    shopper_wants: brief.query,
    must_haves: brief.mustHaves,
    product: hero.detail.title,
    attributes: attrLine || null,
    price_cents: hero.resolvedPriceCents,
  });
  const call = createLightweightMessage(
    {
      model: AI_CHAT_LIGHTWEIGHT_MODEL,
      max_tokens: 60,
      messages: [{ role: "user", content: prompt }],
    },
    { signal: options?.signal },
  );
  const winner = await Promise.race([
    call.then((m) =>
      m.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim(),
    ),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ]).catch(() => undefined);
  if (!winner) return undefined;
  return winner.replace(/^["']|["']$/g, "").slice(0, 140);
}

/** Max picks from the same seller in one result set. */
const MAX_PICKS_PER_SELLER = 2;

function sellerKey(vc: VerifiedCandidate): string | null {
  return vc.sellerDomain ?? null;
}

/** Cosine-free MMR diversity over candidate text (gift_diversity). */
function mmrOrder(
  candidates: VerifiedCandidate[],
  limit: number,
  lambda = 0.7,
): VerifiedCandidate[] {
  const tokensOf = (c: VerifiedCandidate) =>
    new Set(c.detail.title.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const selected: VerifiedCandidate[] = [];
  const pool = [...candidates];
  while (selected.length < limit && pool.length) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i]!;
      const rel = c.score;
      let maxSim = 0;
      const ct = tokensOf(c);
      for (const s of selected) {
        const st = tokensOf(s);
        let inter = 0;
        for (const t of ct) if (st.has(t)) inter += 1;
        const union = ct.size + st.size - inter || 1;
        maxSim = Math.max(maxSim, inter / union);
      }
      const val = lambda * rel - (1 - lambda) * maxSim;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    selected.push(pool.splice(bestIdx, 1)[0]!);
  }
  return selected;
}

export type SlottingResult = {
  picks: CuratedPick[];
  /** Plain product cards for all rendered candidates (curation footnotes). */
  products: ProductCard[];
  method: "tier_judge" | "score_heuristic";
  tierPlacements?: TierPlacement[];
  ruledOut?: ConstraintGateDrop[];
  tierJudgeFallback?: boolean;
  /** Set when tier judge did not complete — score heuristic is never used as fallback. */
  tierJudgeFailureReason?: "timeout_or_error" | "empty_placements" | "slotting_empty";
  tierJudgePrompt?: string;
  tierJudgeResult?: string;
  tierJudgeModel?: string;
  curationFallback: boolean;
  agenticRetryUsed?: boolean;
  agenticRetrySummary?: string;
  pipelineDebug?: SlottingPipelineDebug;
};

export type { SlottingPipelineDebug } from "./pipeline-debug";

/** Optional hook after wide triage — may expand the verified pool via one agentic refill wave. */
export type AfterTriageContext = {
  verified: VerifiedCandidate[];
  triage: TriageVerdict[];
  buyingRules: string[];
  preJudgeDrops: ConstraintGateDrop[];
  brief: SearchBrief;
  onNarration?: (line: string) => void;
};

export type AfterTriageResult = {
  verified: VerifiedCandidate[];
  summary?: string;
};

export type AfterTriageHook = (
  ctx: AfterTriageContext,
) => Promise<AfterTriageResult | null | undefined>;

export type TriageSkeletonPayload = {
  products: ProductCard[];
  curatedPicks: CuratedPick[];
};

/** Rack skeleton from wide triage — real cards, pending verdict copy until deep judge returns. */
export function buildTriageSkeletonPayload(params: {
  pool: VerifiedCandidate[];
  triage: TriageVerdict[];
  brief: SearchBrief;
  displayLimit: number;
  candidateCount: number;
}): TriageSkeletonPayload | null {
  const { pool, triage, brief, displayLimit, candidateCount } = params;
  const judgeCandidates = pool.slice(0, TIER_JUDGE_CANDIDATE_LIMIT);
  const finalists = selectFinalistsForCompare(judgeCandidates, triage);
  if (!finalists.length) return null;

  const triageById = new Map(triage.map((t) => [t.productId, t]));
  const picks: CuratedPick[] = [];
  const slots: CurationSlot[] = ["shoop_pick", "best_value", "most_popular", "gem"];
  for (let i = 0; i < Math.min(finalists.length, slots.length); i++) {
    const vc = finalists[i]!;
    const slot = slots[i]!;
    const note = triageById.get(vc.detail.id)?.note;
    picks.push(
      buildPick(vc, slot, brief, candidateCount, note ?? "Judging fit from photos…", {
        tier: 2,
        forceVerdict: "wait",
      }),
    );
  }
  for (let i = slots.length; i < Math.min(finalists.length, displayLimit); i++) {
    const vc = finalists[i]!;
    const note = triageById.get(vc.detail.id)?.note;
    picks.push(
      buildPick(vc, "gallery", brief, candidateCount, note ?? "Still comparing finalists…", {
        tier: 2,
        forceVerdict: "wait",
      }),
    );
  }

  return {
    products: pool.map((c) => cardFromVerified(c)),
    curatedPicks: picks,
  };
}

function judgeOmissionsToDrops(omissions: TierJudgeOmission[]): ConstraintGateDrop[] {
  return omissions.map((o) => ({
    productId: o.productId,
    title: o.title,
    reason: o.reason,
    gate: "judge_omission" as const,
  }));
}

function dropPlacementsByConstraints(params: {
  placements: TierPlacement[];
  pool: VerifiedCandidate[];
  brief: SearchBrief;
}): { kept: TierPlacement[]; ruledOut: ConstraintGateDrop[] } {
  const ruledOut: ConstraintGateDrop[] = [];
  const kept: TierPlacement[] = [];
  const byId = new Map(params.pool.map((v) => [v.detail.id, v]));

  for (const p of params.placements) {
    const vc = resolveCandidateByProductId(params.pool, p.productId);
    const product = vc?.detail ?? byId.get(p.productId)?.detail;
    if (!product) {
      kept.push(p);
      continue;
    }
    const violation = violatesStructuredConstraints(params.brief, product);
    if (violation) {
      ruledOut.push(violation);
      continue;
    }
    kept.push(p);
  }
  return { kept, ruledOut };
}

const CONFIDENCE_RANK: Record<TierPlacement["confidence"], number> = {
  strong: 3,
  moderate: 2,
  limited: 1,
};

function byIdMap(verified: VerifiedCandidate[]): Map<string, VerifiedCandidate> {
  return new Map(verified.map((v) => [v.detail.id, v]));
}

/** Resolve model product ids even when formatting differs from catalog GIDs. */
function resolveCandidateByProductId(
  pool: VerifiedCandidate[],
  productId: string,
): VerifiedCandidate | undefined {
  const byId = byIdMap(pool);
  const trimmed = productId.trim();
  const direct = byId.get(trimmed);
  if (direct) return direct;

  for (const vc of pool) {
    const id = vc.detail.id;
    if (id.endsWith(trimmed) || trimmed.endsWith(id)) return vc;
  }

  const numeric = trimmed.match(/(\d+)\s*$/)?.[1];
  if (numeric) {
    for (const vc of pool) {
      const id = vc.detail.id;
      if (id.endsWith(`/${numeric}`) || id.endsWith(numeric)) return vc;
    }
  }

  return undefined;
}

function buildListingHygieneRows(
  verified: VerifiedCandidate[],
  brief: SearchBrief,
  drops: ConstraintGateDrop[],
): PipelineListingHygieneRow[] {
  const dropById = new Map(drops.map((d) => [d.productId, d.reason]));
  const withHygiene = attachListingHygieneToVerified(verified, brief);
  return withHygiene.map((vc) => {
    const h = vc.listingHygiene!;
    const dropped = dropById.has(vc.detail.id);
    return {
      product: pipelineProductFromVerified(vc),
      quality: h.quality,
      flags: h.flags,
      notes: h.notes,
      dropped,
      dropReason: dropped ? dropById.get(vc.detail.id) : undefined,
    };
  });
}

function buildTriageRows(
  pool: VerifiedCandidate[],
  triage: TriageVerdict[],
): PipelineTriageRow[] {
  const byId = new Map(pool.map((v) => [v.detail.id, v]));
  return triage.map((t) => {
    const vc =
      byId.get(t.productId) ??
      pool.find(
        (v) =>
          v.detail.id.endsWith(t.productId) || t.productId.endsWith(v.detail.id),
      );
    return {
      product: vc
        ? pipelineProductFromVerified(vc)
        : {
            id: t.productId,
            title: t.productId,
            store: null,
            imageUrl: null,
          },
      verdict: t.verdict,
      note: t.note,
    };
  });
}

function buildSlottingPipelineDebug(params: {
  verified: VerifiedCandidate[];
  brief: SearchBrief;
  listingDrops: ConstraintGateDrop[];
  triage: TriageVerdict[];
  finalists: VerifiedCandidate[];
  headToHead: HeadToHeadComparison[];
  slots: PipelineSlotRow[];
  fallbacks: PipelineFallbackRow[];
  resolveId: (productId: string) => VerifiedCandidate | undefined;
}): SlottingPipelineDebug {
  return {
    listingHygiene: buildListingHygieneRows(
      params.verified,
      params.brief,
      params.listingDrops,
    ),
    triage: buildTriageRows(params.verified, params.triage),
    finalists: params.finalists.map((c) => pipelineProductFromVerified(c)),
    headToHead: headToHeadRowsForDebug(params.headToHead, (id) => {
      const vc = params.resolveId(id);
      return vc ? pipelineProductFromVerified(vc) : undefined;
    }),
    slots: params.slots,
    fallbacks: params.fallbacks,
  };
}

function assignSlotsFromTierJudgment(params: {
  verified: VerifiedCandidate[];
  placements: TierPlacement[];
  brief: SearchBrief;
  displayLimit: number;
  candidateCount: number;
  slotSource?: PipelineSlotSource;
  slotDebug?: PipelineSlotRow[];
}): SlottingResult | null {
  const { brief, displayLimit, candidateCount, placements } = params;
  const slotSource = params.slotSource ?? "tier_judge";
  const slotDebug = params.slotDebug ?? [];
  let pool = [...params.verified];
  if (brief.rankingProfile === "gift_diversity" && pool.length > displayLimit) {
    pool = mmrOrder(pool, Math.max(displayLimit, 6));
  }
  const byId = byIdMap(pool);
  const candidateFor = (productId: string) =>
    resolveCandidateByProductId(pool, productId) ?? byId.get(productId);
  const hasTier1 = placements.some((p) => p.tier === 1);
  const thinCaveat = thinSetCaveat(hasTier1, candidateCount);

  const sorted = [...placements].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
  });
  const curated = curatedVerifiedFromPlacements(
    pool,
    placements,
    resolveCandidateByProductId,
  );

  const used = new Set<string>();
  const usedCandidates: VerifiedCandidate[] = [];
  const sellerCounts = new Map<string, number>();
  const picks: CuratedPick[] = [];

  const canTakeSeller = (vc: VerifiedCandidate): boolean => {
    const key = sellerKey(vc);
    if (!key) return true;
    return (sellerCounts.get(key) ?? 0) < MAX_PICKS_PER_SELLER;
  };

  const take = (
    vc: VerifiedCandidate | undefined,
    slot: CurationSlot,
    reason: string,
    tier: number,
    confidence: TierPlacement["confidence"],
    selfCheck?: TierOneSelfCheck,
    source: PipelineSlotSource = slotSource,
  ) => {
    if (!vc || used.has(vc.upid)) return;
    if (isNearDuplicateOfUsed(vc, usedCandidates)) return;
    if (!canTakeSeller(vc)) return;

    const isGift =
      brief.archetype === "gift_directed" || brief.archetype === "gift_vague";
    const overBudget = judgePriceAgainstBudget(
      vc.resolvedPriceCents,
      brief.budget,
      { isGift },
    ).over;
    const validation = validatePickReason(reason, {
      ...reasonContextFromVerified(vc),
      tier,
      slot,
    });
    const verdict = verdictForTierPlacement({
      tier,
      confidence,
      reasonValid: validation.ok,
      hasTier1InSet: hasTier1,
      overBudget,
    });

    used.add(vc.upid);
    usedCandidates.push(vc);
    const key = sellerKey(vc);
    if (key) sellerCounts.set(key, (sellerCounts.get(key) ?? 0) + 1);

    picks.push(
      buildPick(vc, slot, brief, candidateCount, reason, {
        tier,
        forceVerdict: verdict,
        extraCaveat: slot === "shoop_pick" ? thinCaveat : undefined,
        selfCheck,
      }),
    );
    slotDebug.push({
      product: pipelineProductFromVerified(vc),
      slot,
      reason,
      whyHere: explainSlotAssignment({
        slot,
        source,
        tier,
        confidence,
        reason,
      }),
      source,
      tier,
      confidence,
    });
  };

  const tier12 = sorted.filter((p) => p.tier <= 2);
  const heroPlacementRow =
    sorted.find((p) => p.tier === 1) ?? sorted.find((p) => p.tier === 2);
  const heroCandidates = tier12.length ? tier12 : sorted;
  const heroPick =
    heroCandidates.find((p) => {
      const vc = candidateFor(p.productId);
      return vc && isAnchorBrandProduct(vc.detail, brief.query, brief.category);
    }) ?? heroPlacementRow;
  if (heroPick) {
    take(
      candidateFor(heroPick.productId),
      "shoop_pick",
      heroPick.reason,
      heroPick.tier,
      heroPick.confidence,
      heroPick.selfCheck,
    );
  }

  const remainingCurated = () =>
    curated.filter((c) => !used.has(c.upid));

  const byValue = [...remainingCurated()]
    .filter(eligibleForBestValue)
    .sort((a, b) => b.breakdown.value - a.breakdown.value);
  const valuePlacement = tier12.find(
    (p) => candidateFor(p.productId)?.upid === byValue[0]?.upid,
  );
  take(
    byValue[0],
    "best_value",
    valuePlacement?.reason ??
      FALLBACK_SLOT_REASON.best_value,
    valuePlacement?.tier ?? 2,
    valuePlacement?.confidence ?? "moderate",
  );

  const byPopular = [...remainingCurated()]
    .filter(eligibleForMostPopular)
    .sort(
      (a, b) =>
        (parseCatalogRating(b.detail.rating)?.count ?? 0) -
        (parseCatalogRating(a.detail.rating)?.count ?? 0),
    );
  const popPlacement = tier12.find(
    (p) => candidateFor(p.productId)?.upid === byPopular[0]?.upid,
  );
  take(
    byPopular[0],
    "most_popular",
    popPlacement?.reason ?? FALLBACK_SLOT_REASON.most_popular,
    popPlacement?.tier ?? 2,
    popPlacement?.confidence ?? "moderate",
  );

  const byGem = [...remainingCurated()]
    .filter(eligibleForGem)
    .sort((a, b) => b.breakdown.gem - a.breakdown.gem);
  const gemPlacement = sorted.find(
    (p) => candidateFor(p.productId)?.upid === byGem[0]?.upid,
  );
  take(
    byGem[0],
    "gem",
    gemPlacement?.reason ?? FALLBACK_SLOT_REASON.gem,
    gemPlacement?.tier ?? 3,
    gemPlacement?.confidence ?? "limited",
  );

  for (const p of sorted) {
    if (picks.length >= displayLimit) break;
    const vc = candidateFor(p.productId);
    if (!vc || used.has(vc.upid)) continue;
    take(vc, "gallery", p.reason, p.tier, p.confidence);
  }

  for (const c of remainingCurated()) {
    if (picks.length >= displayLimit) break;
    take(
      c,
      c.loosened ? "loosened" : "gallery",
      FALLBACK_SLOT_REASON.gallery,
      3,
      "limited",
      undefined,
      "fill_gap",
    );
  }

  if (!picks.length) return null;

  const composed = enforceRackBrandComposition({
    picks,
    pool,
    brief,
    buildPick: (vc, slot, reason) =>
      buildPick(vc, slot, brief, candidateCount, reason),
  });

  return {
    picks: composed.picks,
    products: pool.map((c) => cardFromVerified(c)),
    method: "tier_judge",
    tierPlacements: placements,
    tierJudgeFallback: false,
    curationFallback: false,
    ruledOut: composed.ruledOut.length ? composed.ruledOut : undefined,
    pipelineDebug: {
      listingHygiene: [],
      triage: [],
      finalists: [],
      headToHead: [],
      slots: slotDebug,
      fallbacks: [],
    },
  };
}

/** When slot eligibility blocks every take(), still honor model placements. */
function salvageSlotsFromPlacements(params: {
  pool: VerifiedCandidate[];
  placements: TierPlacement[];
  brief: SearchBrief;
  displayLimit: number;
  candidateCount: number;
  slotDebug?: PipelineSlotRow[];
  fallbacks?: PipelineFallbackRow[];
}): SlottingResult | null {
  const { brief, displayLimit, candidateCount, placements, pool } = params;
  const slotDebug = params.slotDebug ?? [];
  const fallbacks = params.fallbacks ?? [];
  fallbacks.push({
    path: "salvage",
    reason:
      "Named slot eligibility blocked every take() — forced judge placements into rack order",
  });
  const sorted = [...placements].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
  });
  const slotOrder: CurationSlot[] = [
    "shoop_pick",
    "best_value",
    "most_popular",
    "gem",
    "gallery",
  ];
  const picks: CuratedPick[] = [];
  const used = new Set<string>();

  for (const p of sorted) {
    if (picks.length >= displayLimit) break;
    const vc = resolveCandidateByProductId(pool, p.productId);
    if (!vc || used.has(vc.upid)) continue;
    used.add(vc.upid);
    const slot = slotOrder[Math.min(picks.length, slotOrder.length - 1)] ?? "gallery";
    picks.push(
      buildPick(vc, slot, brief, candidateCount, p.reason, {
        tier: p.tier,
        forceVerdict: p.tier === 1 ? "buy" : "wait",
      }),
    );
    slotDebug.push({
      product: pipelineProductFromVerified(vc),
      slot,
      reason: p.reason,
      whyHere: explainSlotAssignment({
        slot,
        source: "salvage",
        tier: p.tier,
        confidence: p.confidence,
        reason: p.reason,
      }),
      source: "salvage",
      tier: p.tier,
      confidence: p.confidence,
    });
  }

  if (!picks.length) return null;
  logAiChat("warn", "slotting_tier_judge_salvaged", {
    query: brief.query.slice(0, 120),
    pickCount: picks.length,
  });
  return {
    picks,
    products: pool.map((c) => cardFromVerified(c)),
    method: "tier_judge",
    tierPlacements: placements,
    tierJudgeFallback: false,
    curationFallback: false,
  };
}

function finalizeAssignSlotsDebug(
  result: SlottingResult,
  ctx: {
    brief: SearchBrief;
    hygienePool: VerifiedCandidate[];
    listingDrops: ConstraintGateDrop[];
    triage: TriageVerdict[];
    finalists: VerifiedCandidate[];
    headToHead: HeadToHeadComparison[];
    fallbacks: PipelineFallbackRow[];
    pool: VerifiedCandidate[];
    slotRows: PipelineSlotRow[];
  },
): SlottingResult {
  const priorSlots = result.pipelineDebug?.slots?.length
    ? result.pipelineDebug.slots
    : ctx.slotRows;
  const slots =
    result.picks.length > 0
      ? slotRowsFromCuratedPicks(result.picks, priorSlots, (id) => {
          const vc = resolveCandidateByProductId(ctx.pool, id);
          return vc ? pipelineProductFromVerified(vc) : undefined;
        })
      : priorSlots;

  return {
    ...result,
    pipelineDebug: buildSlottingPipelineDebug({
      verified: ctx.hygienePool,
      brief: ctx.brief,
      listingDrops: ctx.listingDrops,
      triage: ctx.triage,
      finalists: ctx.finalists,
      headToHead: ctx.headToHead,
      slots,
      fallbacks: [
        ...ctx.fallbacks,
        ...(result.pipelineDebug?.fallbacks ?? []),
      ],
      resolveId: (id) => resolveCandidateByProductId(ctx.pool, id),
    }),
  };
}

/**
 * Assign curated slots over the verified, ranked candidates.
 * Featured slots (shop_pick/best_value/most_popular/gem) are unique products;
 * the rest fill the gallery up to `displayLimit`.
 */
export async function assignSlots(params: {
  verified: VerifiedCandidate[];
  brief: SearchBrief;
  displayLimit: number;
  candidateCount: number;
  userId?: string;
  accessToken?: string;
  shipsToCountry?: string;
  context?: CatalogSearchContext;
  contextTag?: string | null;
  signal?: AbortSignal;
  tierJudgeTimeoutMs?: number;
  /** When set, skips the memory XML fetch so tier judge can start immediately. */
  preBuiltMemoryXml?: string;
  onNarration?: (line: string) => void;
  afterTriage?: AfterTriageHook;
  /** Fires after wide triage with a rack skeleton for progressive UI streaming. */
  onTriageSkeleton?: (payload: TriageSkeletonPayload) => void;
}): Promise<SlottingResult> {
  const { brief, displayLimit, candidateCount } = params;
  const pipelineFallbacks: PipelineFallbackRow[] = [];
  const pipelineSlots: PipelineSlotRow[] = [];
  const hygienePool = [...params.verified];
  let listingHygieneDrops: ConstraintGateDrop[] = [];
  let triageVerdictsForDebug: TriageVerdict[] = [];
  let finalistCandidates: VerifiedCandidate[] = [];
  let headToHeadComparisons: HeadToHeadComparison[] = [];
  let pool = [...params.verified];
  if (brief.rankingProfile === "gift_diversity" && pool.length > displayLimit) {
    pool = mmrOrder(pool, Math.max(displayLimit, 6));
  }
  if (!pool.length) {
    return {
      picks: [],
      products: [],
      method: "score_heuristic",
      curationFallback: true,
    };
  }

  // One verified candidate — nothing to judge between; score slotting is intentional.
  if (pool.length < 2) {
    const single = await assignSlotsScoreBased({
      ...params,
      verified: pool,
      slotDebug: pipelineSlots,
      fallbacks: pipelineFallbacks,
    });
    return finalizeAssignSlotsDebug(
      {
        ...single,
        method: "score_heuristic",
        curationFallback: false,
        tierJudgeFallback: false,
      },
      {
        brief,
        hygienePool,
        listingDrops: listingHygieneDrops,
        triage: triageVerdictsForDebug,
        finalists: finalistCandidates,
        headToHead: headToHeadComparisons,
        fallbacks: pipelineFallbacks,
        pool,
        slotRows: pipelineSlots,
      },
    );
  }

  let tierJudgeFailure: "timeout_or_error" | "empty_placements" | "slotting_empty" | undefined;

  const gated = applyConstraintGate(pool, brief);
  pool = gated.passed;
  let preJudgeRuledOut = gated.metrics.drops;

  const listingGated = await applyListingHygieneGate(pool, brief, {
    signal: params.signal,
  });
  pool = listingGated.passed;
  listingHygieneDrops = [...listingGated.metrics.drops];
  preJudgeRuledOut = [...preJudgeRuledOut, ...listingGated.metrics.drops];

  params.onNarration?.("Loading full details on top finalists");

  const memoryPromise =
    params.preBuiltMemoryXml !== undefined
      ? Promise.resolve(params.preBuiltMemoryXml)
      : params.userId
        ? buildShoppingMemoryPromptXml(params.userId, brief.query).catch(() => "")
        : Promise.resolve("");

  const enrichPromise =
    params.accessToken && pool.length >= 2
      ? enrichFinalistsForJudgment({
          accessToken: params.accessToken,
          verified: pool,
          shipsToCountry: params.shipsToCountry,
          context: params.context,
          signal: params.signal,
        })
      : Promise.resolve({
          verified: pool,
          attempted: 0,
          enriched: 0,
          latencyMs: 0,
        });

  const [memoryXml, enrichResult] = await Promise.all([memoryPromise, enrichPromise]);
  pool = enrichResult.verified;

  const judgeCandidatesForImages = pool.slice(0, TIER_JUDGE_CANDIDATE_LIMIT);
  const imagePrefetch = startFinalistImagePrefetch(
    judgeCandidatesForImages,
    params.signal,
  );

  const triagePhase = await runTierJudgeTriagePhase({
    brief,
    verified: pool,
    memoryXml: memoryXml || undefined,
    contextTag: params.contextTag,
    signal: params.signal,
    timeoutMs: params.tierJudgeTimeoutMs ?? AI_CHAT_TIER_JUDGE_TIMEOUT_MS,
  });

  let agenticRetryUsed = false;
  let agenticRetrySummary: string | undefined;
  const buyingRules = triagePhase?.buyingRules ?? [];
  let triageVerdicts = triagePhase?.triage ?? [];
  triageVerdictsForDebug = triageVerdicts;

  if (!triagePhase) {
    pipelineFallbacks.push({
      path: "triage",
      reason: "Wide triage phase failed or timed out — compare phase skipped",
    });
  }

  if (triagePhase && params.onTriageSkeleton) {
    const skeleton = buildTriageSkeletonPayload({
      pool,
      triage: triagePhase.triage,
      brief,
      displayLimit,
      candidateCount,
    });
    if (skeleton) {
      params.onNarration?.("Shortlisting finalists — judging fit from photos");
      params.onTriageSkeleton(skeleton);
    }
  }

  if (triagePhase && params.afterTriage) {
    const poolBeforeRetry = pool.length;
    const retryResult = await params.afterTriage({
      verified: pool,
      triage: triagePhase.triage,
      buyingRules: triagePhase.buyingRules,
      preJudgeDrops: preJudgeRuledOut,
      brief,
      onNarration: params.onNarration,
    });
    if (
      retryResult?.verified &&
      retryResult.verified.length > poolBeforeRetry
    ) {
      agenticRetryUsed = true;
      agenticRetrySummary = retryResult.summary;
      const existingTriageIds = new Set(triageVerdicts.map((t) => t.productId));
      for (const v of retryResult.verified) {
        if (!existingTriageIds.has(v.detail.id)) {
          triageVerdicts.push({
            productId: v.detail.id,
            verdict: "advance",
            note: "Follow-up search candidate",
          });
        }
      }
      pool = retryResult.verified;
      const regated = applyConstraintGate(pool, brief);
      pool = regated.passed;
      preJudgeRuledOut = [...preJudgeRuledOut, ...regated.metrics.drops];
      const reListing = await applyListingHygieneGate(pool, brief, {
        signal: params.signal,
      });
      pool = reListing.passed;
      preJudgeRuledOut = [...preJudgeRuledOut, ...reListing.metrics.drops];
      listingHygieneDrops = [
        ...listingHygieneDrops,
        ...reListing.metrics.drops,
      ];
      if (params.accessToken && pool.length >= 2) {
        const reEnriched = await enrichFinalistsForJudgment({
          accessToken: params.accessToken,
          verified: pool,
          shipsToCountry: params.shipsToCountry,
          context: params.context,
          signal: params.signal,
        });
        pool = reEnriched.verified;
      }
      params.onNarration?.(
        `Follow-up search widened the pool to ${pool.length} candidate${pool.length === 1 ? "" : "s"}`,
      );
    }
  }

  const judgeCandidates = pool.slice(0, TIER_JUDGE_CANDIDATE_LIMIT);
  if (triagePhase) {
    finalistCandidates = selectFinalistsForCompare(
      judgeCandidates,
      triageVerdicts,
    );
  }
  const tierResult = triagePhase
    ? await runTierJudgeComparePhase({
        brief,
        verified: pool,
        judgeCandidates,
        triage: triageVerdicts,
        buyingRules,
        memoryXml: memoryXml || undefined,
        contextTag: params.contextTag,
        signal: params.signal,
        timeoutMs: params.tierJudgeTimeoutMs ?? AI_CHAT_TIER_JUDGE_TIMEOUT_MS,
        triagePromptText: triagePhase.promptText,
        triageResultText: triagePhase.resultText,
        imagePrefetch,
      })
    : null;

  headToHeadComparisons = tierResult?.headToHeadComparisons ?? [];
  if (triagePhase && !tierResult) {
    pipelineFallbacks.push({
      path: "compare",
      reason: "Head-to-head compare phase failed or timed out",
    });
  }

  const returnWithDebug = (result: SlottingResult): SlottingResult =>
    finalizeAssignSlotsDebug(result, {
      brief,
      hygienePool,
      listingDrops: listingHygieneDrops,
      triage: triageVerdictsForDebug,
      finalists: finalistCandidates,
      headToHead: headToHeadComparisons,
      fallbacks: pipelineFallbacks,
      pool,
      slotRows: pipelineSlots,
    });

  let ruledOut: ConstraintGateDrop[] = [...preJudgeRuledOut];
  let placementsForSlotting = tierResult?.placements ?? [];

  if (tierResult) {
    ruledOut = [...ruledOut, ...judgeOmissionsToDrops(tierResult.omissions ?? [])];
  }

  if (tierResult?.placements.length) {
    const filtered = dropPlacementsByConstraints({
      placements: tierResult.placements,
      pool,
      brief,
    });
    placementsForSlotting = filtered.kept;
    ruledOut = [...ruledOut, ...filtered.ruledOut];
    if (ruledOut.length) {
      logAiChat("info", "slotting_must_have_drops", {
        query: brief.query.slice(0, 120),
        dropCount: ruledOut.length,
        gates: ruledOut.map((d) => d.gate),
      });
    }
  }

  if (!tierResult) {
    tierJudgeFailure = "timeout_or_error";
  } else if (!placementsForSlotting.length) {
    tierJudgeFailure = "empty_placements";
  } else {
    const fromTiers = assignSlotsFromTierJudgment({
      verified: pool,
      placements: placementsForSlotting,
      brief,
      displayLimit,
      candidateCount,
      slotDebug: pipelineSlots,
    });
    if (fromTiers?.picks.length) {
      const rackRuledOut = [
        ...(ruledOut.length ? ruledOut : []),
        ...(fromTiers.ruledOut ?? []),
      ];
      return returnWithDebug({
        ...fromTiers,
        ruledOut: rackRuledOut.length ? rackRuledOut : undefined,
        tierJudgePrompt: tierResult.promptText,
        tierJudgeResult: tierResult.resultText,
        tierJudgeModel: tierResult.model,
        agenticRetryUsed,
        agenticRetrySummary,
      });
    }
    const salvaged = salvageSlotsFromPlacements({
      pool,
      placements: placementsForSlotting,
      brief,
      displayLimit,
      candidateCount,
      slotDebug: pipelineSlots,
      fallbacks: pipelineFallbacks,
    });
    if (salvaged?.picks.length) {
      pipelineFallbacks.push({
        path: "slotting_empty",
        reason: "Tier placements could not fill named slots — salvaged from judge order",
      });
      return returnWithDebug({
        ...salvaged,
        ruledOut: ruledOut.length ? ruledOut : undefined,
        tierJudgePrompt: tierResult.promptText,
        tierJudgeResult: tierResult.resultText,
        tierJudgeModel: tierResult.model,
        agenticRetryUsed,
        agenticRetrySummary,
      });
    }
    tierJudgeFailure = "slotting_empty";
  }

  if (tierJudgeFailure) {
    logAiChat("error", "slotting_tier_judge_failed", {
      query: brief.query.slice(0, 120),
      verifiedCount: pool.length,
      reason: tierJudgeFailure,
    });
  }

  if (placementsForSlotting.length) {
    pipelineFallbacks.push({
      path: "tier_judge_fallback",
      reason: tierJudgeFailure ?? "tier judge did not produce a rack",
    });
    const salvaged = salvageSlotsFromPlacements({
      pool,
      placements: placementsForSlotting,
      brief,
      displayLimit,
      candidateCount,
      slotDebug: pipelineSlots,
      fallbacks: pipelineFallbacks,
    });
    if (salvaged?.picks.length) {
      return returnWithDebug({
        ...salvaged,
        ruledOut: ruledOut.length ? ruledOut : undefined,
        tierJudgePrompt: tierResult?.promptText,
        tierJudgeResult: tierResult?.resultText,
        tierJudgeModel: tierResult?.model,
        tierJudgeFallback: true,
        tierJudgeFailureReason: tierJudgeFailure,
        curationFallback: true,
        agenticRetryUsed,
        agenticRetrySummary,
      });
    }
  }

  return returnWithDebug({
    picks: [],
    products: pool.map((c) => cardFromVerified(c)),
    method: "tier_judge",
    tierJudgeFallback: true,
    tierJudgeFailureReason: tierJudgeFailure ?? "timeout_or_error",
    tierJudgePrompt: tierResult?.promptText,
    tierJudgeResult: tierResult?.resultText,
    tierJudgeModel: tierResult?.model,
    ruledOut: ruledOut.length ? ruledOut : undefined,
    curationFallback: true,
    agenticRetryUsed,
    agenticRetrySummary,
  });
}

/** Score-ordered slotting fallback when tier judge misses deadline or returns empty. */
async function assignSlotsScoreBased(params: {
  verified: VerifiedCandidate[];
  brief: SearchBrief;
  displayLimit: number;
  candidateCount: number;
  signal?: AbortSignal;
  slotDebug?: PipelineSlotRow[];
  fallbacks?: PipelineFallbackRow[];
}): Promise<SlottingResult> {
  const { brief, displayLimit, candidateCount } = params;
  const slotDebug = params.slotDebug ?? [];
  const fallbacks = params.fallbacks ?? [];
  fallbacks.push({
    path: "score_heuristic",
    reason:
      params.verified.length < 2
        ? "Only one verified candidate — tier judge skipped"
        : "Tier judge unavailable — score-ordered slot assignment",
  });
  let pool = [...params.verified];
  if (brief.rankingProfile === "gift_diversity" && pool.length > displayLimit) {
    pool = mmrOrder(pool, Math.max(displayLimit, 6));
  }
  if (!pool.length) {
    return {
      picks: [],
      products: [],
      method: "score_heuristic",
      curationFallback: true,
    };
  }

  const used = new Set<string>();
  const usedCandidates: VerifiedCandidate[] = [];
  const sellerCounts = new Map<string, number>();
  const picks: CuratedPick[] = [];

  const canTakeSeller = (vc: VerifiedCandidate): boolean => {
    const key = sellerKey(vc);
    if (!key) return true;
    return (sellerCounts.get(key) ?? 0) < MAX_PICKS_PER_SELLER;
  };

  const take = (
    candidate: VerifiedCandidate | undefined,
    slot: CurationSlot,
    reason?: string,
  ) => {
    if (!candidate || used.has(candidate.upid)) return;
    if (isNearDuplicateOfUsed(candidate, usedCandidates)) return;
    if (!canTakeSeller(candidate)) return;
    used.add(candidate.upid);
    usedCandidates.push(candidate);
    const key = sellerKey(candidate);
    if (key) sellerCounts.set(key, (sellerCounts.get(key) ?? 0) + 1);
    picks.push(buildPick(candidate, slot, brief, candidateCount, reason));
    slotDebug.push({
      product: pipelineProductFromVerified(candidate),
      slot,
      reason,
      whyHere: explainSlotAssignment({
        slot,
        source: slot === "gallery" || slot === "loosened" ? "fill_gap" : "score_heuristic",
        reason,
      }),
      source: "score_heuristic",
    });
  };

  const remaining = () => pool.filter((c) => !used.has(c.upid));

  // shop_pick (hero): best eligible hero; skip if rating exists but below floor.
  const hero =
    pool.find((c) => eligibleForShopPick(c)) ??
    pool.find((c) => c.heroEligible) ??
    pool[0];
  let heroReason: string | undefined;
  if (hero) {
    heroReason = await craftShopPickReason(hero, brief, {
      signal: params.signal,
    });
  }
  take(hero, "shoop_pick", heroReason);

  // best_value: highest value among eligible remaining.
  const byValue = [...remaining()]
    .filter(eligibleForBestValue)
    .sort((a, b) => b.breakdown.value - a.breakdown.value);
  take(byValue[0], "best_value");

  // most_popular: most reviews among eligible remaining (quality floor + min reviews).
  const byPopular = [...remaining()]
    .filter(eligibleForMostPopular)
    .sort(
      (a, b) =>
        (parseCatalogRating(b.detail.rating)?.count ?? 0) -
        (parseCatalogRating(a.detail.rating)?.count ?? 0),
    );
  take(byPopular[0], "most_popular");

  // gem: highest gem score among eligible remaining.
  const byGem = [...remaining()]
    .filter(eligibleForGem)
    .sort((a, b) => b.breakdown.gem - a.breakdown.gem);
  take(byGem[0], "gem");

  // gallery: remaining in score order, honoring loosened framing.
  for (const c of remaining()) {
    if (picks.length >= displayLimit) break;
    take(c, c.loosened ? "loosened" : "gallery", FALLBACK_SLOT_REASON.gallery);
    if (slotDebug.length) {
      const last = slotDebug[slotDebug.length - 1]!;
      last.source = "fill_gap";
      last.whyHere = explainSlotAssignment({
        slot: last.slot,
        source: "fill_gap",
        reason: last.reason,
      });
    }
  }

  const composed = enforceRackBrandComposition({
    picks,
    pool,
    brief,
    buildPick: (vc, slot, reason) =>
      buildPick(vc, slot, brief, candidateCount, reason),
  });

  const products = pool.map((c) => cardFromVerified(c));
  return {
    picks: composed.picks,
    products,
    method: "score_heuristic",
    curationFallback: true,
    ruledOut: composed.ruledOut.length ? composed.ruledOut : undefined,
    pipelineDebug: {
      listingHygiene: buildListingHygieneRows(pool, brief, []),
      triage: [],
      finalists: pool.slice(0, 4).map((c) => pipelineProductFromVerified(c)),
      headToHead: [],
      slots: slotDebug,
      fallbacks,
    },
  };
}
