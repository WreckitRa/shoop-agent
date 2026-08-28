/**
 * L5 taste rerank — Haiku rates top-40 (anchor) / top-20 (support)
 * hard-drop survivors on attributes only, before hydration.
 * Fail-open: taste_fit stays null, prior score stands.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { logAiChat } from "@/lib/ai-chat/observability";
import { tracedLLMCall } from "../observability/traced-llm-call";
import { recordPipelineEvent } from "../observability/trace";
import { FASHION_TASTE_RERANK_MODEL } from "../models";
import { TASTE_RERANK_HARD_MS } from "../pipeline-cutoffs";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlanSlot } from "../search-planner/types";
import type { FashionFactRow } from "../types";
import type {
  FashionSlotCatalogProduct,
  FashionSlotCatalogResult,
} from "../catalog-search/types";
import { extractProductTasteAttributes } from "./taste-fit";
import { scoreSlotProducts } from "./orchestrator";
import { hydrationTargetCount } from "../hydration/config";

/** Keep in sync with docs/fashion/taste_rerank.md verbatim fence. */
export const TASTE_RERANK_PROMPT = `You are the buyer's assistant for a personal shopper. You receive the
client's known taste (signals with like/dislike polarity and how sure we
are), the stylist's direction for this pull, and a list of candidate
products described by their attributes only. For each candidate, rate
how well it fits THIS client for THIS pull, integer 0 to 10:
  · Weigh stated signals above inferred ones; dislikes count double.
  · preference_anchor "keep": fit = closeness to their known lane.
  · "push": fit rewards their lane AND one adjacent step; mark lane.
  · "explore": fit rewards pieces OUTSIDE their dominant signals that
    still suit the occasion and style direction; do not reward their
    usual lane. Mark lane "new" for those.
  · Under explore, a candidate matching the client's dominant signal
    scores ≤ 3 unless occasion leaves no alternative.
  · A candidate matching the client's dominant signal is lane "usual"
    regardless of score.
  · Never penalize unknown attributes; rate on what is known.
  · Occasion and style direction are binding; a beautiful piece for the
    wrong occasion is a low fit.
Rate every candidate. Call rate_taste_fit once. No prose.`;

export const TASTE_RERANK_TOP_N = 40;
/** Support: one 20-batch. Capsule cost is call count, not the 30-item cap. */
export const TASTE_RERANK_TOP_N_SUPPORT = 20;
export const TASTE_RERANK_BATCH = 20;
export const RATE_TASTE_FIT_TOOL_NAME = "rate_taste_fit";

export function tasteRerankTopN(role: FashionSearchPlanSlot["role"]): number {
  return role === "support" ? TASTE_RERANK_TOP_N_SUPPORT : TASTE_RERANK_TOP_N;
}

/** ~25 tokens/candidate + slack — sized to {ref, score, lane} with no why. */
export function tasteRerankMaxTokens(candidateCount: number): number {
  return 25 * Math.max(1, candidateCount) + 80;
}

export type TasteLane = "usual" | "adjacent" | "new";

export type TasteRating = {
  /** 0..1 after dividing the model's 0–10 score. */
  taste_fit: number;
  lane: TasteLane;
};

export type TasteRerankStats = {
  calls: number;
  aborted: number;
  rated: number;
  input_tokens: number;
  output_tokens: number;
  cache_hits: number;
};

function emptyTasteRerankStats(): TasteRerankStats {
  return {
    calls: 0,
    aborted: 0,
    rated: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_hits: 0,
  };
}

function addTasteRerankStats(
  a: TasteRerankStats,
  b: TasteRerankStats,
): TasteRerankStats {
  return {
    calls: a.calls + b.calls,
    aborted: a.aborted + b.aborted,
    rated: a.rated + b.rated,
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_hits: a.cache_hits + b.cache_hits,
  };
}

const laneSchema = z.enum(["usual", "adjacent", "new"]);

const ratingRowSchema = z.object({
  ref: z.string().min(1).max(40),
  score: z.number().min(0).max(10),
  lane: laneSchema,
});

const rateTasteFitSchema = z.object({
  ratings: z.array(ratingRowSchema).min(1).max(TASTE_RERANK_BATCH),
});

export const RATE_TASTE_FIT_TOOL = {
  name: RATE_TASTE_FIT_TOOL_NAME,
  description:
    "Rate every candidate's taste fit for this client and this pull.",
  input_schema: {
    type: "object" as const,
    properties: {
      ratings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string" },
            score: { type: "integer", minimum: 0, maximum: 10 },
            lane: { type: "string", enum: ["usual", "adjacent", "new"] },
          },
          required: ["ref", "score", "lane"],
        },
      },
    },
    required: ["ratings"],
  },
};

function priceBand(amount: number | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "unknown";
  if (amount < 50) return "low";
  if (amount < 150) return "mid";
  return "high";
}

function joinAttrs(values: string[]): string {
  return values.length ? values.join(",") : "unknown";
}

/** Attribute card only — never titles or images. */
export function candidateAttributeCard(
  product: FashionSlotCatalogProduct,
  garment: string,
): Record<string, string> {
  const attrs = extractProductTasteAttributes(product);
  return {
    garment,
    color: joinAttrs(attrs.color),
    style: joinAttrs(attrs.style),
    silhouette: joinAttrs(attrs.silhouette),
    material: joinAttrs(attrs.material),
    pattern: joinAttrs(attrs.pattern),
    brand: joinAttrs(attrs.brand),
    price_band: priceBand(product.price?.amount),
  };
}

export function hashTasteSignals(
  signals: Array<{ signal_type: string; value: string; polarity: number }>,
): string {
  const normalized = [...signals]
    .map((s) => ({
      t: s.signal_type.trim().toLowerCase(),
      v: s.value.trim().toLowerCase(),
      p: s.polarity >= 0 ? 1 : -1,
    }))
    .sort((a, b) =>
      a.t === b.t ? (a.v < b.v ? -1 : a.v > b.v ? 1 : a.p - b.p) : a.t < b.t ? -1 : 1,
    );
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

type CacheKey = string;
const tasteCache = new Map<CacheKey, TasteRating>();
const TASTE_CACHE_MAX = 4000;

function cacheKey(params: {
  productId: string;
  recipientPersonId: string;
  anchor: string;
  signalsHash: string;
}): CacheKey {
  return `${params.productId}:${params.recipientPersonId}:${params.anchor}:${params.signalsHash}`;
}

function cacheGet(key: CacheKey): TasteRating | undefined {
  return tasteCache.get(key);
}

function cacheSet(key: CacheKey, value: TasteRating): void {
  if (tasteCache.size >= TASTE_CACHE_MAX) {
    const oldest = tasteCache.keys().next().value;
    if (oldest) tasteCache.delete(oldest);
  }
  tasteCache.set(key, value);
}

/** Test helper — not used in production. */
export function clearTasteRerankCache(): void {
  tasteCache.clear();
}

function parseRatings(input: unknown): Map<string, TasteRating> {
  const parsed = rateTasteFitSchema.safeParse(input);
  const out = new Map<string, TasteRating>();
  if (!parsed.success) return out;
  for (const row of parsed.data.ratings) {
    out.set(row.ref, {
      taste_fit: Math.round(row.score) / 10,
      lane: row.lane,
    });
  }
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function applyExploreDiversityPass(
  products: FashionSlotCatalogProduct[],
  optionsWanted: number,
): FashionSlotCatalogProduct[] {
  const target = hydrationTargetCount(optionsWanted);
  const cap = Math.max(1, Math.ceil(target / 3));
  const taken: FashionSlotCatalogProduct[] = [];
  const deferred: FashionSlotCatalogProduct[] = [];
  const counts = new Map<string, number>();

  for (const p of products) {
    const bucket =
      extractProductTasteAttributes(p).color[0] ?? "unknown";
    const n = counts.get(bucket) ?? 0;
    if (taken.length < target && n < cap) {
      taken.push(p);
      counts.set(bucket, n + 1);
    } else {
      deferred.push(p);
    }
  }
  while (taken.length < target && deferred.length) {
    taken.push(deferred.shift()!);
  }
  return [...taken, ...deferred];
}

function buildUserPayload(params: {
  recipientProfile: string;
  brief: FashionSearchBrief;
  slot: FashionSearchPlanSlot;
  candidates: Array<{ ref: string; card: Record<string, string> }>;
}): string {
  const lines = [
    "PROFILES:",
    params.recipientProfile.trim() || "(no profile recorded yet)",
    "",
    "PULL:",
    `preference_anchor: ${params.brief.preference_anchor ?? "unspecified"}`,
    `style_direction: ${params.brief.style_direction}`,
    `occasion: ${params.brief.occasion_context}`,
    `consultation.confirmed: ${(params.brief.consultation?.confirmed ?? []).join("; ") || "none"}`,
    `slot_garment: ${params.slot.garment}`,
    `slot_style_direction: ${params.slot.style_direction}`,
    "",
    "CANDIDATES:",
  ];
  for (const c of params.candidates) {
    const attrs = Object.entries(c.card)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    lines.push(`[${c.ref}] ${attrs}`);
  }
  return lines.join("\n");
}

async function rateOneBatch(params: {
  candidates: Array<{ ref: string; card: Record<string, string> }>;
  slot: FashionSearchPlanSlot;
  brief: FashionSearchBrief;
  recipientProfile: string;
  signal?: AbortSignal;
  traceId?: string | null;
  createMessage: typeof tracedLLMCall;
}): Promise<{
  ratings: Map<string, TasteRating>;
  aborted: boolean;
  input_tokens: number;
  output_tokens: number;
}> {
  const hard = AbortSignal.timeout(TASTE_RERANK_HARD_MS);
  const signal =
    params.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([params.signal, hard])
      : params.signal ?? hard;
  try {
    const response = await params.createMessage({
      traceId: params.traceId,
      stage: "taste_rerank",
      model: FASHION_TASTE_RERANK_MODEL,
      maxTokens: tasteRerankMaxTokens(params.candidates.length),
      temperature: 0,
      systemPrompt: TASTE_RERANK_PROMPT,
      systemCachedPrefix: TASTE_RERANK_PROMPT,
      inputMessages: [
        {
          role: "user",
          content: buildUserPayload({
            recipientProfile: params.recipientProfile,
            brief: params.brief,
            slot: params.slot,
            candidates: params.candidates,
          }),
        },
      ],
      tools: [RATE_TASTE_FIT_TOOL],
      toolChoice: { type: "tool", name: RATE_TASTE_FIT_TOOL_NAME },
      signal,
    });
    const toolBlock = response.content.find(
      (b) => b.type === "tool_use" && b.name === RATE_TASTE_FIT_TOOL_NAME,
    );
    const ratings =
      toolBlock && toolBlock.type === "tool_use"
        ? parseRatings(toolBlock.input)
        : new Map<string, TasteRating>();
    if (!ratings.size) {
      throw new Error("empty_or_invalid_ratings");
    }
    return {
      ratings,
      aborted: false,
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
    };
  } catch (err) {
    logAiChat("warn", "taste_rerank_failed", {
      traceId: params.traceId,
      slot_id: params.slot.slot_id,
      batch_size: params.candidates.length,
      error: String(err).slice(0, 200),
    });
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "taste_rerank_failed",
      payload: {
        slot_id: params.slot.slot_id,
        batch_size: params.candidates.length,
        error: String(err).slice(0, 200),
      },
    });
    return {
      ratings: new Map(),
      aborted: true,
      input_tokens: 0,
      output_tokens: 0,
    };
  }
}

async function rateSlotCandidates(params: {
  products: FashionSlotCatalogProduct[];
  slot: FashionSearchPlanSlot;
  brief: FashionSearchBrief;
  recipientProfile: string;
  recipientPersonId: string;
  signalsHash: string;
  signal?: AbortSignal;
  traceId?: string | null;
  createMessage?: typeof tracedLLMCall;
}): Promise<{ rated: number; failed: boolean; stats: TasteRerankStats }> {
  const top = params.products.slice(0, tasteRerankTopN(params.slot.role));
  const stats = emptyTasteRerankStats();
  if (!top.length) return { rated: 0, failed: false, stats };

  const anchor = params.brief.preference_anchor ?? "unspecified";
  const uncached: FashionSlotCatalogProduct[] = [];
  for (const p of top) {
    const key = cacheKey({
      productId: p.id,
      recipientPersonId: params.recipientPersonId,
      anchor,
      signalsHash: params.signalsHash,
    });
    const hit = cacheGet(key);
    if (hit) {
      p.taste_rating = hit;
      stats.cache_hits += 1;
    } else {
      uncached.push(p);
    }
  }
  if (!uncached.length) {
    stats.rated = top.length;
    return { rated: top.length, failed: false, stats };
  }

  const createMessage = params.createMessage ?? tracedLLMCall;
  const batches = await Promise.all(
    chunk(uncached, TASTE_RERANK_BATCH).map(async (group) => {
      const refToProduct = new Map<string, FashionSlotCatalogProduct>();
      const candidates = group.map((p, i) => {
        const ref = String(i + 1);
        refToProduct.set(ref, p);
        return { ref, card: candidateAttributeCard(p, params.slot.garment) };
      });
      const result = await rateOneBatch({
        candidates,
        slot: params.slot,
        brief: params.brief,
        recipientProfile: params.recipientProfile,
        signal: params.signal,
        traceId: params.traceId,
        createMessage,
      });
      return { ...result, refToProduct };
    }),
  );

  for (const batch of batches) {
    stats.calls += 1;
    stats.input_tokens += batch.input_tokens;
    stats.output_tokens += batch.output_tokens;
    if (batch.aborted) {
      stats.aborted += 1;
      continue;
    }
    for (const [ref, rating] of batch.ratings) {
      const product = batch.refToProduct.get(ref);
      if (!product) continue;
      product.taste_rating = rating;
      cacheSet(
        cacheKey({
          productId: product.id,
          recipientPersonId: params.recipientPersonId,
          anchor,
          signalsHash: params.signalsHash,
        }),
        rating,
      );
    }
  }

  const rated = top.filter((p) => p.taste_rating).length;
  stats.rated = rated;
  return { rated, failed: stats.aborted > 0, stats };
}

export async function applyTasteRerankToSlots(params: {
  slots: FashionSlotCatalogResult[];
  planSlots: FashionSearchPlanSlot[];
  brief: FashionSearchBrief;
  recipientFacts: FashionFactRow[];
  recipientProfile: string;
  recipientPersonId: string;
  signalsHash: string;
  signal?: AbortSignal;
  traceId?: string | null;
  createMessage?: typeof tracedLLMCall;
}): Promise<{
  slots: FashionSlotCatalogResult[];
  ms: number;
  failed: boolean;
  stats: TasteRerankStats;
}> {
  const started = Date.now();
  const slotOutcomes = await Promise.all(
    params.slots.map(async (slot) => {
      const planSlot =
        params.planSlots.find((s) => s.slot_id === slot.slot_id) ??
        params.planSlots.find((s) => s.garment === slot.garment);
      if (!planSlot || !slot.products.length) {
        return { failed: false, stats: emptyTasteRerankStats() };
      }

      const result = await rateSlotCandidates({
        products: slot.products,
        slot: planSlot,
        brief: params.brief,
        recipientProfile: params.recipientProfile,
        recipientPersonId: params.recipientPersonId,
        signalsHash: params.signalsHash,
        signal: params.signal,
        traceId: params.traceId,
        createMessage: params.createMessage,
      });

      const rescored = scoreSlotProducts({
        slot: planSlot,
        brief: params.brief,
        recipientFacts: params.recipientFacts,
        products: slot.products,
        queryLogs: slot.query_logs,
      });
      slot.products =
        params.brief.preference_anchor === "explore"
          ? applyExploreDiversityPass(
              rescored.products,
              planSlot.options_wanted,
            )
          : rescored.products;

      recordPipelineEvent({
        traceId: params.traceId,
        stage: "taste_rerank",
        payload: {
          slot_id: slot.slot_id,
          rated: result.rated,
          failed: result.failed,
          calls: result.stats.calls,
          aborted: result.stats.aborted,
          input_tokens: result.stats.input_tokens,
          output_tokens: result.stats.output_tokens,
        },
      });
      return { failed: result.failed, stats: result.stats };
    }),
  );

  const stats = slotOutcomes.reduce(
    (acc, o) => addTasteRerankStats(acc, o.stats),
    emptyTasteRerankStats(),
  );
  return {
    slots: params.slots,
    ms: Date.now() - started,
    failed: slotOutcomes.some((o) => o.failed),
    stats,
  };
}
