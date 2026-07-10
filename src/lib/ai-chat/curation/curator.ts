import type {
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { z } from "zod";
import { getAnthropicClient } from "../anthropic";
import {
  AI_CHAT_CURATOR_MODEL,
  AI_CHAT_CURATOR_TIMEOUT_MS,
} from "../constants";
import { logAiChat } from "../observability";
import type { ShopifySearchToolInput } from "../shopify-search-tool";
import { briefFromSearchInput } from "../shopify-search-tool";
import type { ShopifySearchProductCard } from "../shopify-search-tool";
import type { SearchBrief } from "../search/types";
import { sanitizeSearchBrief } from "../search/query-hygiene";
import { buildShoppingMemoryPromptXml } from "../shopping-memory/context";
import { MAX_PRODUCT_DISPLAY_LIMIT } from "../shopping-mode/display-limits";
import { buildHeuristicInsight, normalizePickInsight } from "./pick-insight";
import { formatCardsForJudgment } from "../judgment/attributes-prompt";
import {
  composeSpecialistFrame,
  composeClientPicture,
  getRetrievedExpertiseForBrief,
  TIER_RUBRIC,
} from "../judgment/prompt-assembler";
import {
  logReasonViolation,
  validatePickReason,
} from "../judgment/reason-validation";
import type {
  CuratedPick,
  CurationSlot,
  CurationVerdict,
  ShoppingModeMetaV1,
} from "../types";
import type { InputJsonValue } from "../prisma-types";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import { hydrateProductCardsFromCatalog } from "@/lib/shopify/resolve-display-variant";
import type { CatalogSearchContext } from "@/lib/shopify/catalog";
import { isCardAvailabilityPurchasable } from "@/lib/shopify/catalog";
import { productCuration } from "./db";
import {
  formatAnthropicMessageResult,
  formatPromptBundle,
} from "../prompt-run/format";
import { recordPromptRun } from "../prompt-run/record";
import { updateCatalogSearchPicks } from "@/lib/shopify/catalog-mcp-audit";

/** Render order: featured slots first, then horizontal gallery row. */
export const CURATION_SLOT_ORDER: CurationSlot[] = [
  "shoop_pick",
  "best_value",
  "most_popular",
  "gem",
  "gallery",
  "loosened",
  "reframed",
];

const SLOT_LABEL: Record<CurationSlot, string> = {
  shoop_pick: "Shoop's pick",
  best_value: "Best value",
  most_popular: "Most popular",
  gem: "Hidden gem",
  gallery: "Also consider",
  loosened: "Relaxed match",
  reframed: "Broader match",
};

const VERDICT_VALUES = ["buy", "wait", "dont_recommend"] as const;
const NAMED_SLOT_VALUES = ["best_value", "most_popular", "shoop_pick"] as const;
const SLOT_VALUES = [...NAMED_SLOT_VALUES, "gallery"] as const;

const pickSchema = z
  .object({
    product_id: z.string().min(1).max(500),
    slot: z.enum(SLOT_VALUES),
    verdict: z.enum(VERDICT_VALUES),
    reason: z
      .string()
      .trim()
      .min(12)
      .max(220)
      .describe(
        "One sentence verdict headline, e.g. cheapest price claim or clearest tradeoff.",
      ),
    retailer_check_note: z
      .string()
      .trim()
      .min(8)
      .max(100)
      .describe(
        'Honest scope note, e.g. "Compared 11 options in this Shoop search" — do NOT invent external retailer counts.',
      ),
    fit_reasons: z.array(z.string().trim().min(8).max(200)).length(3),
    checked_items: z.array(z.string().trim().min(6).max(120)).min(3).max(5),
    pick_story: z.string().trim().min(40).max(520),
    change_mind: z.array(z.string().trim().min(8).max(160)).min(2).max(4),
  })
  .strict();

/** Accept verbose model output; `normalizePickInsight` clamps before persist. */
const lenientPickSchema = z
  .object({
    product_id: z.string().min(1).max(500),
    slot: z.enum(SLOT_VALUES),
    verdict: z.enum(VERDICT_VALUES),
    reason: z.string().min(1),
    retailer_check_note: z.string(),
    fit_reasons: z.array(z.string()).min(1).max(5),
    checked_items: z.array(z.string()).min(1).max(8),
    pick_story: z.string(),
    change_mind: z.array(z.string()).min(1).max(6),
  })
  .strict();

const curationToolInputSchema = z
  .object({
    picks: z.array(pickSchema).min(1).max(MAX_PRODUCT_DISPLAY_LIMIT),
  })
  .strict();

const lenientCurationToolInputSchema = z
  .object({
    picks: z.array(lenientPickSchema).min(1).max(MAX_PRODUCT_DISPLAY_LIMIT),
  })
  .strict();

type LenientCuratorPick = z.infer<typeof lenientPickSchema>;

const CURATION_TOOL_NAME = "emit_curated_picks";

const insightToolProperties = {
  retailer_check_note: {
    type: "string",
    description:
      'Scope line only, e.g. "Compared 11 options in this Shoop search". Never claim 23 retailers unless candidates count is 23.',
  },
  fit_reasons: {
    type: "array",
    minItems: 3,
    maxItems: 3,
    items: { type: "string" },
    description:
      "Exactly 3 bullets: why THIS product fits THIS buyer (taste, owned items, sizing, price timing).",
  },
  checked_items: {
    type: "array",
    minItems: 3,
    maxItems: 5,
    items: { type: "string" },
    description:
      'What you evaluated, e.g. "Price in catalog", "Flat-foot comfort signal", "Return policy".',
  },
  pick_story: {
    type: "string",
    description:
      "2–4 sentences: how you picked it among candidates (count, tradeoffs, why it wins now).",
  },
  change_mind: {
    type: "array",
    minItems: 2,
    maxItems: 4,
    items: { type: "string" },
    description: "Concrete conditions that would flip your verdict.",
  },
} as const;

const curationTool: Tool = {
  name: CURATION_TOOL_NAME,
  description:
    "Emit curated picks with structured PDP insight. Tool call only — no other output.",
  input_schema: {
    type: "object",
    properties: {
      picks: {
        type: "array",
        minItems: 1,
        maxItems: MAX_PRODUCT_DISPLAY_LIMIT,
        items: {
          type: "object",
          properties: {
            product_id: { type: "string" },
            slot: {
              type: "string",
              enum: ["best_value", "most_popular", "shoop_pick", "gallery"],
            },
            verdict: {
              type: "string",
              enum: ["buy", "wait", "dont_recommend"],
            },
            reason: { type: "string" },
            ...insightToolProperties,
          },
          required: [
            "product_id",
            "slot",
            "verdict",
            "reason",
            "retailer_check_note",
            "fit_reasons",
            "checked_items",
            "pick_story",
            "change_mind",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["picks"],
    additionalProperties: false,
  },
};

const CURATOR_SYSTEM = `You are Shoop's head buyer — think Wirecutter's test discipline, NYT Strategist's taste-matching, and a sharp friend's budget sense. You only see REAL catalog candidates from this search (not the whole internet).

INPUT: specialist frame, buyer memory, search query, candidate list with ids/titles/prices/attributes, and a tier rubric.

OUTPUT: Call \`${CURATION_TOOL_NAME}\` exactly once. No prose outside the tool. Every field required on every pick.

JUDGMENT (critical):
${TIER_RUBRIC}

For shoop_pick: only assign when you can write a reason that names concrete product features (material, color, silhouette, sole, occasion). If you cannot, use gallery + verdict "wait" instead.
Never write "top-ranked match", "best overall match", or reasons that name nothing about the product.

SLOTS (each product_id once; named slots at most once):
- best_value — best price-to-quality for this buyer now (weigh price against the rating, not just the lowest sticker).
- most_popular — the genuinely most-validated choice: prefer the candidate with the highest review count / strongest rating. Only fall back to a sensible mainstream pick when no candidate shows reviews. Never call something "most popular" with zero review signal.
- shoop_pick — tier-1 hero ONLY when feature-citing reason is truthful; favoring well-rated, in-stock, in-size options.
- gallery — strong alternates until you hit the target count.

When a candidate shows a \`attributes:\` line, treat it as ground truth for judgment — reference material/style in your reasoning. When attributes are missing, lean on title + options only; do not invent attributes.

When a candidate shows a \`rating:\` line, treat it as real review data — reference the score/count in your reasoning. When it does not, do not invent popularity.

AVAILABILITY (hard rules — the \`availability:\` line on each candidate is VERIFIED ground truth, not a guess):
- NEVER place an item that is OUT OF STOCK or where the buyer's exact size/options are NOT available into best_value, most_popular, or shoop_pick. Those slots must be buy-ready in the buyer's size.
- If such an item is still worth showing, use the gallery slot with verdict "wait" and state the blocker (e.g. "your size sold out").
- "running low" → favor a "buy" verdict and say to grab it soon.
- Prefer the in-stock, correct-size candidates for the three featured slots.

VERDICTS:
- buy — tier-1 clear fit with feature-citing reason; in stock and in the buyer's size.
- wait — solid but not top, or blocker present, or reason cannot cite product features confidently.
- dont_recommend — avoid; never use shoop_pick slot. Reason states the violation.

FIELD RULES (structured, plain text, no markdown/emoji):
- reason: ONE sentence verdict headline (≤200 chars) that names product features for shoop_pick.
- retailer_check_note: Honest scope ONLY — "Compared N options in this Shoop search" where N = candidate count in <candidates>. Do NOT invent "23 retailers" or off-catalog price checks.
- fit_reasons: EXACTLY 3 bullets — personalized why it fits (reference memory: owned gear, sizing, taste, sale timing vs alternates in the list).
- checked_items: 3–5 bullets — what you evaluated (price, material/style from attributes, durability, returns/shipping if inferable, variant match).
- pick_story: 2–4 sentences — how you picked among candidates (how many you weighed, why this wins vs #2 in the list).
- change_mind: 2–4 bullets — concrete flip conditions (price ceiling, preference change, duplicate owned item, stock).

EDGE CASES:
- <3 candidates: still fill all arrays; reference the actual count in pick_story and retailer_check_note.
- Missing price: say "price not listed" in checks; do not fabricate comparisons.
- Thin memory: lean on search query + candidate metadata; never invent user facts.
- Duplicate owned / hard negative: dont_recommend with explicit reason.

Speed: be decisive, specific, and concise.`;

export type CuratorContext = {
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  /** User turn that triggered this search (for admin prompt audit). */
  userMessageId?: string | null;
  /** Monotonic sequence within the chat turn (inline / stream path). */
  nextPromptSequence?: () => number;
  /** Fixed sequence reserved when curation is enqueued as a durable job. */
  auditSequence?: number;
  /** Anthropic tool_use id — links curator picks to CatalogSearchRun rows. */
  searchKey?: string | null;
  searchInput: ShopifySearchToolInput;
  cards: ShopifySearchProductCard[];
  /** Free text used to scope the shopping-memory XML (typically the latest user message). */
  memoryQueryHint: string;
  /**
   * Memory XML already built by the context-builder for this turn. When set,
   * the curator skips its own DB roundtrip (~14 parallel Prisma queries) and
   * reuses this string verbatim.
   */
  preBuiltMemoryXml?: string;
  /** Total products to curate (featured slots + gallery). From shopping mode. */
  displayLimit: number;
  /** Resolved mode for this turn (admin audit). */
  shoppingModeMeta?: ShoppingModeMetaV1 | null;
  /**
   * Buyer shipping + locale. When set, the curator enriches the top candidates
   * (rating + availability) off the critical path so EVERY featured pick — not
   * just sized ones — carries real review/stock signal.
   */
  buyerContext?: {
    shipsToCountry?: string;
    context?: CatalogSearchContext;
  };
  signal?: AbortSignal;
};

export type CuratorOutcome = {
  picks: CuratedPick[];
  fallback: boolean;
  /** Latency end-to-end (ms) — useful for observability. */
  latencyMs: number;
};


function formatCandidatesForPrompt(cards: ShopifySearchProductCard[]): string {
  return formatCardsForJudgment(cards);
}

function briefFromCuratorContext(ctx: CuratorContext): SearchBrief {
  return sanitizeSearchBrief(briefFromSearchInput(ctx.searchInput));
}

/**
 * Deterministic safety net applied to BOTH heuristic and model picks: the
 * buyer must never see "buy" on something that isn't in their size or in
 * stock. Verified availability always overrides the model's optimism.
 */
function adjustPickForAvailability(pick: CuratedPick): CuratedPick {
  const a = pick.availability;
  if (!a) return pick;

  const sizeMissing = a.preferredMatched === false;
  const outOfStock = a.status === "out_of_stock" || a.purchasable === false;

  if (sizeMissing || outOfStock) {
    const note = outOfStock
      ? "Out of stock right now"
      : a.relaxedNote ?? "Your usual size looks unavailable here";
    const reason = `${note}. ${pick.reason}`.slice(0, 220);
    return { ...pick, verdict: "wait", reason };
  }

  if (a.status === "running_low" && pick.verdict === "buy") {
    const reason = `Running low — grab it soon. ${pick.reason}`.slice(0, 220);
    return { ...pick, reason };
  }

  return pick;
}

/** True when the buyer's requested size/variant is verified available + in stock. */
function isPreferredAvailable(card: ShopifySearchProductCard): boolean {
  const a = card.availability;
  if (!a) return false;
  return isCardAvailabilityPurchasable(a);
}

function isCuratorTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error && /timed out after \d+ms/i.test(err.message)
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function toCuratedPick(
  card: ShopifySearchProductCard,
  slot: CurationSlot,
  reason: string,
  verdict: CurationVerdict,
  candidateCount: number,
): CuratedPick {
  // The heuristic insight builder only models the four legacy slots; the engine
  // slots (gem/loosened/reframed) read as gallery-style "also consider" copy.
  const insightSlot: "best_value" | "most_popular" | "shoop_pick" | "gallery" =
    slot === "best_value" || slot === "most_popular" || slot === "shoop_pick"
      ? slot
      : "gallery";
  return {
    ...card,
    slot,
    reason: reason.trim().slice(0, 220),
    verdict,
    insight: buildHeuristicInsight(card, candidateCount, insightSlot, reason),
  };
}

function buildHeuristicPicks(
  cards: ShopifySearchProductCard[],
  displayLimit: number,
  options?: { variant?: "pending" | "fallback" },
): CuratedPick[] {
  if (!cards.length) return [];
  const n = cards.length;

  const cardPriceCents = (c: ShopifySearchProductCard) =>
    c.displayPrice?.amount ??
    c.featuredVariant?.price?.amount ??
    c.priceRange?.min.amount;

  // Only surface verified in-stock items — never fall back to unverified hits.
  const pool = cards.filter(isPreferredAvailable);
  if (!pool.length) return [];

  // Global Catalog search now returns ratings inline, so the instant heuristic
  // picks (shown before the model curator returns) can be quality-aware.
  const reviewCount = (c: ShopifySearchProductCard) => c.rating?.count ?? 0;
  const ratingValue = (c: ShopifySearchProductCard) => c.rating?.value ?? 0;
  const hasRatingSignal = pool.some((c) => reviewCount(c) > 0);
  const WELL_RATED = 4.0;

  const priced = pool.filter((c) => cardPriceCents(c) != null);
  // "Best value" = cheapest among the well-rated options when we have rating
  // signal (a $20 1-star item is not "value"); otherwise plain cheapest.
  const valuePool = hasRatingSignal
    ? priced.filter((c) => reviewCount(c) === 0 || ratingValue(c) >= WELL_RATED)
    : priced;
  const cheapest = [...(valuePool.length ? valuePool : priced)].sort(
    (a, b) => (cardPriceCents(a) ?? 0) - (cardPriceCents(b) ?? 0),
  )[0];

  // "Most popular" = most-reviewed (tie-break by score) when we have real
  // review signal; only fall back to relevance order when nothing has reviews.
  const mostReviewed = [...pool].sort(
    (a, b) => reviewCount(b) - reviewCount(a) || ratingValue(b) - ratingValue(a),
  )[0];
  const popular = reviewCount(mostReviewed) > 0 ? mostReviewed : pool[0];

  // "Shoop's pick" = best-rated remaining option when ratings exist; otherwise
  // the top relevance-ranked remaining candidate.
  const byQuality = [...pool].sort(
    (a, b) => ratingValue(b) - ratingValue(a) || reviewCount(b) - reviewCount(a),
  );
  const shoop =
    (hasRatingSignal
      ? byQuality.find((c) => c.id !== cheapest?.id && c.id !== popular?.id)
      : pool.find((c) => c.id !== cheapest?.id && c.id !== popular?.id)) ??
    pool.find((c) => c.id !== cheapest?.id && c.id !== popular?.id) ??
    pool[0];

  const shoopRatingNote =
    shoop && reviewCount(shoop) > 0
      ? ` (rated ${ratingValue(shoop).toFixed(1)}/${shoop.rating?.scaleMax ?? 5})`
      : "";
  const shoopReason =
    options?.variant === "pending"
      ? "Checking fit against your query — personalizing picks…"
      : options?.variant === "fallback"
        ? `Among ${n} options here${shoopRatingNote} — compare attributes before deciding.`
        : shoop && reviewCount(shoop) > 0
          ? `Rated ${ratingValue(shoop).toFixed(1)}/${shoop.rating?.scaleMax ?? 5} — verify material and style match your request.`
          : "Compare the listed attributes and options against what you asked for.";

  const picks: CuratedPick[] = [];
  if (shoop) {
    picks.push(
      toCuratedPick(shoop, "shoop_pick", shoopReason, "buy", n),
    );
  }
  if (cheapest && cheapest.id !== shoop?.id) {
    const cheapestReason =
      reviewCount(cheapest) > 0
        ? `Lowest price among the well-rated options here (${ratingValue(cheapest).toFixed(1)}/${cheapest.rating?.scaleMax ?? 5}).`
        : "Lowest-priced option among the products returned in this search.";
    picks.push(
      toCuratedPick(cheapest, "best_value", cheapestReason, "buy", n),
    );
  }
  if (popular && popular.id !== shoop?.id && popular.id !== cheapest?.id) {
    const popularReason =
      popular.rating && popular.rating.count > 0
        ? `Most-reviewed here — ${popular.rating.value.toFixed(1)}/${popular.rating.scaleMax} across ${popular.rating.count} reviews.`
        : "The mainstream, safe-bet match in this set.";
    picks.push(
      toCuratedPick(popular, "most_popular", popularReason, "buy", n),
    );
  }

  const used = new Set(picks.map((p) => p.id));
  let galleryAdded = 0;
  const galleryBudget = Math.max(0, displayLimit - picks.length);
  for (const card of cards) {
    if (galleryAdded >= galleryBudget) break;
    if (used.has(card.id)) continue;
    picks.push(
      toCuratedPick(
        card,
        "gallery",
        "Alternative worth comparing — check attributes against your request.",
        "wait",
        n,
      ),
    );
    used.add(card.id);
    galleryAdded += 1;
  }

  return picks.slice(0, displayLimit).map(adjustPickForAvailability);
}

function coerceCurationToolInput(raw: unknown): unknown | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.picks)) return raw;
  if (Array.isArray(o.curated_picks)) {
    return { ...o, picks: o.curated_picks };
  }
  return null;
}

function dedupePicks(
  raw: LenientCuratorPick[],
  cards: ShopifySearchProductCard[],
  displayLimit: number,
): CuratedPick[] {
  const byId = new Map(cards.map((c) => [c.id, c] as const));
  const seenNamedSlots = new Set<CurationSlot>();
  const seenIds = new Set<string>();
  const out: CuratedPick[] = [];
  for (const p of raw) {
    if (out.length >= displayLimit) break;
    if (seenIds.has(p.product_id)) continue;
    if (p.slot !== "gallery" && seenNamedSlots.has(p.slot)) continue;
    const card = byId.get(p.product_id);
    if (!card) continue;
    const reason = p.reason.trim().slice(0, 220);
    const validation = validatePickReason(reason, {
      title: card.title,
      attributes: card.catalogAttributes,
      options: card.options,
      slot: p.slot,
      productId: card.id,
      tier: p.slot === "shoop_pick" ? 1 : undefined,
    });
    logReasonViolation(reason, {
      title: card.title,
      attributes: card.catalogAttributes,
      options: card.options,
      slot: p.slot,
      productId: card.id,
    }, validation);

    let verdict: CurationVerdict =
      p.slot === "shoop_pick" && p.verdict === "dont_recommend"
        ? "wait"
        : p.verdict;
    if (p.slot === "shoop_pick" && !validation.ok) {
      verdict = "wait";
    } else if (
      p.slot === "shoop_pick" &&
      validation.ok &&
      verdict === "buy"
    ) {
      verdict = "buy";
    }
    const insight = normalizePickInsight(
      {
        retailer_check_note: p.retailer_check_note.trim().slice(0, 100),
        fit_reasons: p.fit_reasons.map((s) => s.trim().slice(0, 200)),
        checked_items: p.checked_items.map((s) => s.trim().slice(0, 120)),
        pick_story: p.pick_story.trim().slice(0, 520),
        change_mind: p.change_mind.map((s) => s.trim().slice(0, 160)),
      },
      reason,
    );
    out.push(
      adjustPickForAvailability({
        ...card,
        slot: p.slot,
        reason,
        verdict,
        insight,
      }),
    );
    seenIds.add(p.product_id);
    if (p.slot !== "gallery") seenNamedSlots.add(p.slot);
  }
  return out;
}

async function callCuratorModel(
  ctx: CuratorContext,
): Promise<CuratedPick[] | null> {
  const memoryXml =
    ctx.preBuiltMemoryXml !== undefined
      ? ctx.preBuiltMemoryXml
      : await buildShoppingMemoryPromptXml(
          ctx.userId,
          ctx.memoryQueryHint,
        ).catch(() => "");

  const candidatesBlock = formatCandidatesForPrompt(ctx.cards);
  const displayLimit = Math.min(
    Math.max(1, ctx.displayLimit),
    ctx.cards.length,
    MAX_PRODUCT_DISPLAY_LIMIT,
  );

  const retryTimeoutMs = Math.min(
    AI_CHAT_CURATOR_TIMEOUT_MS + 25_000,
    90_000,
  );
  const attemptTimeouts = [AI_CHAT_CURATOR_TIMEOUT_MS, retryTimeoutMs];

  for (let attempt = 0; attempt < attemptTimeouts.length; attempt++) {
    try {
      return await callCuratorModelOnce(
        ctx,
        attemptTimeouts[attempt] ?? AI_CHAT_CURATOR_TIMEOUT_MS,
        memoryXml,
        candidatesBlock,
        displayLimit,
      );
    } catch (error) {
      const canRetry =
        attempt < attemptTimeouts.length - 1 &&
        isCuratorTimeoutError(error);
      if (canRetry) {
        logAiChat("warn", "curator_retry_after_timeout", {
          userId: ctx.userId,
          query: ctx.searchInput.query.slice(0, 120),
          attempt: attempt + 1,
          nextTimeoutMs: attemptTimeouts[attempt + 1],
        });
        continue;
      }
      throw error;
    }
  }
  return null;
}

function curatorAuditSequence(ctx: CuratorContext): number {
  return ctx.nextPromptSequence?.() ?? ctx.auditSequence ?? 0;
}

function recordCuratorPromptRun(
  ctx: CuratorContext,
  params: {
    model: string | null;
    promptText: string;
    resultText: string;
    pickCount: number;
    phase: "model" | "heuristic";
  },
): void {
  recordPromptRun({
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    userMessageId: ctx.userMessageId ?? null,
    assistantMessageId: ctx.messageId,
    kind: "curator",
    model: params.model,
    sequence: curatorAuditSequence(ctx),
    promptText: params.promptText,
    resultText: params.resultText,
    metadata: {
      ...(ctx.shoppingModeMeta ? { shoppingMode: ctx.shoppingModeMeta } : {}),
      searchKey: ctx.searchKey ?? null,
      searchQuery: ctx.searchInput.query.slice(0, 200),
      pickCount: params.pickCount,
      phase: params.phase,
    } as InputJsonValue,
  });
}

function buildCuratorUserPrompt(ctx: CuratorContext): string {
  const userParts: string[] = [];
  userParts.push(`<search_query>${ctx.searchInput.query}</search_query>`);
  if (ctx.searchInput.intent) {
    userParts.push(`<search_intent>${ctx.searchInput.intent}</search_intent>`);
  }
  if (ctx.searchInput.filters) {
    userParts.push(
      `<search_filters>${JSON.stringify(ctx.searchInput.filters)}</search_filters>`,
    );
  }
  return userParts.join("\n\n");
}

async function callCuratorModelOnce(
  ctx: CuratorContext,
  timeoutMs: number,
  memoryXml: string,
  candidatesBlock: string,
  displayLimit: number,
): Promise<CuratedPick[] | null> {
  const userParts: string[] = [buildCuratorUserPrompt(ctx)];
  const brief = briefFromCuratorContext(ctx);
  userParts.unshift(
    `[SPECIALIST FRAME]\n${composeSpecialistFrame(brief)}`,
    `[CLIENT PICTURE]\n${composeClientPicture(brief, memoryXml || undefined)}`,
    `[RETRIEVED EXPERTISE]\n${getRetrievedExpertiseForBrief(brief)}`,
    `[TIER RUBRIC]\n${TIER_RUBRIC}`,
  );
  if (memoryXml) userParts.push(memoryXml);
  userParts.push(`<candidates>\n${candidatesBlock}\n</candidates>`);
  userParts.push(
    `<curation_target>Curate up to ${displayLimit} distinct products total. Use best_value, most_popular, and shoop_pick once each when possible; use gallery for any additional picks. Every pick needs reason + verdict. Use ONLY ids from <candidates>.</curation_target>`,
  );
  const userPromptText = userParts.join("\n\n");
  const promptText = formatPromptBundle(CURATOR_SYSTEM, [
    { role: "user", content: userPromptText },
  ]);

  const anthropic = getAnthropicClient();
  // NOTE: Opus 4.7 deprecated the `temperature` parameter — passing it returns
  // 400 invalid_request_error. We rely on the forced tool call + small
  // max_tokens to constrain the output instead.
  const reqPromise = anthropic.messages.create(
    {
      model: AI_CHAT_CURATOR_MODEL,
      max_tokens: 3072,
      system: CURATOR_SYSTEM,
      tools: [curationTool],
      tool_choice: { type: "tool", name: CURATION_TOOL_NAME },
      messages: [{ role: "user", content: userPromptText }],
    },
    ctx.signal ? { signal: ctx.signal } : undefined,
  );

  const msg = await withTimeout(reqPromise, timeoutMs, "curator");

  const toolBlock = msg.content.find(
    (b): b is ToolUseBlock =>
      b.type === "tool_use" && b.name === CURATION_TOOL_NAME,
  );
  if (!toolBlock) return null;

  const coercedInput = coerceCurationToolInput(toolBlock.input);
  if (coercedInput == null) {
    logAiChat("warn", "curator_schema_mismatch", {
      reason: "missing_or_invalid_tool_input",
    });
    return null;
  }

  const parsed = lenientCurationToolInputSchema.safeParse(coercedInput);
  if (!parsed.success) {
    logAiChat("warn", "curator_schema_mismatch", {
      issues: parsed.error.flatten(),
    });
    return null;
  }

  const picks = dedupePicks(parsed.data.picks, ctx.cards, displayLimit);

  recordCuratorPromptRun(ctx, {
    model: AI_CHAT_CURATOR_MODEL,
    promptText,
    resultText: formatAnthropicMessageResult(msg),
    pickCount: picks.length,
    phase: "model",
  });

  return picks.length ? picks : null;
}

/** Persist picks to per-product curation rows (PDP + reload). */
export async function persistCuratedPicks(
  ctx: Pick<
    CuratorContext,
    "userId" | "conversationId" | "messageId" | "searchInput"
  >,
  picks: CuratedPick[],
): Promise<void> {
  await persistCuration(ctx as CuratorContext, picks);
}

async function persistCuration(
  ctx: CuratorContext,
  picks: CuratedPick[],
): Promise<void> {
  await Promise.all(
    picks.map(async (p) => {
      try {
        await productCuration.upsert({
          where: {
            userId_productExternalId: {
              userId: ctx.userId,
              productExternalId: p.id,
            },
          },
          create: {
            userId: ctx.userId,
            productExternalId: p.id,
            slot: p.slot,
            reason: p.reason,
            verdict: p.verdict,
            retailerCheckNote: p.insight.retailerCheckNote,
            fitReasons: [...p.insight.fitReasons],
            checkedItems: [...p.insight.checkedItems],
            pickStory: p.insight.pickStory,
            changeMindItems: [...p.insight.changeMindItems],
            conversationId: ctx.conversationId,
            messageId: ctx.messageId,
            searchQuery: ctx.searchInput.query.slice(0, 1000),
            productTitle: p.title,
            productImageUrl: p.imageUrl ?? null,
            sourceEngine: p.sourceEngine ?? null,
            nativeCheckoutUrl: p.nativeCheckoutUrl ?? null,
            upid: p.upid ?? null,
          },
          update: {
            slot: p.slot,
            reason: p.reason,
            verdict: p.verdict,
            retailerCheckNote: p.insight.retailerCheckNote,
            fitReasons: [...p.insight.fitReasons],
            checkedItems: [...p.insight.checkedItems],
            pickStory: p.insight.pickStory,
            changeMindItems: [...p.insight.changeMindItems],
            conversationId: ctx.conversationId,
            messageId: ctx.messageId,
            searchQuery: ctx.searchInput.query.slice(0, 1000),
            productTitle: p.title,
            productImageUrl: p.imageUrl ?? null,
            sourceEngine: p.sourceEngine ?? null,
            nativeCheckoutUrl: p.nativeCheckoutUrl ?? null,
            upid: p.upid ?? null,
          },
        });
      } catch (error) {
        logAiChat("warn", "curator_persist_failed", {
          userId: ctx.userId,
          productId: p.id,
          error,
        });
      }
    }),
  );
}

/** Instant heuristic picks for the product_search SSE (before model curation). */
export function buildImmediateHeuristicPicks(
  cards: ShopifySearchProductCard[],
  displayLimit: number,
): CuratedPick[] {
  if (!cards.length) return [];
  const limit = Math.min(
    Math.max(1, displayLimit),
    cards.length,
    MAX_PRODUCT_DISPLAY_LIMIT,
  );
  return orderForUi(buildHeuristicPicks(cards, limit, { variant: "pending" }));
}

/**
 * Run the curator pass for a single catalog search. The picks are persisted as
 * `ProductCuration` rows (latest per user × product) so the product details
 * page can render the same reason + verdict the chat surface showed.
 *
 * Speed-aware contract:
 * - `onPicksReady` fires as soon as picks are computed (Opus returns, or the
 *   heuristic fallback runs). The caller uses this to broadcast a UI update
 *   without waiting for the (slower) DB persistence to finish.
 * - The awaited promise resolves only after persistence settles, so the
 *   serverless runtime stays alive long enough for the writes to land.
 *
 * Best-effort: any failure produces a heuristic fallback so the chat turn
 * never blocks on a flaky curator model.
 */
export async function runCuratorPass(
  ctx: CuratorContext,
  onPicksReady?: (outcome: { picks: CuratedPick[]; fallback: boolean }) => void,
): Promise<CuratorOutcome> {
  const startedAt = Date.now();
  if (!ctx.cards.length) {
    onPicksReady?.({ picks: [], fallback: false });
    return { picks: [], fallback: false, latencyMs: 0 };
  }

  // With one or two candidates a curator pass is wasted budget — heuristic is
  // strictly as informative.
  const limit = Math.min(
    Math.max(1, ctx.displayLimit),
    ctx.cards.length,
    MAX_PRODUCT_DISPLAY_LIMIT,
  );

  // Safety net: Global Catalog search now returns rating + stock inline, so the
  // top candidates almost always already carry signal and this is a no-op. It
  // only fires (off the critical path) when a card came back with neither.
  await enrichCandidatesForCuration(ctx, limit);

  let picks: CuratedPick[] = [];
  let fallback = true;

  if (ctx.cards.length < 2) {
    logAiChat("info", "curator_skipped_few_candidates", {
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      messageId: ctx.messageId,
      searchKey: ctx.searchKey,
      cardCount: ctx.cards.length,
      query: ctx.searchInput.query.slice(0, 120),
    });
    picks = buildHeuristicPicks(ctx.cards, limit);
    fallback = false;
    const memoryXml =
      ctx.preBuiltMemoryXml ??
      (await buildShoppingMemoryPromptXml(
        ctx.userId,
        ctx.memoryQueryHint,
      ).catch(() => ""));
    const candidatesBlock = formatCandidatesForPrompt(ctx.cards);
    const userPromptText = [
      buildCuratorUserPrompt(ctx),
      memoryXml,
      `<candidates>\n${candidatesBlock}\n</candidates>`,
    ]
      .filter(Boolean)
      .join("\n\n");
    recordCuratorPromptRun(ctx, {
      model: null,
      promptText: formatPromptBundle(CURATOR_SYSTEM, [
        { role: "user", content: userPromptText },
      ]),
      resultText: `=== HEURISTIC (<2 candidates) ===\n${JSON.stringify(picks, null, 2)}`,
      pickCount: picks.length,
      phase: "heuristic",
    });
  } else {
    try {
      const modelPicks = await callCuratorModel(ctx);
      if (modelPicks && modelPicks.length) {
        picks = modelPicks;
        fallback = false;
      }
    } catch (error) {
      logAiChat("warn", "curator_model_failed", {
        userId: ctx.userId,
        query: ctx.searchInput.query.slice(0, 120),
        error,
      });
    }
    if (!picks.length) {
      picks = buildHeuristicPicks(ctx.cards, limit, { variant: "fallback" });
    }
  }

  if (picks.length > limit) picks = picks.slice(0, limit);

  const ordered = orderForUi(picks);

  // Notify the caller IMMEDIATELY so the UI can update before persistence runs.
  onPicksReady?.({ picks: ordered, fallback });

  if (ctx.messageId && ctx.searchKey) {
    updateCatalogSearchPicks({
      assistantMessageId: ctx.messageId,
      searchKey: ctx.searchKey,
      picks: ordered,
      fallback,
    });
  }

  if (picks.length) {
    await persistCuration(ctx, picks);
  }

  return {
    picks: ordered,
    fallback,
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * Off-critical-path safety net: fetch rating + availability for the top
 * candidates that came back with neither. Since Global Catalog search now
 * returns both inline, `need` is usually empty and this returns immediately;
 * it only does work for the rare card missing all signal. Best-effort —
 * failures leave the existing signals intact.
 */
async function enrichCandidatesForCuration(
  ctx: CuratorContext,
  limit: number,
): Promise<void> {
  const need = ctx.cards
    .slice(0, Math.max(limit, 3))
    .filter((c) => !c.rating && !c.availability);
  if (!need.length) return;
  try {
    const token = await accessTokenForCatalogMcp();
    await hydrateProductCardsFromCatalog(need, token, {
      concurrency: 3,
      forceAll: true,
      shipsToCountry: ctx.buyerContext?.shipsToCountry,
      buyerContext: ctx.buyerContext?.context,
    });
  } catch (error) {
    logAiChat("warn", "curator_enrich_failed", {
      userId: ctx.userId,
      query: ctx.searchInput.query.slice(0, 120),
      error,
    });
  }
}

function orderForUi(picks: CuratedPick[]): CuratedPick[] {
  return [...picks].sort(
    (a, b) =>
      CURATION_SLOT_ORDER.indexOf(a.slot) -
      CURATION_SLOT_ORDER.indexOf(b.slot),
  );
}

export function curationSlotLabel(slot: CurationSlot): string {
  return SLOT_LABEL[slot];
}
