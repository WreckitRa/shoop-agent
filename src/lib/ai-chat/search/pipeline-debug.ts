import {
  extractCatalogImageUrl,
  parseCatalogRating,
  type CatalogProductDetail,
  type CatalogProductSummary,
} from "@/lib/shopify/catalog";
import type { HeadToHeadComparison } from "../judgment/tier-judge";
import type { CuratedPick, CurationSlot } from "../types";
import type { ListingHygiene } from "./listing-hygiene";
import { candidateSellerDomain } from "./scoring";
import type { PoolCandidate, ScoredCandidate } from "./types";
import type { VerifiedCandidate, VerifyDebugSnapshot } from "./verify";
import { buildVerifyDebugSnapshotFromVerified } from "./verify";
import type { SizeResolution } from "./size-resolution";

export type PipelineDebugProduct = {
  id: string;
  title: string;
  store: string | null;
  imageUrl: string | null;
  priceLabel?: string | null;
  ratingLabel?: string | null;
};

export type PipelinePreVerifyProduct = PipelineDebugProduct & {
  score?: number;
  scoreBreakdown?: Record<string, number>;
  sizeResolution?: PipelineDebugDrop["sizeResolution"];
};

export type PipelineVerifySnapshot = {
  source: "get_product" | "search_summary";
  resolvedPriceLabel: string | null;
  resolvedPriceCents: number | null;
  resolvedOptions?: Array<{ name: string; label: string }>;
  selectedRequested?: Array<{ name: string; label: string }>;
  budget: VerifyDebugSnapshot["budget"];
};

export type PipelineBriefBudget = {
  type: string;
  targetCents: number | null;
  maxCents?: number | null;
  currency?: string;
  label: string;
};

export type PipelineVerifiedProduct = PipelineDebugProduct & {
  sizeResolution?: PipelineDebugDrop["sizeResolution"];
  verifySnapshot?: PipelineVerifySnapshot;
};

export type PipelineDebugDropStage =
  | "avoid_terms"
  | "shipping_guard"
  | "gift_merch"
  | "near_duplicate"
  | "constraint_color"
  | "constraint_gender"
  | "constraint_must_have"
  | "pre_verify_prune"
  | "size_exact"
  | "verify"
  | "verify_skipped"
  | "listing_hygiene"
  | "triage"
  | "judge_omission"
  | "constraint_post_judge"
  | "not_slotted";

export type PipelineDebugDrop = {
  product: PipelineDebugProduct;
  reason: string;
  stage: PipelineDebugDropStage | "size_exact" | "constraint" | "other";
  sizeResolution?: {
    status: string;
    method?: string;
    merchantLabel?: string;
    parsedListingSize?: string;
    confidence?: number;
  };
  verifySnapshot?: PipelineVerifySnapshot;
};

export type PipelineProductOutcome = "on_rack" | "dropped" | "stalled";

export type PipelineJourneyRow = {
  product: PipelineDebugProduct;
  outcome: PipelineProductOutcome;
  /** Human-readable furthest stage reached (e.g. "Verified", "Pre-verify"). */
  furthestStage: string;
  dropStage?: PipelineDebugDropStage;
  dropReason?: string;
  slot?: string;
  score?: number;
};

export type PipelineJourneySummary = {
  catalogFetched: number;
  afterPoolFilters: number;
  preVerify: number;
  verified: number;
  onRack: number;
  dropped: number;
  stalled: number;
  byDropStage: Partial<Record<PipelineDebugDropStage, number>>;
};

export type PipelineListingHygieneRow = {
  product: PipelineDebugProduct;
  quality: ListingHygiene["quality"];
  flags: string[];
  notes: string[];
  dropped: boolean;
  dropReason?: string;
};

export type PipelineTriageRow = {
  product: PipelineDebugProduct;
  verdict: "advance" | "drop";
  note: string;
};

export type PipelineHeadToHeadRow = {
  products: PipelineDebugProduct[];
  winner: PipelineDebugProduct;
  tradeoff: string;
};

export type PipelineSlotSource =
  | "tier_judge"
  | "score_heuristic"
  | "salvage"
  | "fill_gap"
  | "brand_compose";

export type PipelineSlotRow = {
  product: PipelineDebugProduct;
  slot: CurationSlot | string;
  /** Judge or heuristic copy for the card. */
  reason?: string;
  /** Plain-language explanation of why this product landed in this slot. */
  whyHere: string;
  source: PipelineSlotSource;
  tier?: number;
  confidence?: string;
  verdict?: string;
};

export type PipelineFallbackRow = {
  path: string;
  reason: string;
};

export type SlottingPipelineDebug = {
  listingHygiene: PipelineListingHygieneRow[];
  triage: PipelineTriageRow[];
  finalists: PipelineDebugProduct[];
  headToHead: PipelineHeadToHeadRow[];
  slots: PipelineSlotRow[];
  fallbacks: PipelineFallbackRow[];
};

export type SearchPipelineDebugV1 = {
  version: 1;
  searchKey: string;
  query: string;
  ts: number;
  /** Every unique product from catalog search before pool filters. */
  catalogFetched: PipelineDebugProduct[];
  /** De-duped pool after retrieval filters (Stage 2 output). */
  fetched: PipelineDebugProduct[];
  /** Ranked candidates sent to availability verification. */
  preVerify: PipelinePreVerifyProduct[];
  verified: PipelineVerifiedProduct[];
  verifyDrops: PipelineDebugDrop[];
  /** Pre-verify candidates never attempted (verify budget cap / early stop). */
  verifyNotAttempted: PipelinePreVerifyProduct[];
  verifyAttempted?: number;
  listingHygiene: PipelineListingHygieneRow[];
  finalists: PipelineDebugProduct[];
  triage: PipelineTriageRow[];
  headToHead: PipelineHeadToHeadRow[];
  slots: PipelineSlotRow[];
  fallbacks: PipelineFallbackRow[];
  method: "tier_judge" | "score_heuristic";
  tierJudgeFailureReason?: string;
  /** Full Shopify catalog payloads keyed by product id (for expand view). */
  catalogById: Record<string, Record<string, unknown>>;
  /** Live get_product responses keyed by product id (verify stage). */
  getProductById: Record<string, Record<string, unknown>>;
  /** Brief budget used for verify-time price checks. */
  briefBudget?: PipelineBriefBudget;
  /** End-to-end ledger: every product id seen from fetch → rack. */
  journey: PipelineJourneyRow[];
  /** Subset of journey where outcome is dropped, with stage + reason. */
  allDropped: PipelineJourneyRow[];
  /** Products shown on the rack (same ids as slots). */
  onScreen: PipelineDebugProduct[];
  journeySummary: PipelineJourneySummary;
  /** Pool-stage removals (avoid, shipping, gift merch, dedupe). */
  poolFilterDrops: PipelineDebugDrop[];
  /** Constraint gate at scoring (color/gender/must-have). */
  scoringConstraintDrops: PipelineDebugDrop[];
  /** Post-verify slotting drops (hygiene, triage, judge, post-judge constraint). */
  slottingDrops: PipelineDebugDrop[];
};

function featuredVariant(product: CatalogProductSummary) {
  return (
    product.variants?.find((v) => v.checkout_url) ?? product.variants?.[0]
  );
}

function priceLabelFromSummary(product: CatalogProductSummary): string | null {
  const v = featuredVariant(product);
  const amt = v?.price?.amount;
  const cur = v?.price?.currency ?? "USD";
  if (typeof amt !== "number" || !Number.isFinite(amt)) return null;
  return `${cur} ${(amt / 100).toFixed(2)}`;
}

function ratingLabelFromSummary(product: CatalogProductSummary): string | null {
  const r = parseCatalogRating(product.rating);
  if (!r) return null;
  const scale = r.scaleMax || 5;
  return `${r.value.toFixed(1)}/${scale}${r.count != null ? ` (${r.count} reviews)` : ""}`;
}

/** JSON-safe snapshot for the debug panel expand view. */
export function serializeCatalogForDebug(
  product: CatalogProductSummary | CatalogProductDetail,
): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(product)) as Record<string, unknown>;
  } catch {
    return { id: product.id, title: product.title ?? null };
  }
}

export function explainSlotAssignment(params: {
  slot: CurationSlot | string;
  source: PipelineSlotSource;
  tier?: number;
  confidence?: string;
  reason?: string;
}): string {
  const slotLabel: Record<string, string> = {
    shoop_pick: "Shoop's pick (hero card)",
    best_value: "Best value slot",
    most_popular: "Most popular slot",
    gem: "Hidden gem slot",
    gallery: "Gallery row",
    loosened: "Gallery (budget/filters relaxed)",
    reframed: "Gallery (broader search angle)",
  };
  const parts: string[] = [
    `Placed in ${slotLabel[params.slot] ?? params.slot.replace(/_/g, " ")}.`,
  ];
  if (params.tier != null) {
    parts.push(
      `Judge tier ${params.tier}${params.confidence ? ` (${params.confidence} confidence)` : ""}.`,
    );
  }
  if (params.source === "tier_judge") {
    parts.push("Selected by tier judge slotting rules.");
  } else if (params.source === "score_heuristic") {
    parts.push("Score heuristic — tier judge was skipped or unavailable.");
  } else if (params.source === "salvage") {
    parts.push("Salvaged — named slot rules blocked other picks; kept judge order.");
  } else if (params.source === "fill_gap") {
    parts.push("Fill gap — remaining gallery capacity after featured slots.");
  } else if (params.source === "brand_compose") {
    parts.push("Brand composition swap — anchor trust requirement.");
  }
  if (params.reason?.trim()) {
    parts.push(`Judge/heuristic reason: ${params.reason.trim()}`);
  }
  return parts.join(" ");
}

/** Align debug slot rows with picks actually sent to the chat UI (post brand composition). */
export function slotRowsFromCuratedPicks(
  picks: CuratedPick[],
  priorSlots: PipelineSlotRow[],
  resolveProduct: (productId: string) => PipelineDebugProduct | undefined,
): PipelineSlotRow[] {
  const priorByProductSlot = new Map(
    priorSlots.map((row) => [`${row.product.id}:${String(row.slot)}`, row]),
  );
  const priorBySlot = new Map(
    priorSlots.map((row) => [String(row.slot), row]),
  );

  return picks.map((pick) => {
    const prior =
      priorByProductSlot.get(`${pick.id}:${String(pick.slot)}`) ??
      priorBySlot.get(String(pick.slot));
    const product =
      resolveProduct(pick.id) ??
      prior?.product ?? {
        id: pick.id,
        title: pick.title ?? "",
        store: null,
        imageUrl: null,
      };

    if (prior && prior.product.id === pick.id) {
      return {
        ...prior,
        product,
        reason: pick.reason ?? prior.reason,
        verdict: pick.verdict ?? prior.verdict,
      };
    }

    if (prior) {
      return {
        product,
        slot: pick.slot,
        reason: pick.reason ?? prior.reason,
        whyHere: explainSlotAssignment({
          slot: pick.slot,
          source: "brand_compose",
          tier: prior.tier,
          confidence: prior.confidence,
          reason: pick.reason ?? prior.reason,
        }),
        source: "brand_compose",
        tier: prior.tier,
        confidence: prior.confidence,
        verdict: pick.verdict,
      };
    }

    return {
      product,
      slot: pick.slot,
      reason: pick.reason,
      whyHere: explainSlotAssignment({
        slot: pick.slot,
        source: "brand_compose",
        reason: pick.reason,
      }),
      source: "brand_compose",
      verdict: pick.verdict,
    };
  });
}

export function pipelineProductFromSummary(
  product: CatalogProductSummary,
): PipelineDebugProduct {
  const variant = featuredVariant(product);
  const imageUrl =
    (variant && extractCatalogImageUrl(variant)) ||
    extractCatalogImageUrl(product as CatalogProductDetail) ||
    null;
  return {
    id: product.id,
    title: (product.title ?? "").trim() || product.id,
    store: candidateSellerDomain(product),
    imageUrl,
    priceLabel: priceLabelFromSummary(product),
    ratingLabel: ratingLabelFromSummary(product),
  };
}

export function pipelineProductFromPool(c: PoolCandidate): PipelineDebugProduct {
  return pipelineProductFromSummary(c.product);
}

export function pipelineProductFromScored(
  c: ScoredCandidate,
): PipelineDebugProduct {
  return pipelineProductFromSummary(c.product);
}

export function pipelineProductFromCandidate(
  c: ScoredCandidate | import("./verify").VerifiedCandidate,
): PipelineDebugProduct {
  if ("detail" in c && c.detail) {
    return pipelineProductFromVerified(c);
  }
  return pipelineProductFromScored(c);
}

function verifySnapshotForDebug(
  snapshot: VerifyDebugSnapshot | undefined,
): PipelineVerifySnapshot | undefined {
  if (!snapshot) return undefined;
  return {
    source: snapshot.source,
    resolvedPriceLabel: snapshot.resolvedPriceLabel,
    resolvedPriceCents: snapshot.resolvedPriceCents,
    resolvedOptions: snapshot.resolvedOptions,
    selectedRequested: snapshot.selectedRequested,
    budget: snapshot.budget,
  };
}

function briefBudgetForDebug(
  brief: import("./types").SearchBrief,
): PipelineBriefBudget {
  const budget = brief.budget ?? {
    amountCents: null,
    type: "none" as const,
    currency: "USD",
  };
  const cur = budget.currency ?? "USD";
  const target = budget.amountCents;
  const label =
    target != null
      ? `${budget.type} · ${cur} ${(target / 100).toFixed(2)}${budget.maxCents != null && budget.maxCents !== target ? ` (max ${cur} ${(budget.maxCents / 100).toFixed(2)})` : ""}`
      : budget.type;
  return {
    type: budget.type,
    targetCents: target,
    maxCents: budget.maxCents,
    currency: cur,
    label,
  };
}

export function pipelineProductFromVerified(
  c: VerifiedCandidate,
  brief?: import("./types").SearchBrief,
): PipelineVerifiedProduct {
  const verifySnapshot =
    brief != null
      ? verifySnapshotForDebug(buildVerifyDebugSnapshotFromVerified(c, brief))
      : undefined;
  return {
    ...pipelineProductFromSummary(c.detail),
    sizeResolution: sizeResolutionForDebug(c.sizeResolution),
    verifySnapshot,
  };
}

function sizeResolutionForDebug(
  resolution: SizeResolution | undefined,
): PipelineDebugDrop["sizeResolution"] | undefined {
  if (!resolution) return undefined;
  if (resolution.status === "match") {
    return {
      status: resolution.status,
      method: resolution.method,
      merchantLabel: resolution.merchantLabel,
      parsedListingSize: resolution.parsedListingSize,
      confidence: resolution.confidence,
    };
  }
  return {
    status: resolution.status,
    parsedListingSize:
      resolution.status === "mismatch" ? resolution.parsedListingSize : undefined,
    confidence:
      resolution.status === "mismatch" ? resolution.confidence : undefined,
  };
}

export function pipelineProductFromPick(p: CuratedPick): PipelineDebugProduct {
  return {
    id: p.id,
    title: p.title ?? p.id,
    store: null,
    imageUrl: p.imageUrl ?? null,
  };
}

export function headToHeadRowsForDebug(
  comparisons: HeadToHeadComparison[],
  resolveProduct: (id: string) => PipelineDebugProduct | undefined,
): PipelineHeadToHeadRow[] {
  return comparisons.map((c) => {
    const products = c.productIds
      .map((id) => resolveProduct(id))
      .filter((p): p is PipelineDebugProduct => Boolean(p));
    const winner =
      resolveProduct(c.winnerId) ??
      products.find((p) => p.id === c.winnerId) ?? {
        id: c.winnerId,
        title: c.winnerId,
        store: null,
        imageUrl: null,
      };
    return { products, winner, tradeoff: c.tradeoff };
  });
}

export function searchPipelineDebugFromSse(
  data: unknown,
): SearchPipelineDebugV1 | null {
  if (!data || typeof data !== "object") return null;
  const row = data as SearchPipelineDebugV1;
  if (row.version !== 1 || typeof row.searchKey !== "string") return null;
  return {
    ...row,
    catalogFetched: row.catalogFetched ?? row.fetched ?? [],
    verifyNotAttempted: row.verifyNotAttempted ?? [],
    journey: row.journey ?? [],
    allDropped: row.allDropped ?? [],
    onScreen: row.onScreen ?? [],
    journeySummary: row.journeySummary ?? emptyJourneySummary(row),
    poolFilterDrops: row.poolFilterDrops ?? [],
    scoringConstraintDrops: row.scoringConstraintDrops ?? [],
    slottingDrops: row.slottingDrops ?? [],
    catalogById: row.catalogById ?? {},
    getProductById: row.getProductById ?? {},
    listingHygiene: row.listingHygiene ?? [],
    finalists: row.finalists ?? [],
    triage: row.triage ?? [],
    headToHead: row.headToHead ?? [],
    slots: row.slots ?? [],
    fallbacks: row.fallbacks ?? [],
    fetched: row.fetched ?? [],
    preVerify: row.preVerify ?? [],
    verified: row.verified ?? [],
    verifyDrops: row.verifyDrops ?? [],
  };
}

/** Strip heavy catalog blobs before DB / localStorage persistence. */
export function pipelineDebugForPersist(
  pipeline: SearchPipelineDebugV1,
): SearchPipelineDebugV1 {
  const verifiedIds = new Set(pipeline.verified.map((product) => product.id));
  const slimGetProduct: Record<string, Record<string, unknown>> = {};
  for (const id of verifiedIds) {
    const row = pipeline.getProductById[id];
    if (row) slimGetProduct[id] = row;
  }
  return {
    ...pipeline,
    catalogById: {},
    getProductById: slimGetProduct,
  };
}

function emptyJourneySummary(
  row: Partial<SearchPipelineDebugV1>,
): PipelineJourneySummary {
  return {
    catalogFetched: row.catalogFetched?.length ?? row.fetched?.length ?? 0,
    afterPoolFilters: row.fetched?.length ?? 0,
    preVerify: row.preVerify?.length ?? 0,
    verified: row.verified?.length ?? 0,
    onRack: row.slots?.length ?? 0,
    dropped: row.allDropped?.length ?? 0,
    stalled: 0,
    byDropStage: {},
  };
}

function upidSet(candidates: PoolCandidate[]): Set<string> {
  return new Set(candidates.map((c) => c.upid));
}

function diffPoolCandidates(
  before: PoolCandidate[],
  after: PoolCandidate[],
): PoolCandidate[] {
  const kept = upidSet(after);
  return before.filter((c) => !kept.has(c.upid));
}

function avoidDropReason(
  title: string,
  avoidTerms: string[] | undefined,
): string {
  if (!avoidTerms?.length) return "Title matches avoid term";
  const hay = title.toLowerCase();
  const hit = avoidTerms
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2)
    .find((n) => hay.includes(n));
  return hit ? `Avoid term matched: "${hit}"` : "Title matches avoid term";
}

export function unionPoolCandidates(
  ...lists: PoolCandidate[][]
): PoolCandidate[] {
  const map = new Map<string, PoolCandidate>();
  for (const list of lists) {
    for (const c of list) {
      if (!map.has(c.upid)) map.set(c.upid, c);
    }
  }
  return [...map.values()];
}

/** Pool-stage filter drops (avoid, shipping, gift merch, near-duplicate collapse). */
export function computePoolFilterDrops(params: {
  catalogFetched: PoolCandidate[];
  afterAvoid: PoolCandidate[];
  afterShipping: PoolCandidate[];
  afterGift: PoolCandidate[];
  afterPoolFilters: PoolCandidate[];
  avoidTerms?: string[];
  buyerCountry?: string;
}): PipelineDebugDrop[] {
  const drops: PipelineDebugDrop[] = [];

  for (const c of diffPoolCandidates(params.catalogFetched, params.afterAvoid)) {
    drops.push({
      product: pipelineProductFromPool(c),
      stage: "avoid_terms",
      reason: avoidDropReason(c.product.title ?? "", params.avoidTerms),
    });
  }

  for (const c of diffPoolCandidates(params.afterAvoid, params.afterShipping)) {
    drops.push({
      product: pipelineProductFromPool(c),
      stage: "shipping_guard",
      reason: params.buyerCountry
        ? `Shipping text guard — listing does not appear to ship to ${params.buyerCountry}`
        : "Shipping text guard — listing failed regional shipping check",
    });
  }

  for (const c of diffPoolCandidates(params.afterShipping, params.afterGift)) {
    drops.push({
      product: pipelineProductFromPool(c),
      stage: "gift_merch",
      reason: "Gift archetype — novelty or gift-merchandise title filtered",
    });
  }

  for (const c of diffPoolCandidates(params.afterGift, params.afterPoolFilters)) {
    drops.push({
      product: pipelineProductFromPool(c),
      stage: "near_duplicate",
      reason:
        "Near-duplicate title from same seller — kept higher-ranked listing",
    });
  }

  return drops;
}

function constraintGateToDropStage(
  gate: import("./constraint-gate").ConstraintGateKind,
  atScoring: boolean,
): PipelineDebugDropStage {
  if (gate === "color") return "constraint_color";
  if (gate === "gender") return "constraint_gender";
  if (gate === "must_have") return "constraint_must_have";
  if (gate === "listing_hygiene") return "listing_hygiene";
  if (gate === "judge_omission") return "judge_omission";
  return atScoring ? "constraint_must_have" : "constraint_post_judge";
}

export function constraintDropToPipeline(
  drop: import("./constraint-gate").ConstraintGateDrop,
  atScoring: boolean,
): PipelineDebugDrop {
  return {
    product: {
      id: drop.productId,
      title: drop.title,
      store: null,
      imageUrl: null,
    },
    stage: constraintGateToDropStage(drop.gate, atScoring),
    reason: drop.reason,
  };
}

function normalizeVerifyDropStage(
  stage: PipelineDebugDrop["stage"],
): PipelineDebugDropStage {
  if (stage === "pre_verify_prune") return "pre_verify_prune";
  if (stage === "size_exact") return "size_exact";
  if (stage === "verify") return "verify";
  if (stage === "listing_hygiene") return "listing_hygiene";
  if (stage === "judge_omission") return "judge_omission";
  if (
    stage === "avoid_terms" ||
    stage === "shipping_guard" ||
    stage === "gift_merch" ||
    stage === "near_duplicate" ||
    stage === "constraint_color" ||
    stage === "constraint_gender" ||
    stage === "constraint_must_have" ||
    stage === "verify_skipped" ||
    stage === "triage" ||
    stage === "constraint_post_judge" ||
    stage === "not_slotted"
  ) {
    return stage;
  }
  return "verify";
}

const FURTHEST_STAGE_RANK: Record<string, number> = {
  "Catalog fetch": 1,
  "Pool filtered": 2,
  Scored: 3,
  "Pre-verify": 4,
  Verified: 5,
  Slotting: 6,
  "On rack": 7,
};

const DROP_STAGE_LABEL: Record<PipelineDebugDropStage, string> = {
  avoid_terms: "Avoid terms",
  shipping_guard: "Shipping guard",
  gift_merch: "Gift merch filter",
  near_duplicate: "Near-duplicate collapse",
  constraint_color: "Constraint — color",
  constraint_gender: "Constraint — gender",
  constraint_must_have: "Constraint — must-have",
  pre_verify_prune: "Pre-verify size prune",
  size_exact: "Exact size unavailable",
  verify: "Verify",
  verify_skipped: "Verify skipped (budget)",
  listing_hygiene: "Listing hygiene",
  triage: "Triage",
  judge_omission: "Judge omission",
  constraint_post_judge: "Constraint (post-judge)",
  not_slotted: "Not slotted",
};

export function dropStageLabel(stage: PipelineDebugDropStage): string {
  return DROP_STAGE_LABEL[stage] ?? stage.replace(/_/g, " ");
}

/** Coarse filters for the pipeline debug drop list. */
export type DropStageFilter =
  | "all"
  | "size"
  | "judge_omission"
  | "triage"
  | "listing_hygiene"
  | "verify"
  | "constraints"
  | "pool"
  | "stalled";

const DROP_STAGE_FILTER_LABEL: Record<DropStageFilter, string> = {
  all: "All",
  size: "Size",
  judge_omission: "Judge omission",
  triage: "Triage",
  listing_hygiene: "Listing hygiene",
  verify: "Verify (stock/price)",
  constraints: "Constraints",
  pool: "Pool filters",
  stalled: "Stalled",
};

export function dropStageFilterLabel(filter: DropStageFilter): string {
  return DROP_STAGE_FILTER_LABEL[filter];
}

const CONSTRAINT_DROP_STAGES = new Set<PipelineDebugDropStage>([
  "constraint_color",
  "constraint_gender",
  "constraint_must_have",
  "constraint_post_judge",
]);

const POOL_DROP_STAGES = new Set<PipelineDebugDropStage>([
  "avoid_terms",
  "shipping_guard",
  "gift_merch",
  "near_duplicate",
]);

function isSizeRelatedDrop(row: PipelineJourneyRow): boolean {
  if (row.dropStage === "pre_verify_prune" || row.dropStage === "size_exact") {
    return true;
  }
  const reason = row.dropReason?.toLowerCase() ?? "";
  return reason.includes("size") || reason.includes("exact match");
}

export function journeyRowMatchesDropFilter(
  row: PipelineJourneyRow,
  filter: DropStageFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "stalled") return row.outcome === "stalled";
  if (row.outcome !== "dropped") return false;

  const stage = row.dropStage;
  switch (filter) {
    case "size":
      return isSizeRelatedDrop(row);
    case "judge_omission":
      return stage === "judge_omission";
    case "triage":
      return stage === "triage";
    case "listing_hygiene":
      return stage === "listing_hygiene";
    case "verify":
      return stage === "verify";
    case "constraints":
      return stage != null && CONSTRAINT_DROP_STAGES.has(stage);
    case "pool":
      return stage != null && POOL_DROP_STAGES.has(stage);
    default:
      return true;
  }
}

export function countJourneyRowsForDropFilter(
  rows: PipelineJourneyRow[],
  filter: DropStageFilter,
): number {
  return rows.filter((row) => journeyRowMatchesDropFilter(row, filter)).length;
}

/** Filters that have at least one matching row in this run. */
export function availableDropStageFilters(
  rows: PipelineJourneyRow[],
): DropStageFilter[] {
  const filters: DropStageFilter[] = ["all"];
  const candidates: DropStageFilter[] = [
    "size",
    "judge_omission",
    "triage",
    "listing_hygiene",
    "verify",
    "constraints",
    "pool",
    "stalled",
  ];
  for (const filter of candidates) {
    if (countJourneyRowsForDropFilter(rows, filter) > 0) {
      filters.push(filter);
    }
  }
  return filters;
}

type JourneyBuilder = {
  rows: Map<string, PipelineJourneyRow>;
  scoreById: Map<string, number>;
};

function journeyEnsure(
  builder: JourneyBuilder,
  product: PipelineDebugProduct,
): PipelineJourneyRow {
  let row = builder.rows.get(product.id);
  if (!row) {
    row = {
      product,
      outcome: "stalled",
      furthestStage: "Catalog fetch",
    };
    builder.rows.set(product.id, row);
  }
  return row;
}

function journeySetFurthest(
  row: PipelineJourneyRow,
  stage: string,
): void {
  const cur = FURTHEST_STAGE_RANK[row.furthestStage] ?? 0;
  const next = FURTHEST_STAGE_RANK[stage] ?? 0;
  if (next >= cur) row.furthestStage = stage;
}

function journeyMarkDrop(
  builder: JourneyBuilder,
  product: PipelineDebugProduct,
  dropStage: PipelineDebugDropStage,
  reason: string,
  furthestBeforeDrop: string,
): void {
  const row = journeyEnsure(builder, product);
  if (row.outcome === "on_rack") return;
  row.outcome = "dropped";
  row.dropStage = dropStage;
  row.dropReason = reason;
  journeySetFurthest(row, furthestBeforeDrop);
}

function journeyMarkOnRack(
  builder: JourneyBuilder,
  product: PipelineDebugProduct,
  slot: string,
  score?: number,
): void {
  const row = journeyEnsure(builder, product);
  row.outcome = "on_rack";
  row.slot = slot;
  row.furthestStage = "On rack";
  row.dropStage = undefined;
  row.dropReason = undefined;
  if (score != null) row.score = score;
}

function journeyMarkProgress(
  builder: JourneyBuilder,
  product: PipelineDebugProduct,
  stage: string,
  score?: number,
): void {
  const row = journeyEnsure(builder, product);
  if (row.outcome === "on_rack" || row.outcome === "dropped") return;
  journeySetFurthest(row, stage);
  if (score != null) row.score = score;
}

function journeyMarkStalled(
  builder: JourneyBuilder,
  product: PipelineDebugProduct,
  dropStage: PipelineDebugDropStage,
  reason: string,
  furthestStage: string,
): void {
  const row = journeyEnsure(builder, product);
  if (row.outcome === "on_rack" || row.outcome === "dropped") return;
  row.outcome = "stalled";
  row.dropStage = dropStage;
  row.dropReason = reason;
  journeySetFurthest(row, furthestStage);
}

export function buildPipelineJourney(params: {
  catalogFetched: PipelineDebugProduct[];
  afterPoolFilters: PipelineDebugProduct[];
  poolFilterDrops: PipelineDebugDrop[];
  scoringConstraintDrops: PipelineDebugDrop[];
  preVerify: PipelinePreVerifyProduct[];
  verifyDrops: PipelineDebugDrop[];
  verifyNotAttempted: PipelinePreVerifyProduct[];
  verified: PipelineVerifiedProduct[];
  slottingDrops: PipelineDebugDrop[];
  slots: PipelineSlotRow[];
  triage: PipelineTriageRow[];
  listingHygiene: PipelineListingHygieneRow[];
}): {
  journey: PipelineJourneyRow[];
  allDropped: PipelineJourneyRow[];
  onScreen: PipelineDebugProduct[];
  journeySummary: PipelineJourneySummary;
} {
  const builder: JourneyBuilder = { rows: new Map(), scoreById: new Map() };

  for (const p of params.catalogFetched) {
    journeyMarkProgress(builder, p, "Catalog fetch");
  }

  for (const d of params.poolFilterDrops) {
    journeyMarkDrop(builder, d.product, normalizeVerifyDropStage(d.stage), d.reason, "Catalog fetch");
  }

  for (const p of params.afterPoolFilters) {
    journeyMarkProgress(builder, p, "Pool filtered");
  }

  for (const d of params.scoringConstraintDrops) {
    journeyMarkDrop(
      builder,
      d.product,
      normalizeVerifyDropStage(d.stage),
      d.reason,
      "Scored",
    );
  }

  for (const p of params.preVerify) {
    journeyMarkProgress(builder, p, "Pre-verify", p.score);
  }

  for (const d of params.verifyDrops) {
    const stage = normalizeVerifyDropStage(d.stage);
    const before =
      stage === "pre_verify_prune" ? "Pre-verify" : "Pre-verify";
    journeyMarkDrop(builder, d.product, stage, d.reason, before);
  }

  for (const p of params.verified) {
    journeyMarkProgress(builder, p, "Verified");
  }

  for (const p of params.verifyNotAttempted) {
    journeyMarkStalled(
      builder,
      p,
      "verify_skipped",
      "Verify budget cap — ranked but never attempted live stock check",
      "Pre-verify",
    );
  }

  for (const row of params.listingHygiene) {
    if (row.dropped) continue;
    journeyMarkProgress(builder, row.product, "Slotting");
  }

  for (const row of params.triage) {
    if (row.verdict === "advance") {
      journeyMarkProgress(builder, row.product, "Slotting");
      continue;
    }
    journeyMarkDrop(
      builder,
      row.product,
      "triage",
      row.note || "Triage — judge passed on this product",
      "Verified",
    );
  }

  for (const d of params.slottingDrops) {
    journeyMarkDrop(
      builder,
      d.product,
      normalizeVerifyDropStage(d.stage),
      d.reason,
      "Slotting",
    );
  }

  const slottedIds = new Set<string>();
  for (const s of params.slots) {
    slottedIds.add(s.product.id);
    journeyMarkOnRack(builder, s.product, String(s.slot), undefined);
  }

  for (const p of params.verified) {
    if (slottedIds.has(p.id)) continue;
    const row = builder.rows.get(p.id);
    if (row?.outcome === "dropped" || row?.outcome === "on_rack") continue;
    journeyMarkStalled(
      builder,
      p,
      "not_slotted",
      "Verified in stock but not selected for rack (display limit or slot rules)",
      "Verified",
    );
  }

  const journey = [...builder.rows.values()].sort((a, b) => {
    const rankDiff =
      (FURTHEST_STAGE_RANK[b.furthestStage] ?? 0) -
      (FURTHEST_STAGE_RANK[a.furthestStage] ?? 0);
    if (rankDiff !== 0) return rankDiff;
    if (a.outcome === "on_rack" && b.outcome !== "on_rack") return -1;
    if (b.outcome === "on_rack" && a.outcome !== "on_rack") return 1;
    return a.product.title.localeCompare(b.product.title);
  });

  const allDropped = journey.filter((r) => r.outcome === "dropped");
  const onScreen = params.slots.map((s) => s.product);

  const byDropStage: Partial<Record<PipelineDebugDropStage, number>> = {};
  for (const row of allDropped) {
    if (!row.dropStage) continue;
    byDropStage[row.dropStage] = (byDropStage[row.dropStage] ?? 0) + 1;
  }
  for (const row of journey.filter((r) => r.outcome === "stalled")) {
    if (!row.dropStage) continue;
    byDropStage[row.dropStage] = (byDropStage[row.dropStage] ?? 0) + 1;
  }

  const journeySummary: PipelineJourneySummary = {
    catalogFetched: params.catalogFetched.length,
    afterPoolFilters: params.afterPoolFilters.length,
    preVerify: params.preVerify.length,
    verified: params.verified.length,
    onRack: onScreen.length,
    dropped: allDropped.length,
    stalled: journey.filter((r) => r.outcome === "stalled").length,
    byDropStage,
  };

  return { journey, allDropped, onScreen, journeySummary };
}

export function buildSearchPipelineDebug(params: {
  searchKey: string;
  query: string;
  brief: import("./types").SearchBrief;
  catalogFetched: PoolCandidate[];
  fetched: PoolCandidate[];
  poolFilterDrops: PipelineDebugDrop[];
  scoringConstraintDrops: import("./constraint-gate").ConstraintGateDrop[];
  preVerify: ScoredCandidate[];
  verifyResult: import("./verify").VerifyResult;
  slotting: import("./slotting").SlottingResult;
  slottingRuledOut?: import("./constraint-gate").ConstraintGateDrop[];
}): SearchPipelineDebugV1 {
  const { slotting, verifyResult, brief } = params;
  const pipeline = slotting.pipelineDebug;
  const catalogById: Record<string, Record<string, unknown>> = {};
  const getProductById: Record<string, Record<string, unknown>> = {};

  const remember = (product: CatalogProductSummary | CatalogProductDetail) => {
    const id = product.id?.trim();
    if (!id || catalogById[id]) return;
    catalogById[id] = serializeCatalogForDebug(product);
  };

  const rememberGetProduct = (product: CatalogProductSummary | CatalogProductDetail) => {
    const id = product.id?.trim();
    if (!id) return;
    getProductById[id] = serializeCatalogForDebug(product);
  };

  for (const c of params.catalogFetched) remember(c.product);
  for (const c of params.fetched) remember(c.product);
  for (const c of params.preVerify) remember(c.product);
  for (const v of verifyResult.verified) {
    remember(v.detail);
    rememberGetProduct(v.detail);
  }
  for (const d of verifyResult.drops) {
    if (d.getProductDetail) {
      rememberGetProduct(d.getProductDetail);
    }
    if ("detail" in d.candidate && d.candidate.detail) {
      remember(d.candidate.detail);
      rememberGetProduct(d.candidate.detail);
    } else {
      remember(d.candidate.product);
    }
  }

  const verifyDrops: PipelineDebugDrop[] = verifyResult.drops.map((d) => ({
    product: pipelineProductFromCandidate(d.candidate),
    reason: d.reason,
    stage: d.stage,
    sizeResolution: sizeResolutionForDebug(d.sizeResolution),
    verifySnapshot: verifySnapshotForDebug(d.verifySnapshot),
  }));

  const scoringConstraintDrops = params.scoringConstraintDrops.map((d) =>
    constraintDropToPipeline(d, true),
  );

  const slottingRuledOut = params.slottingRuledOut ?? [];
  const triage = pipeline?.triage ?? [];
  const listingHygiene = pipeline?.listingHygiene ?? [];

  const slottingDrops: PipelineDebugDrop[] = slottingRuledOut.map((d) =>
    constraintDropToPipeline(d, false),
  );

  const droppedIds = new Set(verifyDrops.map((d) => d.product.id));
  const verifiedIds = new Set(
    verifyResult.verified.map((v) => v.product.id),
  );
  const verifyNotAttempted: PipelinePreVerifyProduct[] = params.preVerify
    .filter((c) => !droppedIds.has(c.product.id) && !verifiedIds.has(c.product.id))
    .map((c) => ({
      ...pipelineProductFromScored(c),
      score: c.score,
      scoreBreakdown: { ...c.breakdown },
      sizeResolution: sizeResolutionForDebug(
        verifyResult.sizeResolutions.get(c.upid),
      ),
    }));

  const slots: PipelineSlotRow[] = (pipeline?.slots ?? []).map((s) => {
    const pick = slotting.picks.find((p) => p.id === s.product.id);
    const withVerdict = pick ? { ...s, verdict: pick.verdict } : s;
    if (!withVerdict.whyHere) {
      return {
        ...withVerdict,
        whyHere: explainSlotAssignment({
          slot: withVerdict.slot,
          source: withVerdict.source,
          tier: withVerdict.tier,
          confidence: withVerdict.confidence,
          reason: withVerdict.reason,
        }),
      };
    }
    return withVerdict;
  });

  const fallbacks: PipelineFallbackRow[] = [...(pipeline?.fallbacks ?? [])];
  if (slotting.tierJudgeFallback && slotting.tierJudgeFailureReason) {
    fallbacks.push({
      path: "tier_judge_fallback",
      reason: slotting.tierJudgeFailureReason.replace(/_/g, " "),
    });
  }
  if (slotting.curationFallback && slotting.method === "score_heuristic") {
    fallbacks.push({
      path: "curation_fallback",
      reason: "Used score-based slotting instead of tier judge placements",
    });
  }

  const catalogFetchedProducts = params.catalogFetched.map(pipelineProductFromPool);
  const fetchedProducts = params.fetched.map(pipelineProductFromPool);
  const productById = new Map<string, PipelineDebugProduct>();
  for (const p of [...catalogFetchedProducts, ...fetchedProducts]) {
    productById.set(p.id, p);
  }
  for (const c of params.preVerify) {
    productById.set(c.product.id, pipelineProductFromScored(c));
  }
  const enrichDrop = (d: PipelineDebugDrop): PipelineDebugDrop => ({
    ...d,
    product: productById.get(d.product.id) ?? d.product,
  });
  const scoringConstraintDropsEnriched = scoringConstraintDrops.map(enrichDrop);
  const slottingDropsEnriched = slottingDrops.map(enrichDrop);
  const poolFilterDropsEnriched = params.poolFilterDrops.map(enrichDrop);
  const verifyDropsEnriched = verifyDrops.map(enrichDrop);
  const preVerifyRows = params.preVerify.map((c) => ({
    ...pipelineProductFromScored(c),
    score: c.score,
    scoreBreakdown: { ...c.breakdown },
    sizeResolution: sizeResolutionForDebug(
      verifyResult.sizeResolutions.get(c.upid),
    ),
  }));

  const { journey, allDropped, onScreen, journeySummary } = buildPipelineJourney({
    catalogFetched: catalogFetchedProducts,
    afterPoolFilters: fetchedProducts,
    poolFilterDrops: poolFilterDropsEnriched,
    scoringConstraintDrops: scoringConstraintDropsEnriched,
    preVerify: preVerifyRows,
    verifyDrops: verifyDropsEnriched,
    verifyNotAttempted,
    verified: verifyResult.verified.map((v) =>
      pipelineProductFromVerified(v, brief),
    ),
    slottingDrops: slottingDropsEnriched,
    slots,
    triage,
    listingHygiene,
  });

  return {
    version: 1,
    searchKey: params.searchKey,
    query: params.query,
    ts: Date.now(),
    catalogFetched: catalogFetchedProducts,
    fetched: fetchedProducts,
    preVerify: preVerifyRows,
    verified: verifyResult.verified.map((v) =>
      pipelineProductFromVerified(v, brief),
    ),
    verifyDrops: verifyDropsEnriched,
    verifyNotAttempted,
    verifyAttempted: verifyResult.attempted,
    listingHygiene: pipeline?.listingHygiene ?? [],
    finalists: pipeline?.finalists ?? [],
    triage: pipeline?.triage ?? [],
    headToHead: pipeline?.headToHead ?? [],
    slots,
    fallbacks,
    method: slotting.method,
    tierJudgeFailureReason: slotting.tierJudgeFailureReason,
    catalogById,
    getProductById,
    briefBudget: briefBudgetForDebug(brief),
    journey,
    allDropped,
    onScreen,
    journeySummary,
    poolFilterDrops: poolFilterDropsEnriched,
    scoringConstraintDrops: scoringConstraintDropsEnriched,
    slottingDrops: slottingDropsEnriched,
  };
}
