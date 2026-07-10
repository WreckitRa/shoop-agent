/**
 * Shared helpers for LLM query planners (gift + general portfolio).
 */
import { budgetRetrievalFilter } from "./budget";
import {
  buildSearchIntent,
  isValidCatalogQuery,
  queryContainsBannedToken,
  sanitizePortfolioQuery,
  sanitizeQueryText,
} from "./query-hygiene";
import { getCachedCategoryGid } from "./shopifyTaxonomyMap";
import type { Archetype, PortfolioQuery, SearchBrief } from "./types";

let queryCounter = 0;
function nextQueryId(prefix: string): string {
  queryCounter = (queryCounter + 1) % 1_000_000;
  return `${prefix}-${queryCounter}`;
}

function baseFilterFor(brief: SearchBrief): {
  priceMinCents?: number;
  priceMaxCents?: number;
  condition?: string[];
  categoryGid?: string;
} {
  const price = budgetRetrievalFilter(brief.budget);
  const categoryGid = brief.category
    ? getCachedCategoryGid(brief.category)
    : undefined;
  return {
    priceMinCents: price.priceMinCents,
    priceMaxCents: price.priceMaxCents,
    condition: brief.condition ?? ["new"],
    categoryGid,
  };
}

export function portfolioQueryFromText(
  brief: SearchBrief,
  text: string,
  opts: { wave: 1 | 2; isDiscovery?: boolean; intent?: string },
): PortfolioQuery | null {
  const f = baseFilterFor(brief);
  const intent = opts.intent ?? buildSearchIntent(brief) ?? brief.useCase ?? undefined;
  const draft: PortfolioQuery = {
    id: nextQueryId(opts.wave === 1 ? "w1" : "w2"),
    text,
    intent,
    wave: opts.wave,
    priceMinCents: f.priceMinCents,
    priceMaxCents: f.priceMaxCents,
    condition: f.condition,
    categoryGid: f.categoryGid,
    isDiscovery: opts.isDiscovery,
    directionLabel: brief.directionLabel,
  };
  return sanitizePortfolioQuery(draft, brief);
}

export function dedupePortfolioByText(queries: PortfolioQuery[]): PortfolioQuery[] {
  const seen = new Set<string>();
  const out: PortfolioQuery[] = [];
  for (const q of queries) {
    const k = q.text.toLowerCase();
    if (!q.text || seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

/** Target portfolio size by archetype (used to cap the merged set). */
export function portfolioBudget(
  archetype: Archetype,
  directionLabel?: string,
): { min: number; max: number } {
  if (
    (archetype === "gift_directed" || archetype === "gift_vague") &&
    directionLabel?.trim()
  ) {
    return { min: 4, max: 4 };
  }
  switch (archetype) {
    case "specific":
      return { min: 2, max: 3 };
    case "broad":
      return { min: 4, max: 5 };
    case "gift_directed":
    case "gift_vague":
      return { min: 4, max: 6 };
  }
}

export type PlannerRow = {
  text: string;
  intent?: string;
  is_discovery?: boolean;
};

export function parseQueryPlannerJson(text: string): PlannerRow[] {
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    const arr = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: PlannerRow[] = [];
    for (const item of arr) {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const raw = typeof o.text === "string" ? o.text.trim() : "";
        if (!raw) continue;
        const t = sanitizeQueryText(raw);
        if (!t || !isValidCatalogQuery(t) || queryContainsBannedToken(t)) continue;
        out.push({
          text: t,
          intent: typeof o.intent === "string" ? o.intent : undefined,
          is_discovery: o.is_discovery === true,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function withPlannerTimeout<T>(
  p: Promise<T>,
  ms: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** Abort after `ms` or when `parent` aborts — cancels in-flight fetch. */
export function abortAfterMs(
  ms: number,
  parent?: AbortSignal,
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  if (parent?.aborted) {
    controller.abort();
    return { signal: controller.signal, clear: () => {} };
  }
  const onParentAbort = () => controller.abort();
  parent?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}
