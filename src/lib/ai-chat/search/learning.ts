/**
 * Stage 6 — Learning Flywheel (docs/search-improvements.md §13).
 *
 * Read/write side of the learning loop that the engine + portfolio consume:
 *  - Negative space: `FeedbackEvent` rejections → per-scope avoid set → Fit penalty.
 *  - Refine rounds: previously shown UPIDs/ids → `excludedKeys` so "show more"
 *    never repeats a product.
 *  - Query-yield fold: aggregate `SearchQueryYield` into per-(archetype,category)
 *    learned query angles that bias the wave-1 portfolio.
 *
 * Everything degrades gracefully (best-effort reads; engine still runs if these
 * return empty). No new tables beyond the Phase 0 migration.
 */
import { prisma } from "../db";
import { logAiChat } from "../observability";
import {
  isValidCatalogQuery,
  queryContainsBannedToken,
  sanitizeQueryText,
} from "./query-hygiene";
import type { FeedbackAvoidSet } from "./scoring";
import type { Archetype, SearchBrief } from "./types";

/** Scope keys we consult for a brief's avoid set (most → least specific). */
function avoidScopesForBrief(brief: SearchBrief): string[] {
  const scopes = new Set<string>(["global"]);
  if (brief.category) scopes.add(`category:${brief.category.toLowerCase()}`);
  if (brief.recipient?.kind === "other" && brief.recipient.label) {
    scopes.add(`recipient:${brief.recipient.label.toLowerCase()}`);
  }
  return [...scopes];
}

type FeedbackEventRow = {
  productExternalId: string | null;
  upid: string | null;
  attributes: string[];
};

/**
 * Build the negative-space avoid set for a search from prior `FeedbackEvent`s.
 * Demotes (not hard-excludes) previously rejected products/attributes via the
 * scoring Fit penalty.
 */
export async function loadFeedbackAvoidSet(
  userId: string,
  brief: SearchBrief,
  limit = 200,
): Promise<FeedbackAvoidSet | undefined> {
  try {
    const delegate = (
      prisma as unknown as {
        feedbackEvent?: {
          findMany?: (args: unknown) => Promise<FeedbackEventRow[]>;
        };
      }
    ).feedbackEvent;
    if (!delegate?.findMany) return undefined;
    const scopes = avoidScopesForBrief(brief);
    const rows = await delegate.findMany({
      where: { userId, scope: { in: scopes } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { productExternalId: true, upid: true, attributes: true },
    });
    if (!rows.length) return undefined;
    const avoidUpids = new Set<string>();
    const avoidProductIds = new Set<string>();
    const avoidAttributes = new Set<string>();
    for (const r of rows) {
      if (r.upid) avoidUpids.add(r.upid);
      if (r.productExternalId) avoidProductIds.add(r.productExternalId);
      for (const a of r.attributes ?? []) {
        const t = a.trim().toLowerCase();
        if (t.length >= 2) avoidAttributes.add(t);
      }
    }
    return {
      avoidUpids,
      avoidProductIds,
      avoidAttributes: [...avoidAttributes],
    };
  } catch (error) {
    logAiChat("warn", "feedback_avoid_load_failed", {
      userId,
      error: String(error).slice(0, 160),
    });
    return undefined;
  }
}

/** Persist a rejection so future searches demote the product/attributes. */
export async function recordFeedbackEvent(params: {
  userId: string;
  conversationId?: string | null;
  messageId?: string | null;
  productExternalId?: string | null;
  upid?: string | null;
  reason?: string | null;
  scope?: string;
  archetype?: Archetype | null;
  attributes?: string[];
}): Promise<void> {
  try {
    const delegate = (
      prisma as unknown as {
        feedbackEvent?: {
          create?: (args: { data: Record<string, unknown> }) => Promise<unknown>;
        };
      }
    ).feedbackEvent;
    if (!delegate?.create) return;
    await delegate.create({
      data: {
        userId: params.userId,
        conversationId: params.conversationId ?? null,
        messageId: params.messageId ?? null,
        productExternalId: params.productExternalId ?? null,
        upid: params.upid ?? null,
        reason: params.reason?.slice(0, 500) ?? null,
        scope: params.scope ?? "global",
        archetype: params.archetype ?? null,
        attributes: (params.attributes ?? [])
          .map((a) => a.trim().toLowerCase())
          .filter((a) => a.length >= 2)
          .slice(0, 12),
      },
    });
  } catch (error) {
    logAiChat("warn", "feedback_event_record_failed", {
      userId: params.userId,
      error: String(error).slice(0, 160),
    });
  }
}

/**
 * Previously shown product keys (UPID + external id) for a conversation, used to
 * dedupe refine rounds ("show me more") so we never repeat a product.
 */
export async function loadExcludedKeysForConversation(
  conversationId: string,
  limit = 400,
): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const rows = await prisma.productCuration.findMany({
      where: { conversationId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { productExternalId: true, upid: true },
    });
    for (const r of rows) {
      if (r.upid) keys.add(r.upid);
      if (r.productExternalId) keys.add(r.productExternalId);
    }
  } catch (error) {
    logAiChat("warn", "excluded_keys_load_failed", {
      conversationId,
      error: String(error).slice(0, 160),
    });
  }
  return keys;
}

export type LearnedQueryAngle = {
  queryText: string;
  /** Mean candidates contributed to the de-duped pool. */
  avgPoolContribution: number;
  samples: number;
};

/**
 * Read high-yield query angles for a category/archetype from recent
 * `SearchQueryYield` rows. Consumed by the portfolio to bias wave-1 with
 * learned angles instead of pure guesses. Returns [] when there's no signal.
 */
/** Whether learned angles are scoped enough to be safe for this brief. */
export function learnedAnglesScopeKey(params: {
  archetype?: Archetype;
  category?: string | null;
  directionLabel?: string | null;
}): string | null {
  const direction = params.directionLabel?.trim();
  const category = params.category?.trim();
  if (params.archetype === "gift_directed" || params.archetype === "gift_vague") {
    return direction || null;
  }
  return category || null;
}

export async function getLearnedQueryAngles(params: {
  category?: string | null;
  archetype?: Archetype;
  directionLabel?: string | null;
  limit?: number;
  minSamples?: number;
}): Promise<LearnedQueryAngle[]> {
  const { category, archetype, directionLabel } = params;
  const scope = learnedAnglesScopeKey({ archetype, category, directionLabel });
  if (!scope) return [];
  try {
    const delegate = (
      prisma as unknown as {
        searchQueryYield?: {
          findMany?: (args: unknown) => Promise<
            Array<{ queryText: string; poolContribution: number }>
          >;
        };
      }
    ).searchQueryYield;
    if (!delegate?.findMany) return [];
    const isGift =
      archetype === "gift_directed" || archetype === "gift_vague";
    const rows = await delegate.findMany({
      where: {
        ...(archetype ? { archetype } : {}),
        ...(isGift
          ? { directionLabel: directionLabel!.trim() }
          : category
            ? { category }
            : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { queryText: true, poolContribution: true },
    });
    const agg = new Map<
      string,
      { sum: number; n: number; text: string }
    >();
    for (const r of rows) {
      const key = r.queryText.trim().toLowerCase();
      if (!key) continue;
      const cur = agg.get(key) ?? { sum: 0, n: 0, text: r.queryText.trim() };
      cur.sum += r.poolContribution;
      cur.n += 1;
      agg.set(key, cur);
    }
    const minSamples = params.minSamples ?? 2;
    return [...agg.values()]
      .filter((a) => a.n >= minSamples)
      .filter((a) => {
        const cleaned = sanitizeQueryText(a.text);
        return (
          isValidCatalogQuery(cleaned) && !queryContainsBannedToken(cleaned)
        );
      })
      .map((a) => ({
        queryText: a.text,
        avgPoolContribution: a.sum / a.n,
        samples: a.n,
      }))
      .sort((a, b) => b.avgPoolContribution - a.avgPoolContribution)
      .slice(0, params.limit ?? 3);
  } catch (error) {
    logAiChat("warn", "learned_angles_load_failed", {
      error: String(error).slice(0, 160),
    });
    return [];
  }
}

export type FoldedYieldRow = {
  archetype: string | null;
  category: string | null;
  queryText: string;
  samples: number;
  avgRawCount: number;
  avgPoolContribution: number;
};

/**
 * Nightly fold: aggregate `SearchQueryYield` into per-(archetype,category,query)
 * pattern weights. Returns the folded table (callers may persist/log it). Kept
 * pure-read so it can run from a cron route without side effects beyond logging.
 */
export async function foldSearchQueryYields(params?: {
  sinceDays?: number;
  minSamples?: number;
}): Promise<FoldedYieldRow[]> {
  const sinceDays = params?.sinceDays ?? 30;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  try {
    const delegate = (
      prisma as unknown as {
        searchQueryYield?: {
          findMany?: (args: unknown) => Promise<
            Array<{
              archetype: string | null;
              category: string | null;
              queryText: string;
              rawCount: number;
              poolContribution: number;
            }>
          >;
        };
      }
    ).searchQueryYield;
    if (!delegate?.findMany) return [];
    const rows = await delegate.findMany({
      where: { createdAt: { gte: since } },
      take: 20000,
      select: {
        archetype: true,
        category: true,
        queryText: true,
        rawCount: true,
        poolContribution: true,
      },
    });
    const agg = new Map<
      string,
      {
        archetype: string | null;
        category: string | null;
        text: string;
        raw: number;
        pool: number;
        n: number;
      }
    >();
    for (const r of rows) {
      const text = r.queryText.trim();
      if (!text) continue;
      const key = `${r.archetype ?? ""}|${r.category ?? ""}|${text.toLowerCase()}`;
      const cur =
        agg.get(key) ??
        {
          archetype: r.archetype,
          category: r.category,
          text,
          raw: 0,
          pool: 0,
          n: 0,
        };
      cur.raw += r.rawCount;
      cur.pool += r.poolContribution;
      cur.n += 1;
      agg.set(key, cur);
    }
    const minSamples = params?.minSamples ?? 2;
    const folded = [...agg.values()]
      .filter((a) => a.n >= minSamples)
      .map((a) => ({
        archetype: a.archetype,
        category: a.category,
        queryText: a.text,
        samples: a.n,
        avgRawCount: a.raw / a.n,
        avgPoolContribution: a.pool / a.n,
      }))
      .sort((a, b) => b.avgPoolContribution - a.avgPoolContribution);
    logAiChat("info", "search_query_yield_folded", {
      sinceDays,
      inputRows: rows.length,
      foldedRows: folded.length,
    });
    return folded;
  } catch (error) {
    logAiChat("warn", "search_query_yield_fold_failed", {
      error: String(error).slice(0, 160),
    });
    return [];
  }
}
