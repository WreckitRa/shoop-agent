/**
 * Stage 4 — Availability Verification (docs/search-improvements.md §10).
 *
 * The #1 source of bugs is recommending a product whose exact variant is sold
 * out, doesn't exist, or can't be bought natively. Before a candidate can be
 * shown we call `get_product` scoped to the needed variant + shipping country,
 * and require: exists, available && in stock, and a native checkout URL. We
 * re-read the resolved variant price and re-check the budget. Failures are
 * dropped and back-filled from the ranked tail. The hero ALWAYS verifies.
 */
import {
  availabilityFromSearchVariant,
  getProduct,
  buildCatalogCallContext,
  isCardAvailabilityPurchasable,
  summarizePreferredAvailability,
  type CardAvailability,
  type CatalogProductDetail,
  type CatalogProductSummary,
  type CatalogSearchContext,
  type SelectedOption,
} from "@/lib/shopify/catalog";
import type { CatalogMcpExchange } from "@/lib/shopify/catalog-mcp-audit";
import { logAiChat } from "../observability";
import { candidatePriceCents, candidatePriceCentsForBuyer } from "./pool";
import { convertPriceCents, type FxRateTable } from "@/lib/shopify/fx-rates";
import { judgePriceAgainstBudget, budgetOverageCaveat } from "./budget";
import { resolveSizeForCandidates } from "./size-resolution-llm";
import {
  formatSizeDropReason,
  isExactSizeVerified,
  shouldSurfaceWithSizeVerification,
  type SizeResolution,
  type SizeResolutionMap,
} from "./size-resolution";
import type { ScoredCandidate, SearchBrief, VariantConstraints } from "./types";

/** Live verify debug — get_product price + budget gate (for pipeline panel). */
export type VerifyDebugSnapshot = {
  source: "get_product" | "search_summary";
  resolvedPriceCents: number | null;
  resolvedPriceLabel: string | null;
  resolvedOptions?: SelectedOption[];
  selectedRequested?: SelectedOption[];
  budget: {
    type: SearchBrief["budget"]["type"];
    targetCents: number | null;
    maxCents?: number | null;
    currency?: string;
    over: boolean;
    overageFraction: number;
    hardViolation: boolean;
    summary: string;
  };
};

function formatPriceLabel(cents: number | null, currency = "USD"): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function buildVerifyDebugSnapshot(params: {
  source: VerifyDebugSnapshot["source"];
  product: CatalogProductDetail | null;
  brief: SearchBrief;
  selected: SelectedOption[];
  priceCents: number | null;
  currency?: string;
}): VerifyDebugSnapshot {
  const isGift =
    params.brief.archetype === "gift_directed" ||
    params.brief.archetype === "gift_vague";
  const budget = params.brief.budget ?? {
    amountCents: null,
    type: "none" as const,
    currency: "USD",
  };
  const verdict = judgePriceAgainstBudget(params.priceCents, budget, { isGift });
  const currency =
    params.currency ??
    budget.currency ??
    params.product?.variants?.[0]?.price?.currency ??
    "USD";
  const target = budget.amountCents;
  const budgetType = budget.type;
  let summary = "Within budget";
  if (target != null && params.priceCents != null) {
    if (verdict.hardViolation) {
      summary =
        budgetType === "hard"
          ? `Live price ${formatPriceLabel(params.priceCents, currency)} exceeds hard budget ${formatPriceLabel(target, currency)}`
          : `Live price ${formatPriceLabel(params.priceCents, currency)} exceeds soft budget cap (${budgetOverageCaveat(verdict.overageFraction)})`;
    } else if (verdict.over) {
      summary = `Live price ${formatPriceLabel(params.priceCents, currency)} is ${budgetOverageCaveat(verdict.overageFraction)} (allowed under soft budget)`;
    } else {
      summary = `Live price ${formatPriceLabel(params.priceCents, currency)} vs budget ${formatPriceLabel(target, currency)} (${budgetType})`;
    }
  }

  return {
    source: params.source,
    resolvedPriceCents: params.priceCents,
    resolvedPriceLabel: formatPriceLabel(params.priceCents, currency),
    resolvedOptions: params.product?.selected ?? params.selected,
    selectedRequested: params.selected,
    budget: {
      type: budgetType,
      targetCents: target,
      maxCents: budget.maxCents,
      currency,
      over: verdict.over,
      overageFraction: verdict.overageFraction,
      hardViolation: verdict.hardViolation,
      summary,
    },
  };
}

export type VerifiedCandidate = ScoredCandidate & {
  detail: CatalogProductDetail;
  /** Full unscoped product payload for tier-judge prompts (when deep-fetched). */
  judgeDetail?: CatalogProductDetail;
  availability: CardAvailability;
  resolvedPriceCents: number | null;
  nativeCheckoutUrl: string | null;
  resolvedOptions: SelectedOption[];
  /** True when the exact requested variant constraints were all matched. */
  exactMatch: boolean;
  /** Short note when constraints were relaxed (e.g. size sold out). */
  relaxedNote?: string;
  /** Deterministic listing-quality flags (regex pre-pass). */
  listingHygiene?: import("./listing-hygiene").ListingHygiene;
  /** How requested size mapped to this listing (debug + exactMatch). */
  sizeResolution?: SizeResolution;
};

/** Map brief variant constraints to catalog `selected` options. */
export function selectedFromConstraints(
  vc: VariantConstraints | undefined,
  sizeResolution?: SizeResolution,
): SelectedOption[] {
  const constraints = vc ?? {};
  const out: SelectedOption[] = [];
  if (constraints.size) {
    const label =
      sizeResolution?.status === "match" && sizeResolution.merchantLabel
        ? sizeResolution.merchantLabel
        : constraints.size;
    out.push({ name: "Size", label });
  }
  if (constraints.color) out.push({ name: "Color", label: constraints.color });
  for (const [name, label] of Object.entries(constraints.other ?? {})) {
    if (label) out.push({ name, label });
  }
  return out;
}

/** preferences drops from the END first → keep size last so it survives. */
function relaxationOrder(selected: SelectedOption[]): string[] {
  const sizeish = (n: string) => /size|fit|waist|inseam|length|ring/i.test(n);
  const sized = selected.filter((o) => sizeish(o.name)).map((o) => o.name);
  const rest = selected.filter((o) => !sizeish(o.name)).map((o) => o.name);
  return [...rest, ...sized];
}

/**
 * Pre-prune using unified size resolution — drop only confident mismatches.
 * Unknown (exotic merchant labels) proceeds to verify + batched LLM resolution.
 */
export function prePruneBySize(
  candidates: ScoredCandidate[],
  resolutions: SizeResolutionMap,
  sizeRequired: boolean,
): ScoredCandidate[] {
  if (!sizeRequired) return candidates;
  return candidates.filter((c) => {
    const r = resolutions.get(c.upid);
    if (!r) return false;
    if (r.status === "match" || r.status === "unknown") return true;
    return false;
  });
}

function resolvedPriceCurrency(detail: CatalogProductDetail): string | null {
  const v =
    detail.variants?.find((x) => x.id && x.checkout_url) ??
    detail.variants?.[0];
  const cur = v?.price?.currency;
  return typeof cur === "string" && cur.trim() ? cur.trim().toUpperCase() : null;
}

function priceForBudgetCheck(
  cents: number | null,
  fromCurrency: string | null | undefined,
  buyerCurrency: string | null | undefined,
  fxTable: FxRateTable | null | undefined,
): number | null {
  if (cents == null) return null;
  if (!fromCurrency || !buyerCurrency || !fxTable) return cents;
  return convertPriceCents(cents, fromCurrency, buyerCurrency, fxTable) ?? cents;
}

function resolvedPriceCents(detail: CatalogProductDetail): number | null {
  const v =
    detail.variants?.find((x) => x.id && x.checkout_url) ??
    detail.variants?.[0];
  const amt = v?.price?.amount;
  return typeof amt === "number" && Number.isFinite(amt) ? amt : null;
}

function nativeCheckoutUrl(detail: CatalogProductDetail): string | null {
  const v =
    detail.variants?.find((x) => x.id && x.checkout_url) ??
    detail.variants?.[0];
  // Prefer the variant permalink (already includes ?variant=…), else checkout.
  return v?.url ?? v?.checkout_url ?? null;
}

function isPurchasableInStock(availability: CardAvailability): boolean {
  return isCardAvailabilityPurchasable(availability);
}

export function hasVariantConstraints(brief: SearchBrief): boolean {
  const vc = brief.variantConstraints ?? {};
  if (vc.size?.trim()) return true;
  if (vc.color?.trim()) return true;
  return Object.values(vc.other ?? {}).some((v) => v?.trim());
}

/** Always verify via get_product — search summaries can be stale on stock. */
export function needsGetProduct(
  _candidate: ScoredCandidate,
  _brief: SearchBrief,
): boolean {
  return true;
}

function featuredVariant(product: CatalogProductSummary) {
  return (
    product.variants?.find((v) => v.checkout_url) ?? product.variants?.[0]
  );
}

export type VerifyAttemptOutcome =
  | { status: "verified"; candidate: VerifiedCandidate }
  | {
      status: "dropped";
      candidate: ScoredCandidate | VerifiedCandidate;
      reason: string;
      verifySnapshot?: VerifyDebugSnapshot;
      getProductDetail?: CatalogProductDetail;
    };

export type VerifyDropRecord = {
  candidate: ScoredCandidate | VerifiedCandidate;
  reason: string;
  stage: "pre_verify_prune" | "verify" | "size_exact";
  sizeResolution?: SizeResolution;
  verifySnapshot?: VerifyDebugSnapshot;
  getProductDetail?: CatalogProductDetail;
};

function verifyFromSearchSummary(
  candidate: ScoredCandidate,
  brief: SearchBrief,
  sizeResolution: SizeResolution | undefined,
  shipsToCountry?: string,
  locale?: { buyerCurrency?: string | null; fxTable?: FxRateTable | null },
): VerifyAttemptOutcome {
  const product = candidate.product;
  const variant = featuredVariant(product);
  const availability = availabilityFromSearchVariant(variant, shipsToCountry ? true : null);
  if (!availability || !isPurchasableInStock(availability)) {
    return {
      status: "dropped",
      candidate,
      reason: "Not in stock or unavailable for shipping region (search summary)",
    };
  }

  const nativeUrl = variant?.checkout_url ?? null;
  if (!nativeUrl) {
    return {
      status: "dropped",
      candidate,
      reason: "No native checkout URL",
    };
  }

  const rawPrice = candidatePriceCents(product);
  const price =
    candidatePriceCentsForBuyer(
      product,
      locale?.buyerCurrency,
      locale?.fxTable,
    ) ?? rawPrice;
  const isGift =
    brief.archetype === "gift_directed" || brief.archetype === "gift_vague";
  const selected = selectedFromConstraints(
    brief.variantConstraints,
    sizeResolution,
  );
  const verifySnapshot = buildVerifyDebugSnapshot({
    source: "search_summary",
    product: null,
    brief,
    selected,
    priceCents: price,
    currency: variant?.price?.currency,
  });
  const verdict = judgePriceAgainstBudget(price, brief.budget, { isGift });
  if (verdict.hardViolation) {
    return {
      status: "dropped",
      candidate,
      reason: "Hard budget violation",
      verifySnapshot,
    };
  }

  const sizeRequired = Boolean(brief.variantConstraints?.size?.trim());
  const exactMatch = isExactSizeVerified(
    sizeRequired,
    sizeResolution,
    availability.preferredMatched,
  );
  if (sizeRequired && !exactMatch) {
    return {
      status: "dropped",
      candidate,
      reason: formatSizeDropReason(sizeResolution),
    };
  }

  const detail = product as unknown as CatalogProductDetail;
  return {
    status: "verified",
    candidate: {
      ...candidate,
      detail,
      availability,
      resolvedPriceCents: rawPrice,
      nativeCheckoutUrl: nativeUrl,
      resolvedOptions: variant?.options ?? [],
      exactMatch,
      sizeResolution,
    },
  };
}

async function verifyOne(
  accessToken: string,
  candidate: ScoredCandidate,
  brief: SearchBrief,
  sizeResolution: SizeResolution | undefined,
  params: {
    shipsToCountry?: string;
    context?: CatalogSearchContext;
    buyerCurrency?: string | null;
    fxTable?: FxRateTable | null;
    signal?: AbortSignal;
    onMcpExchange?: (exchange: CatalogMcpExchange) => void;
  },
): Promise<VerifyAttemptOutcome> {
  const selected = selectedFromConstraints(
    brief.variantConstraints,
    sizeResolution,
  );

  const dropAfterGetProduct = (
    product: CatalogProductDetail,
    reason: string,
    priceCents: number | null = resolvedPriceCents(product),
  ): VerifyAttemptOutcome => ({
    status: "dropped",
    candidate,
    reason,
    getProductDetail: product,
    verifySnapshot: buildVerifyDebugSnapshot({
      source: "get_product",
      product,
      brief,
      selected,
      priceCents,
    }),
  });

  try {
    const filters = {
      available: true,
      ...(params.shipsToCountry
        ? { ships_to: { country: params.shipsToCountry } }
        : {}),
    };
    const { product } = await getProduct(accessToken, candidate.product.id, selected, {
      ...(selected.length ? { preferences: relaxationOrder(selected) } : {}),
      filters,
      context: buildCatalogCallContext(filters, params.context),
      signal: params.signal,
      onMcpExchange: params.onMcpExchange,
    });
    if (!product) {
      return {
        status: "dropped",
        candidate,
        reason: "Product not found in catalog",
      };
    }

    const availability = summarizePreferredAvailability(
      product,
      selected,
      params.shipsToCountry ? true : null,
    );
    if (!isPurchasableInStock(availability)) {
      return dropAfterGetProduct(
        product,
        availability.relaxedNote
          ? `Not purchasable in stock (${availability.relaxedNote})`
          : "Not purchasable in stock for selected options / shipping",
      );
    }

    const nativeUrl = nativeCheckoutUrl(product);
    if (!nativeUrl) {
      return dropAfterGetProduct(
        product,
        "No native checkout URL after verification",
      );
    }

    const rawPrice = resolvedPriceCents(product);
    const price = priceForBudgetCheck(
      rawPrice,
      resolvedPriceCurrency(product),
      params.buyerCurrency,
      params.fxTable,
    );
    const isGift =
      brief.archetype === "gift_directed" || brief.archetype === "gift_vague";
    const verdict = judgePriceAgainstBudget(price, brief.budget, { isGift });
    if (verdict.hardViolation) {
      return dropAfterGetProduct(
        product,
        "Hard budget violation after live price check",
        price,
      );
    }

    const sizeRequired = Boolean(brief.variantConstraints?.size?.trim());
    const exactMatch = isExactSizeVerified(
      sizeRequired,
      sizeResolution,
      availability.preferredMatched,
    );

    return {
      status: "verified",
      candidate: {
        ...candidate,
        detail: product,
        availability: {
          ...availability,
          ...(shouldSurfaceWithSizeVerification(
            sizeRequired,
            sizeResolution,
            availability.preferredMatched,
          )
            ? { sizeNeedsVerification: true }
            : {}),
        },
        resolvedPriceCents: rawPrice,
        nativeCheckoutUrl: nativeUrl,
        resolvedOptions: product.selected ?? selected,
        exactMatch,
        relaxedNote: availability.relaxedNote,
        sizeResolution,
      },
    };
  } catch (err) {
    logAiChat("warn", "verify_failed", {
      productId: candidate.product.id,
      error: String(err).slice(0, 160),
    });
    return {
      status: "dropped",
      candidate,
      reason: `Verification request failed: ${String(err).slice(0, 120)}`,
    };
  }
}

export type VerifyResult = {
  verified: VerifiedCandidate[];
  /** How many candidates we attempted to verify. */
  attempted: number;
  drops: VerifyDropRecord[];
  /** Per-candidate size resolution (UPID → resolution). */
  sizeResolutions: SizeResolutionMap;
};

/**
 * Verify the top candidates in score order with bounded concurrency, dropping
 * failures and back-filling from the ranked tail until `target` survive (or we
 * exhaust the pool / hit `maxAttempts`).
 */
export async function verifyCandidates(params: {
  accessToken: string;
  candidates: ScoredCandidate[];
  brief: SearchBrief;
  target: number;
  maxAttempts?: number;
  concurrency?: number;
  shipsToCountry?: string;
  context?: CatalogSearchContext;
  buyerCurrency?: string | null;
  fxTable?: FxRateTable | null;
  signal?: AbortSignal;
  onMcpExchange?: (exchange: CatalogMcpExchange) => void;
}): Promise<VerifyResult> {
  const drops: VerifyDropRecord[] = [];
  const buyerCurrency =
    params.buyerCurrency ??
    params.context?.currency ??
    params.brief.budget?.currency ??
    "USD";
  const sizeRequired = Boolean(params.brief.variantConstraints?.size?.trim());
  const sizeResolutions = await resolveSizeForCandidates({
    requestedSize: params.brief.variantConstraints?.size,
    candidates: params.candidates,
    brief: params.brief,
    signal: params.signal,
  });

  const ordered = prePruneBySize(
    params.candidates,
    sizeResolutions,
    sizeRequired,
  );
  const orderedUpids = new Set(ordered.map((c) => c.upid));
  for (const c of params.candidates) {
    if (!orderedUpids.has(c.upid)) {
      const resolution = sizeResolutions.get(c.upid);
      drops.push({
        candidate: c,
        reason: formatSizeDropReason(resolution),
        stage: "pre_verify_prune",
        sizeResolution: resolution,
      });
    }
  }

  const maxAttempts = Math.min(
    params.maxAttempts ?? 25,
    ordered.length,
  );
  const concurrency = Math.max(1, params.concurrency ?? 6);

  const verified: VerifiedCandidate[] = [];
  let attempted = 0;
  let cursor = 0;

  // Process in waves of `concurrency`, stop once `target` survive.
  while (cursor < maxAttempts && verified.length < params.target) {
    const batch = ordered.slice(cursor, cursor + concurrency);
    cursor += batch.length;
    attempted += batch.length;
    const results = await Promise.all(
      batch.map((c) => {
        const sizeResolution = sizeResolutions.get(c.upid);
        if (!needsGetProduct(c, params.brief)) {
          return Promise.resolve(
            verifyFromSearchSummary(
              c,
              params.brief,
              sizeResolution,
              params.shipsToCountry,
              { buyerCurrency, fxTable: params.fxTable },
            ),
          );
        }
        return verifyOne(params.accessToken, c, params.brief, sizeResolution, {
          shipsToCountry: params.shipsToCountry,
          context: params.context,
          buyerCurrency,
          fxTable: params.fxTable,
          signal: params.signal,
          onMcpExchange: params.onMcpExchange,
        });
      }),
    );
    for (const r of results) {
      if (r.status === "verified") verified.push(r.candidate);
      else
        drops.push({
          candidate: r.candidate,
          reason: r.reason,
          stage: "verify",
          sizeResolution: sizeResolutions.get(r.candidate.upid),
          verifySnapshot: r.verifySnapshot,
          getProductDetail: r.getProductDetail,
        });
    }
  }

  // Preserve score order (waves can interleave).
  verified.sort((a, b) => b.score - a.score);

  const strictVerified: VerifiedCandidate[] = [];
  for (const v of verified) {
    if (sizeRequired && !v.exactMatch) {
      if (
        shouldSurfaceWithSizeVerification(
          sizeRequired,
          v.sizeResolution,
          v.availability.preferredMatched,
        )
      ) {
        strictVerified.push({
          ...v,
          availability: { ...v.availability, sizeNeedsVerification: true },
        });
        continue;
      }
      drops.push({
        candidate: v,
        reason: v.relaxedNote
          ? `Exact size unavailable (${v.relaxedNote})`
          : formatSizeDropReason(v.sizeResolution),
        stage: "size_exact",
        sizeResolution: v.sizeResolution,
        getProductDetail: v.detail,
        verifySnapshot: buildVerifyDebugSnapshot({
          source: "get_product",
          product: v.detail,
          brief: params.brief,
          selected: selectedFromConstraints(
            params.brief.variantConstraints,
            v.sizeResolution,
          ),
          priceCents: v.resolvedPriceCents,
        }),
      });
      continue;
    }
    strictVerified.push(v);
  }

  return { verified: strictVerified, attempted, drops, sizeResolutions };
}

/** Build verify debug snapshot from a verified candidate (pipeline export). */
export function buildVerifyDebugSnapshotFromVerified(
  candidate: VerifiedCandidate,
  brief: SearchBrief,
): VerifyDebugSnapshot {
  return buildVerifyDebugSnapshot({
    source: "get_product",
    product: candidate.detail,
    brief,
    selected: selectedFromConstraints(
      brief.variantConstraints,
      candidate.sizeResolution,
    ),
    priceCents: candidate.resolvedPriceCents,
  });
}
