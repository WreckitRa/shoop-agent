/**
 * LLM query planner — all archetypes. Expands a shopping brief into several
 * catalog search queries. No hardcoded theme→query maps or synonym tables.
 *
 * Gift requests use the same product-query planner as everything else: the
 * brief carries recipient/occasion context; query.text is always a normal
 * product search string (never "gift", "present", etc.).
 */
import { createLightweightMessage } from "../anthropic";
import {
  AI_CHAT_BUDGET_ANGLE_PLANNER_TIMEOUT_MS,
  AI_CHAT_GIFT_DIRECTION_PLANNER_TIMEOUT_MS,
  AI_CHAT_GIFT_QUERY_PLANNER_TIMEOUT_MS,
  AI_CHAT_LIGHTWEIGHT_MODEL,
  AI_CHAT_QUERY_PLANNER_TIMEOUT_MS,
} from "../constants";
import { logAiChat } from "../observability";
import { dedupeNearSynonyms } from "./query-diversity";
import {
  formatQueryPlannerPrompt,
  logShopifyQueryPlannerPrompt,
  logShopifyQueryPlannerResult,
  recordQueryPlannerRun,
  type QueryPlannerDebugHooks,
  type QueryPlannerStep,
} from "./query-planner-debug";
import {
  buildBudgetPlanningContext,
  planBudgetAwareSearchAngles,
  type BudgetSearchAngle,
} from "./budget-search-planning";
import {
  buildSearchIntent,
  isValidCatalogQuery,
  sanitizeQueryText,
  sanitizeSearchBrief,
} from "./query-hygiene";
import { isGiftArchetype } from "./portfolio";
import {
  dedupePortfolioByText,
  parseQueryPlannerJson,
  portfolioBudget,
  portfolioQueryFromText,
  abortAfterMs,
} from "./portfolio-planner-shared";
import {
  PLANNER_ARCHETYPE_GUIDANCE,
  PLANNER_HARD_RULES,
  PLANNER_OUTPUT_FORMAT,
} from "./query-planner-rules";
import { cleanDirectionLabel } from "../judgment/prompt-assembler";
import type { PortfolioQuery, SearchBrief } from "./types";

const GIFT_DIRECTION_FOCUS_SYSTEM = `You are Shoop's gift-direction search expert. The buyer picked ONE themed direction lane — think like a specialist curator for that lane only.

Output normal Shopify product search queries (product noun + 2–4 attributes).

${PLANNER_HARD_RULES}

Read direction_lane from the user message and infer distinct product subtypes that belong there. Do not drift into other gift themes.

${PLANNER_OUTPUT_FORMAT}`;

const PLANNER_SYSTEM = `You are Shoop's catalog search query planner. Output normal Shopify product search queries — the same kind a shopper would type when looking for a concrete item to buy.

Each query.text must describe a REAL PRODUCT TYPE + 2–4 product attributes (material, use case, style tier, brand tier). Think "men's leather bifold wallet RFID" or "wireless noise cancelling earbuds sport" — NOT "gift for dad" or "birthday present ideas".

${PLANNER_HARD_RULES}

${PLANNER_ARCHETYPE_GUIDANCE}

${PLANNER_OUTPUT_FORMAT}`;

/** Natural-language brainstorming context for the planner (not sent to Shopify). */
export function buildGiftShoppingQuestion(brief: SearchBrief): string {
  const who =
    brief.recipient.name?.trim() ||
    brief.recipient.label?.trim() ||
    "the recipient";
  const direction = brief.directionLabel?.trim();

  if (direction && brief.archetype === "gift_directed") {
    const lane = cleanDirectionLabel(direction);
    const bits: string[] = [`direction ONLY: ${lane}`];
    if (brief.useCase?.trim()) bits.push(`occasion: ${brief.useCase.trim()}`);
    if (brief.budget.amountCents == null || brief.budget.type === "none") {
      bits.push("open budget");
    } else {
      bits.push(
        `budget ~$${(brief.budget.amountCents / 100).toFixed(0)} ${brief.budget.currency} (${brief.budget.type})`,
      );
    }
    const context = bits.length ? ` (${bits.join("; ")})` : "";
    return `What ${lane} products would ${who} enjoy owning? Stay strictly inside "${lane}" — do not search other gift directions.${context}`;
  }

  const bits: string[] = [];
  if (direction) {
    bits.push(`direction: ${direction}`);
  }
  if (brief.recipient.knownInterests?.length) {
    bits.push(`interests: ${brief.recipient.knownInterests.join(", ")}`);
  }
  if (brief.recipient.ageRange?.trim()) {
    bits.push(`age ${brief.recipient.ageRange.trim()}`);
  }
  if (brief.recipient.favoriteBrands?.length) {
    bits.push(`favorite brands: ${brief.recipient.favoriteBrands.join(", ")}`);
  }
  if (brief.useCase?.trim()) bits.push(`occasion: ${brief.useCase.trim()}`);
  if (brief.mustHaves.length) {
    bits.push(`must haves: ${brief.mustHaves.join(", ")}`);
  }
  if (brief.budget.amountCents == null || brief.budget.type === "none") {
    bits.push("open budget");
  } else {
    bits.push(
      `budget ~$${(brief.budget.amountCents / 100).toFixed(0)} ${brief.budget.currency} (${brief.budget.type})`,
    );
  }
  const context = bits.length ? ` (${bits.join("; ")})` : "";
  return `What products would ${who} enjoy owning or using${context}?`;
}

/** Per-query intent when the planner omits one on a gift row. */
export function buildGiftQueryIntent(
  brief: SearchBrief,
  productQuery: string,
): string {
  const parts: string[] = [];
  const who = brief.recipient.label || brief.recipient.name || "recipient";
  parts.push(`Gift for ${who}`);
  if (brief.recipient.ageRange) parts.push(`age ${brief.recipient.ageRange}`);
  if (brief.directionLabel) parts.push(`direction: ${brief.directionLabel}`);
  if (brief.recipient.knownInterests?.length) {
    parts.push(`interests: ${brief.recipient.knownInterests.join(", ")}`);
  }
  if (brief.useCase) parts.push(`occasion: ${brief.useCase}`);
  if (brief.budget.amountCents == null || brief.budget.type === "none") {
    parts.push("open budget");
  } else {
    parts.push(
      `budget ~$${(brief.budget.amountCents / 100).toFixed(0)} ${brief.budget.currency}`,
    );
  }
  parts.push(`Product: ${productQuery}`);
  return parts.join(". ");
}

export function buildPlannerUserPrompt(
  brief: SearchBrief,
  count: number,
  opts?: { budgetAngles?: BudgetSearchAngle[] },
): string {
  const b = sanitizeSearchBrief(brief);
  const budgetPlanning = buildBudgetPlanningContext(b);
  const budget =
    budgetPlanning.has_constraint
      ? {
          ...budgetPlanning,
          amount: budgetPlanning.upper_limit!.amount,
          currency: budgetPlanning.upper_limit!.currency,
          type: budgetPlanning.upper_limit!.type,
        }
      : null;
  const gift = isGiftArchetype(b);

  const base = {
    task: gift
      ? "Generate normal product catalog search queries (concrete items to buy — NOT gift-themed merchandise)"
      : "Generate catalog search queries for this shopping brief",
    archetype: b.archetype,
    want_query_count: count,
    seed_query: b.query,
    direction_label: b.directionLabel ?? null,
    category: b.category ?? null,
    use_case: b.useCase ?? null,
    must_haves: b.mustHaves,
    nice_to_haves: b.niceToHaves,
    budget,
    budget_search_planning: budgetPlanning.has_constraint
      ? budgetPlanning
      : undefined,
    budget_aware_angles: opts?.budgetAngles?.length
      ? opts.budgetAngles.map((a) => ({
          angle: a.angle,
          why: a.why,
        }))
      : undefined,
    gender_scope:
      b.recipient.kind === "other" ? "unknown" : b.genderScope,
    recipient:
      b.recipient.kind === "other"
        ? {
            label: b.recipient.label ?? null,
            name: b.recipient.name ?? null,
            age_range: b.recipient.ageRange ?? null,
            known_interests: b.recipient.knownInterests ?? [],
            favorite_brands: b.recipient.favoriteBrands ?? [],
          }
        : { kind: "self" },
    ranking_profile: b.rankingProfile,
  };

  if (gift) {
    const hasDirection = Boolean(b.directionLabel?.trim());
    const directionLane = hasDirection
      ? cleanDirectionLabel(b.directionLabel!)
      : null;
    const withinLaneCritical = directionLane
      ? budgetPlanning.has_constraint
        ? `You are the expert for direction_lane "${directionLane}" ONLY. Generate ${count} queries that are DIFFERENT product types WITHIN this single direction — not other gift categories. Each query.text is a normal product search viable at the budget ceiling; gift context ONLY in intent.`
        : `You are the expert for direction_lane "${directionLane}" ONLY. Generate ${count} queries that are DIFFERENT product types WITHIN this single direction — not other gift categories. Each query.text is a normal product search; gift context ONLY in intent.`
      : null;
    const crossCategoryCritical = budgetPlanning.has_constraint
      ? "Each text is a DIFFERENT real product category viable at the budget ceiling. Write queries exactly like non-gift shopping — gift context ONLY in intent."
      : "Each text is a DIFFERENT real product category. Write queries exactly like non-gift shopping — gift context ONLY in intent.";

    return JSON.stringify({
      ...base,
      shopping_context: buildGiftShoppingQuestion(b),
      ...(directionLane
        ? {
            direction_lane: directionLane,
            specialist_role: `Expert curator for ${directionLane} gifts`,
            lane_boundary: `All queries must be product types inside "${directionLane}" only. Do not use examples or product types from other gift directions the recipient might also like.`,
          }
        : {}),
      output_rules: {
        text_must_be: "normal product search strings only",
        text_must_not_include:
          "gift, gifts, present, birthday, holiday, recipient names, occasion words",
        intent_must_include: "who it's for, occasion, why this product fits",
        bad_examples: [
          "birthday gift for brother",
          "tech gift ideas",
          "gift set for men",
        ],
        ...(directionLane
          ? {
              derive_queries_from: `You are the expert for "${directionLane}". Infer ${count} distinct product subtypes from this lane name and recipient context — no hardcoded themes; read the lane literally.`,
            }
          : {
              good_examples: [
                "wireless earbuds noise cancelling sport",
                "mechanical keyboard rgb hot swap",
                "leather weekend duffel bag waterproof",
              ],
            }),
      },
      critical: withinLaneCritical ?? crossCategoryCritical,
    });
  }

  return JSON.stringify({
    ...base,
    critical: budgetPlanning.has_constraint
      ? "Analyze the budget upper limit first, then craft queries for product types that realistically fit — use budget_aware_angles as starting points when provided."
      : undefined,
  });
}

function rowsToPortfolio(
  brief: SearchBrief,
  crafted: Array<{ text: string; intent?: string; is_discovery?: boolean }>,
  defaultIntent?: string,
): PortfolioQuery[] {
  const distinctTexts = dedupeNearSynonyms(crafted.map((c) => c.text));
  const byText = new Map(crafted.map((c) => [c.text.toLowerCase(), c]));

  const out: PortfolioQuery[] = [];
  for (const rowText of distinctTexts) {
    const row =
      byText.get(rowText.toLowerCase()) ??
      crafted.find((c) => c.text === rowText);
    if (!row) continue;
    const intent =
      row.intent?.trim() ||
      (isGiftArchetype(brief)
        ? buildGiftQueryIntent(brief, row.text)
        : defaultIntent);
    const pq = portfolioQueryFromText(brief, row.text, {
      wave: 2,
      isDiscovery: row.is_discovery,
      intent,
    });
    if (pq) out.push(pq);
  }

  if (!out.some((q) => q.isDiscovery)) {
    const disc = crafted.find((c) => c.is_discovery);
    if (disc) {
      const intent =
        disc.intent?.trim() ||
        (isGiftArchetype(brief)
          ? buildGiftQueryIntent(brief, disc.text)
          : defaultIntent);
      const pq = portfolioQueryFromText(brief, disc.text, {
        wave: 2,
        isDiscovery: true,
        intent,
      });
      if (pq) out.push(pq);
    }
  }

  const { max } = portfolioBudget(brief.archetype, brief.directionLabel);
  return dedupePortfolioByText(out).slice(0, max);
}

function buildGiftDirectionFocusPrompt(brief: SearchBrief, count: number): string {
  const lane = cleanDirectionLabel(brief.directionLabel!.trim());
  return JSON.stringify({
    task: `Generate ${count} catalog search queries strictly inside this gift direction lane`,
    direction_lane: lane,
    specialist_role: `Expert curator for ${lane}`,
    want_query_count: count,
    seed_hint: brief.query.trim() || null,
    recipient:
      brief.recipient.kind === "other"
        ? {
            label: brief.recipient.label ?? null,
            known_interests: brief.recipient.knownInterests ?? [],
          }
        : { kind: "self" },
    occasion: brief.useCase ?? null,
    critical: `Every query.text must be a real product type that belongs in "${lane}" only — not other directions.`,
  });
}

async function callPlannerWithBody(
  brief: SearchBrief,
  body: {
    model: string;
    max_tokens: number;
    system: string;
    messages: Array<{ role: "user"; content: string }>;
  },
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    debug?: QueryPlannerDebugHooks;
    step: QueryPlannerStep;
  },
): Promise<PortfolioQuery[]> {
  logShopifyQueryPlannerPrompt(options.step, formatQueryPlannerPrompt(body));

  const { signal, clear } = abortAfterMs(options.timeoutMs, options.signal);
  let msg;
  try {
    msg = await createLightweightMessage(body, { signal });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const timedOut =
      /timed out|abort|aborted/i.test(errorMessage) ||
      (error instanceof DOMException && error.name === "AbortError");
    logAiChat("warn", "query_planner_call_failed", {
      step: options.step,
      query: brief.query.slice(0, 120),
      archetype: brief.archetype,
      timeoutMs: options.timeoutMs,
      reason: timedOut ? "timeout_or_abort" : "api_error",
      error: errorMessage,
    });
    logShopifyQueryPlannerResult(
      options.step,
      `(failed — ${timedOut ? "timeout_or_abort" : "api_error"}: ${errorMessage})`,
    );
    return [];
  } finally {
    clear();
  }

  if (!msg) {
    logAiChat("warn", "query_planner_call_failed", {
      step: options.step,
      query: brief.query.slice(0, 120),
      archetype: brief.archetype,
      timeoutMs: options.timeoutMs,
      reason: "empty_response",
    });
    logShopifyQueryPlannerResult(
      options.step,
      "(failed — empty_response: model returned no message)",
    );
    return [];
  }

  recordQueryPlannerRun(body, msg, options.step, options.debug);

  const text = msg.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const crafted = parseQueryPlannerJson(text);
  if (!crafted.length) {
    logAiChat("warn", "query_planner_parse_empty", {
      step: options.step,
      query: brief.query.slice(0, 120),
      archetype: brief.archetype,
      responsePreview: text.slice(0, 400),
    });
    logShopifyQueryPlannerResult(
      options.step,
      `(failed — parse_empty: model returned no valid catalog queries)\n${text.slice(0, 600)}`,
    );
    return [];
  }
  return rowsToPortfolio(brief, crafted, buildSearchIntent(brief));
}

async function callGiftDirectionFocusPlanner(
  brief: SearchBrief,
  count: number,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    debug?: QueryPlannerDebugHooks;
    step: QueryPlannerStep;
  },
): Promise<PortfolioQuery[]> {
  const lane = brief.directionLabel?.trim();
  if (!lane) return [];

  return callPlannerWithBody(
    brief,
    {
      model: AI_CHAT_LIGHTWEIGHT_MODEL,
      max_tokens: 768,
      system: GIFT_DIRECTION_FOCUS_SYSTEM,
      messages: [
        {
          role: "user",
          content: buildGiftDirectionFocusPrompt(brief, count),
        },
      ],
    },
    options,
  );
}

async function callPortfolioPlanner(
  brief: SearchBrief,
  count: number,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    debug?: QueryPlannerDebugHooks;
    step: QueryPlannerStep;
    budgetAngles?: BudgetSearchAngle[];
  },
): Promise<PortfolioQuery[]> {
  return callPlannerWithBody(
    brief,
    {
      model: AI_CHAT_LIGHTWEIGHT_MODEL,
      max_tokens: 768,
      system: PLANNER_SYSTEM,
      messages: [
        {
          role: "user",
          content: buildPlannerUserPrompt(brief, count, {
            budgetAngles: options.budgetAngles,
          }),
        },
      ],
    },
    options,
  );
}

/**
 * Haiku planner for all archetypes. Returns sanitized portfolio rows ready for
 * searchCatalog. Gift archetypes never fall back to a literal "gift" seed query.
 */
export async function craftPortfolioQueries(
  brief: SearchBrief,
  options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    debug?: QueryPlannerDebugHooks;
  },
): Promise<PortfolioQuery[]> {
  const sanitized = sanitizeSearchBrief(brief);
  const { max } = portfolioBudget(sanitized.archetype, sanitized.directionLabel);
  const defaultIntent = buildSearchIntent(sanitized);
  const gift = isGiftArchetype(sanitized);
  const giftDirected = gift && Boolean(sanitized.directionLabel?.trim());
  let plannerSeq = options?.debug?.sequence ?? 0;
  const plannerDebug = (step: QueryPlannerStep): QueryPlannerDebugHooks => ({
    audit: options?.debug?.audit,
    sequence: plannerSeq++,
    onRun: options?.debug?.onRun,
  });

  const baseTimeout =
    options?.timeoutMs ??
    (giftDirected
      ? AI_CHAT_GIFT_DIRECTION_PLANNER_TIMEOUT_MS
      : gift
        ? AI_CHAT_GIFT_QUERY_PLANNER_TIMEOUT_MS
        : AI_CHAT_QUERY_PLANNER_TIMEOUT_MS);

  const budgetAngles = await planBudgetAwareSearchAngles(sanitized, {
    signal: options?.signal,
    timeoutMs: AI_CHAT_BUDGET_ANGLE_PLANNER_TIMEOUT_MS,
    debug: plannerDebug("budget_angles"),
    wantCount: max,
  }).catch(() => [] as BudgetSearchAngle[]);

  const attemptTimeouts = [
    baseTimeout,
    Math.min(baseTimeout + 4000, 28_000),
    Math.min(baseTimeout + 8000, 30_000),
  ] as const;

  const queries = await callPortfolioPlanner(sanitized, max, {
    signal: options?.signal,
    timeoutMs: attemptTimeouts[0],
    budgetAngles,
    debug: plannerDebug(gift ? "gift_portfolio" : "portfolio"),
    step: gift ? "gift_portfolio" : "portfolio",
  });
  if (queries.length) return queries;

  if (gift) {
    logAiChat("warn", "gift_query_planner_empty_retry", {
      directionLabel: sanitized.directionLabel?.slice(0, 80),
      query: sanitized.query.slice(0, 120),
      nextTimeoutMs: attemptTimeouts[1],
    });

    const retry = await callPortfolioPlanner(sanitized, max, {
      signal: options?.signal,
      timeoutMs: attemptTimeouts[1],
      budgetAngles,
      debug: plannerDebug("gift_portfolio_retry"),
      step: "gift_portfolio_retry",
    });
    if (retry.length) return retry;

    if (giftDirected) {
      const focus = await callGiftDirectionFocusPlanner(sanitized, max, {
        signal: options?.signal,
        timeoutMs: attemptTimeouts[2],
        debug: plannerDebug("gift_direction_focus"),
        step: "gift_direction_focus",
      });
      if (focus.length) return focus;
    }

    const seedOnly = seedFallbackPortfolio(sanitized, defaultIntent);
    if (seedOnly.length) {
      logAiChat("info", "gift_query_planner_seed_only", {
        directionLabel: sanitized.directionLabel?.slice(0, 80),
      });
      return seedOnly;
    }

    logAiChat("error", "gift_query_planner_failed", {
      directionLabel: sanitized.directionLabel?.slice(0, 80),
      query: sanitized.query.slice(0, 120),
    });
    return [];
  }

  logAiChat("warn", "query_planner_empty_retry", {
    archetype: sanitized.archetype,
    query: sanitized.query.slice(0, 120),
    nextTimeoutMs: attemptTimeouts[1],
  });

  const retry = await callPortfolioPlanner(sanitized, max, {
    signal: options?.signal,
    timeoutMs: attemptTimeouts[1],
    budgetAngles,
    debug: plannerDebug("portfolio"),
    step: "portfolio",
  });
  if (retry.length) return retry;

  logAiChat("warn", "query_planner_exhausted", {
    archetype: sanitized.archetype,
    directionLabel: sanitized.directionLabel?.slice(0, 120),
    query: sanitized.query.slice(0, 120),
  });
  return seedFallbackPortfolio(sanitized, defaultIntent);
}

function seedFallbackPortfolio(
  brief: SearchBrief,
  intent?: string,
): PortfolioQuery[] {
  const seed = sanitizeQueryText(brief.query, brief);
  if (!isValidCatalogQuery(seed)) return [];
  const rowIntent =
    intent ??
    (isGiftArchetype(brief)
      ? buildGiftQueryIntent(brief, seed)
      : undefined);
  const row = portfolioQueryFromText(brief, seed, {
    wave: 2,
    intent: rowIntent,
  });
  return row ? [row] : [];
}
