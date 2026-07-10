import { logAiChat } from "@/lib/ai-chat/observability";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import { fromMinorUnits, toMinorUnits } from "@/lib/money";
import {
  isGenderedDepartment,
  resolveDepartmentEvidence,
  resolveSearchDepartment,
} from "../department";
import { preNormalize } from "../normalize/pre-normalize";
import { taxonomyCategoriesForGarment } from "../catalog-search/garment-taxonomy";
import { productCategoryOutsideExpectedGids } from "../catalog-search/category-coverage";
import { checkItemType } from "./item-type";
import type { FashionSearchBrief } from "../router/types";
import type { FashionFactNoGoValue, FashionFactRow } from "../types";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import type { SearchPlanMode } from "../search-planner/types";
import type { ResolvedBudgetAllocation } from "../budget/budgetAllocation";
import {
  enforcedMaxMajor,
  guardMaxMajor,
  priceBoundsForSlot,
} from "../budget/budgetAllocation";
import {
  allVariantsExplicitlyUnavailable,
  evidenceTextsBySource,
  readProductAvailableForSale,
  type MaterialEvidenceSource,
} from "./evidence";
import {
  mentionsBannedMaterial,
  parseMaterialMentions,
  type MaterialMention,
} from "./material-parser";
import {
  formatResolvedSizeList,
  recipientSizeForGarment,
  shouldRunSizeHardDrop,
  sizeCorresponds,
} from "./size-match";
import type {
  HardDropRule,
  HardDropSlotResult,
  HardDroppedProduct,
  ProductSuspicion,
  SurvivorProduct,
} from "./types";

const SOURCE_RANK: Record<MaterialEvidenceSource, number> = {
  attribute: 3,
  title: 2,
  description: 1,
};

const PATTERN_STYLE_NO_GO_RE =
  /\b(pattern|print|flashy|loud|logos?|graphic)\b/i;

type DropDecision = { drop: HardDroppedProduct } | { survivor: SurvivorProduct };

function noGoFacts(facts: FashionFactRow[]): FashionFactNoGoValue[] {
  return facts
    .filter((f) => f.fact_type === "no_go")
    .map((f) => f.value as FashionFactNoGoValue);
}

function styleNoGos(facts: FashionFactRow[]): string[] {
  return noGoFacts(facts)
    .filter((n) => n.kind === "style")
    .map((n) => n.value);
}

function checkAvailability(product: FashionSlotCatalogProduct): HardDroppedProduct | null {
  const availableForSale = readProductAvailableForSale(product.raw);
  if (availableForSale === false) {
    return {
      product_id: product.id,
      rule: "unavailable",
      evidence: "availableForSale=false",
    };
  }
  if (allVariantsExplicitlyUnavailable(product.raw)) {
    return {
      product_id: product.id,
      rule: "unavailable",
      evidence: "all variants availability.available=false",
    };
  }
  return null;
}

/**
 * Tier 1.5 — after availability/budget, before size.
 * Evidence order: attribute → shop_departments → gendered category → title.
 * Unknown always survives (flagged); never negative.
 */
function checkDepartment(
  product: FashionSlotCatalogProduct,
  brief: FashionSearchBrief,
  suspicions: ProductSuspicion[],
): HardDroppedProduct | null {
  const department = resolveSearchDepartment({
    knowledgeDepartment: brief.knowledge_state?.department,
    departmentScope: brief.department_scope,
  });
  if (!isGenderedDepartment(department)) return null;

  const evidence = resolveDepartmentEvidence(
    {
      title: product.title ?? "",
      taxonomyCategory: product.taxonomy_category,
      attributes: extractCatalogAttributes(product.raw),
      shopGid: product.merchant_id?.startsWith("gid://shopify/Shop/")
        ? product.merchant_id
        : null,
      shopDomain: product.shop_domain,
    },
    department,
  );

  if (evidence.status === "mismatch") {
    return {
      product_id: product.id,
      rule: "department_mismatch",
      evidence: `${evidence.source}: ${evidence.evidence}`,
    };
  }
  if (evidence.status === "unknown") {
    suspicions.push({
      rule: "department_unknown",
      evidence: evidence.evidence,
      source_field: "department",
    });
  }
  // confirmed_match: no suspicion; scoring reads evidence again for boost
  return null;
}

/**
 * Positive attire verification — product carries a taxonomy category outside
 * the slot's expected GID family (including ancestors/descendants) → DROP.
 * No category → survives (unknown never drops).
 */
function checkCategoryMismatch(
  product: FashionSlotCatalogProduct,
  garment: string,
): HardDroppedProduct | null {
  const expected = taxonomyCategoriesForGarment(garment);
  if (!expected.length) return null;
  const result = productCategoryOutsideExpectedGids(product, expected);
  if (!result.mismatch) return null;
  return {
    product_id: product.id,
    rule: "category_mismatch",
    evidence: result.evidence,
  };
}

function checkBudget(
  product: FashionSlotCatalogProduct,
  brief: FashionSearchBrief,
  suspicions: ProductSuspicion[],
  budgetParams: {
    mode: SearchPlanMode;
    slotId: string;
    allocation?: ResolvedBudgetAllocation | null;
    profileCurrency: string;
    liftedMax?: number;
  },
): HardDroppedProduct | null {
  if (!brief.budget_context.stated) return null;

  const amount = product.price?.amount;
  if (amount == null || !Number.isFinite(amount)) {
    suspicions.push({
      rule: "no_price",
      evidence: "missing price for budget check",
      source_field: "price",
    });
    return null;
  }

  const bounds = priceBoundsForSlot({
    brief,
    mode: budgetParams.mode,
    slotId: budgetParams.slotId,
    allocation: budgetParams.allocation,
    profileCurrency: budgetParams.profileCurrency,
    liftedMax: budgetParams.liftedMax,
    purpose: "client_enforcement",
  });
  if (!bounds) return null;

  const ctx = brief.budget_context;
  const briefCurrency = ctx.currency?.trim().toUpperCase();
  const priceCurrency = product.price?.currency?.trim().toUpperCase();
  if (briefCurrency && priceCurrency && briefCurrency !== priceCurrency) {
    return null;
  }

  if (bounds.max != null && amount > bounds.max) {
    return {
      product_id: product.id,
      rule: "budget",
      evidence: `price ${amount} > padded max ${bounds.max}`,
    };
  }
  if (bounds.min != null && amount < bounds.min) {
    return {
      product_id: product.id,
      rule: "budget",
      evidence: `price ${amount} < padded min ${bounds.min}`,
    };
  }
  return null;
}

function checkSize(
  product: FashionSlotCatalogProduct,
  garment: string,
  brief: FashionSearchBrief,
  facts: FashionFactRow[],
  suspicions: ProductSuspicion[],
): HardDroppedProduct | null {
  if (!shouldRunSizeHardDrop(brief, garment, facts)) return null;

  const recipient = recipientSizeForGarment(facts, garment);
  if (!recipient) return null;

  const sizeFields = product.normalized?.sizes ?? [];
  if (!sizeFields.length) return null;

  if (sizeFields.some((s) => s.status === "unknown")) {
    suspicions.push({
      rule: "size_unknown",
      evidence: "unresolved size variant labels",
      source_field: "normalized.sizes",
    });
    return null;
  }

  const resolved = sizeFields.filter((s) => s.status === "resolved" && s.size);
  if (!resolved.length) return null;

  let anyExact = false;
  let anyPossible = false;

  for (const field of resolved) {
    const match = sizeCorresponds(field.size!, recipient);
    if (match === "exact") anyExact = true;
    if (match === "possible") anyPossible = true;
  }

  if (anyExact) return null;

  if (anyPossible) {
    suspicions.push({
      rule: "size_system_unverified",
      evidence: "ambiguous numeric sizes may match recipient",
      source_field: "normalized.sizes",
    });
    return null;
  }

  return {
    product_id: product.id,
    rule: "size_mismatch",
    evidence: formatResolvedSizeList(
      resolved.map((r) => ({ raw: r.raw, size: r.size })),
    ),
  };
}

function checkColorNoGo(
  product: FashionSlotCatalogProduct,
  bannedColors: string[],
  suspicions: ProductSuspicion[],
): HardDroppedProduct | null {
  const colors = product.normalized?.colors;
  if (!colors || colors.status !== "resolved" || !colors.buckets.length) return null;

  const buckets = colors.buckets.map((b) => preNormalize(b));
  for (const banned of bannedColors) {
    const key = preNormalize(banned);
    if (!buckets.includes(key)) continue;

    if (buckets.length === 1 && buckets[0] === key) {
      return {
        product_id: product.id,
        rule: "color_no_go",
        evidence: `resolved color buckets: [${colors.buckets.join(", ")}]`,
      };
    }

    suspicions.push({
      rule: "color_two_tone",
      evidence: `banned color ${banned} among buckets [${colors.buckets.join(", ")}]`,
      source_field: "normalized.colors",
    });
  }
  return null;
}

/**
 * Garment no-gos use Shopify taxonomy GIDs only — never title/text matching.
 * Rationale: "shorts" text-matches "short-sleeve shirt", "boardshorts",
 * "shorts-inspired"; "tank" matches "tank-stitch knit". Taxonomy is the only
 * trustworthy garment signal.
 */
function productTaxonomyMatchesBannedGarment(
  product: FashionSlotCatalogProduct,
  bannedGarment: string,
): boolean {
  const bannedGids = taxonomyCategoriesForGarment(bannedGarment);
  if (!bannedGids.length) return false;

  const productTax = product.taxonomy_category?.trim();
  if (!productTax) return false;

  for (const gid of bannedGids) {
    if (productTax === gid || productTax.includes(gid)) return true;
    const gidSuffix = gid.split("/").pop();
    const productSuffix = productTax.includes("TaxonomyCategory/")
      ? productTax.split("/").pop()
      : productTax;
    if (gidSuffix && productSuffix && gidSuffix === productSuffix) return true;
    const entryLabel = bannedGarment.trim().toLowerCase();
    if (productTax.toLowerCase() === entryLabel) return true;
  }
  return false;
}

function checkGarmentNoGo(
  product: FashionSlotCatalogProduct,
  bannedGarments: string[],
): HardDroppedProduct | null {
  for (const banned of bannedGarments) {
    if (productTaxonomyMatchesBannedGarment(product, banned)) {
      return {
        product_id: product.id,
        rule: "garment_no_go",
        evidence: `taxonomy ${product.taxonomy_category} matches banned garment ${banned}`,
      };
    }
  }
  return null;
}

type MaterialVerdict =
  | { action: "drop"; evidence: string }
  | { action: "suspect"; suspicion: ProductSuspicion }
  | { action: "clear" };

function verdictForMention(params: {
  mention: MaterialMention;
  source: MaterialEvidenceSource;
  text: string;
  banned: string;
}): MaterialVerdict | null {
  const { mention, source, text, banned } = params;
  if (mention.polarity === "absent") {
    return {
      action: "clear",
    };
  }
  if (mention.polarity === "faux") return null;

  const pct = mention.percentage;
  if (source === "attribute") {
    return {
      action: "drop",
      evidence: `${source}: ${text} (${banned} present${pct != null ? ` ${pct}%` : ""})`,
    };
  }
  if (source === "title") {
    if (pct == null || pct >= 30) {
      return {
        action: "drop",
        evidence: `${source}: ${text} (${banned} present${pct != null ? ` ${pct}%` : ""})`,
      };
    }
    return {
      action: "suspect",
      suspicion: {
        rule: `material_suspected:${banned}`,
        evidence: `${source}: ${text} (${pct}% ${banned})`,
        source_field: source,
      },
    };
  }
  return {
    action: "suspect",
    suspicion: {
      rule: `material_suspected:${banned}`,
      evidence: `${source}: ${text}${pct != null ? ` (${pct}% ${banned})` : ""}`,
      source_field: source,
    },
  };
}

function checkMaterialNoGo(
  product: FashionSlotCatalogProduct,
  bannedMaterials: string[],
  suspicions: ProductSuspicion[],
): HardDroppedProduct | null {
  const bySource = evidenceTextsBySource(product);
  const activeSuspicions = new Map<string, ProductSuspicion>();

  for (const banned of bannedMaterials) {
    for (const source of ["attribute", "title", "description"] as const) {
      for (const text of bySource[source]) {
        const hits = mentionsBannedMaterial(parseMaterialMentions(text), banned);
        for (const mention of hits) {
          const verdict = verdictForMention({ mention, source, text, banned });
          if (!verdict) continue;

          if (verdict.action === "drop") {
            return {
              product_id: product.id,
              rule: "material_no_go",
              evidence: verdict.evidence,
            };
          }
          if (verdict.action === "suspect") {
            activeSuspicions.set(`${banned}::${source}`, verdict.suspicion);
          }
          if (verdict.action === "clear") {
            const weaker = ["description", "title", "attribute"] as const;
            for (const s of weaker) {
              if (SOURCE_RANK[s] <= SOURCE_RANK[source]) {
                activeSuspicions.delete(`${banned}::${s}`);
              }
            }
          }
        }
      }
    }
  }

  for (const suspicion of activeSuspicions.values()) {
    suspicions.push(suspicion);
  }
  return null;
}

function applyPatternStyleAssist(
  product: FashionSlotCatalogProduct,
  styleNoGoValues: string[],
  suspicions: ProductSuspicion[],
): void {
  const hasPatternNoGo = styleNoGoValues.some((v) => PATTERN_STYLE_NO_GO_RE.test(v));
  if (!hasPatternNoGo) return;
  const buckets = product.normalized?.colors?.buckets ?? [];
  if (buckets.includes("print")) {
    suspicions.push({
      rule: "pattern_suspected",
      evidence: "normalized color bucket print with pattern-related style no-go",
      source_field: "normalized.colors",
    });
  }
}

function evaluateProduct(params: {
  product: FashionSlotCatalogProduct;
  garment: string;
  brief: FashionSearchBrief;
  recipientFacts: FashionFactRow[];
  styleNoGoValues: string[];
  mode: SearchPlanMode;
  slotId: string;
  allocation?: ResolvedBudgetAllocation | null;
  profileCurrency: string;
  liftedMax?: number;
}): DropDecision {
  const suspicions: ProductSuspicion[] = [];
  const noGos = noGoFacts(params.recipientFacts);

  const colorBans = noGos.filter((n) => n.kind === "color").map((n) => n.value);
  const garmentBans = noGos.filter((n) => n.kind === "garment").map((n) => n.value);
  const materialBans = noGos.filter((n) => n.kind === "material").map((n) => n.value);

  const checks: Array<HardDroppedProduct | null> = [
    checkAvailability(params.product),
    checkDepartment(params.product, params.brief, suspicions),
    checkCategoryMismatch(params.product, params.garment),
    checkItemType(params.product, params.garment, params.brief),
    checkBudget(params.product, params.brief, suspicions, {
      mode: params.mode,
      slotId: params.slotId,
      allocation: params.allocation,
      profileCurrency: params.profileCurrency,
      liftedMax: params.liftedMax,
    }),
    checkSize(params.product, params.garment, params.brief, params.recipientFacts, suspicions),
    checkColorNoGo(params.product, colorBans, suspicions),
    checkGarmentNoGo(params.product, garmentBans),
    checkMaterialNoGo(params.product, materialBans, suspicions),
  ];

  for (const drop of checks) {
    if (drop) return { drop };
  }

  applyPatternStyleAssist(params.product, params.styleNoGoValues, suspicions);

  return {
    survivor: {
      ...params.product,
      suspicions,
    },
  };
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[idx] ?? null;
}

function computeMarketPricesFromLaneB(
  products: FashionSlotCatalogProduct[],
): HardDropSlotResult["market_prices"] {
  const laneB = products.filter((p) => p.matched_by_lanes?.includes("B"));
  const prices = laneB
    .map((p) => p.price?.amount)
    .filter((a): a is number => a != null && Number.isFinite(a))
    .map((cents) => fromMinorUnits(cents));
  if (!prices.length) return undefined;
  const p10 = percentile(prices, 0.1);
  const p50 = percentile(prices, 0.5);
  const p90 = percentile(prices, 0.9);
  if (p10 == null || p50 == null || p90 == null) return undefined;
  return {
    p10,
    p50,
    p90,
    min_viable: Math.min(...prices),
    sample_size: prices.length,
  };
}

export function applyHardDrops(params: {
  traceId?: string | null;
  slot: { slot_id: string; garment: string };
  products: FashionSlotCatalogProduct[];
  recipientFacts: FashionFactRow[];
  brief: FashionSearchBrief;
  mode?: SearchPlanMode;
  allocation?: ResolvedBudgetAllocation | null;
  profileCurrency?: string;
  liftedMax?: number;
}): HardDropSlotResult {
  const survivors: SurvivorProduct[] = [];
  const dropped: HardDroppedProduct[] = [];
  const budget_dropped_pool: FashionSlotCatalogProduct[] = [];
  const styleNoGoValues = styleNoGos(params.recipientFacts);
  const mode = params.mode ?? params.brief.request_type;
  const profileCurrency =
    params.profileCurrency ??
    params.brief.budget_context.currency ??
    "USD";

  // Phase 1: availability + department + category (measure market before budget).
  const afterAttire: FashionSlotCatalogProduct[] = [];
  for (const product of params.products) {
    try {
      const suspicions: ProductSuspicion[] = [];
      const early =
        checkAvailability(product) ??
        checkDepartment(product, params.brief, suspicions) ??
        checkCategoryMismatch(product, params.slot.garment) ??
        checkItemType(product, params.slot.garment, params.brief);
      if (early) {
        dropped.push(early);
        continue;
      }
      afterAttire.push(product);
    } catch (error) {
      logAiChat("warn", "fashion_hard_drop_product_error", {
        traceId: params.traceId,
        slot_id: params.slot.slot_id,
        product_id: product.id,
        phase: "attire",
        error: String(error).slice(0, 240),
      });
      // Never auto-survive attire gates on check errors.
      dropped.push({
        product_id: product.id,
        rule: "drop_check_error",
        evidence: String(error).slice(0, 240),
      });
    }
  }

  const market_prices = computeMarketPricesFromLaneB(afterAttire);

  // Phase 2: budget + remaining checks.
  for (const product of afterAttire) {
    try {
      const result = evaluateProduct({
        product,
        garment: params.slot.garment,
        brief: params.brief,
        recipientFacts: params.recipientFacts,
        styleNoGoValues,
        mode,
        slotId: params.slot.slot_id,
        allocation: params.allocation,
        profileCurrency,
        liftedMax: params.liftedMax,
      });
      // Re-run only budget+rest — attire already passed. Skip re-checking attire
      // by using full evaluateProduct but products already cleared attire.
      // evaluateProduct re-checks attire (idempotent) then budget/size/...
      if ("drop" in result) {
        dropped.push(result.drop);
        if (result.drop.rule === "budget") {
          budget_dropped_pool.push(product);
        }
      } else {
        survivors.push(result.survivor);
      }
    } catch (error) {
      logAiChat("warn", "fashion_hard_drop_product_error", {
        traceId: params.traceId,
        slot_id: params.slot.slot_id,
        product_id: product.id,
        phase: "budget_rest",
        error: String(error).slice(0, 240),
      });
      dropped.push({
        product_id: product.id,
        rule: "drop_check_error",
        evidence: String(error).slice(0, 240),
      });
    }
  }

  const enforcedMajor = enforcedMaxMajor({
    brief: params.brief,
    mode,
    slotId: params.slot.slot_id,
    allocation: params.allocation,
    liftedMax: params.liftedMax,
  });
  const guardMajor =
    enforcedMajor != null ? guardMaxMajor(enforcedMajor) : null;
  const enforcedCents =
    enforcedMajor != null ? toMinorUnits(enforcedMajor) : null;
  const guardCents = guardMajor != null ? toMinorUnits(guardMajor) : null;

  let guard_band_count = 0;
  if (enforcedCents != null && guardCents != null) {
    for (const p of params.products) {
      const amount = p.price?.amount;
      if (amount == null || !Number.isFinite(amount)) continue;
      if (amount > enforcedCents && amount <= guardCents) {
        guard_band_count += 1;
      }
    }
  }

  return {
    survivors,
    dropped,
    curator_exclusions: styleNoGoValues,
    market_prices,
    budget_dropped_pool,
    guard_band_count,
  };
}
