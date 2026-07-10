import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages";
import { z } from "zod";
import {
  availabilityFromSearchVariant,
  buildCatalogCallContext,
  catalogContextFromSearchFilters,
  extractCatalogImageUrl,
  isCardAvailabilityPurchasable,
  parseCatalogRating,
  productSearchSummaryInStock,
  searchCatalog,
  searchFeaturedVariantFromProduct,
  type CardAvailability,
  type CatalogProductRating,
  type CatalogProductSummary,
  type CatalogSearchContext,
  type CatalogSearchFilters,
  type SearchFeaturedVariant,
} from "@/lib/shopify/catalog";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import {
  recordCatalogSearchRun,
  type CatalogMcpExchange,
  type CatalogSearchAuditContext,
} from "@/lib/shopify/catalog-mcp-audit";
import {
  catalogCardLimitForMode,
  MAX_PRODUCT_DISPLAY_LIMIT,
} from "./shopping-mode/display-limits";
import type { ShoppingMode } from "./shopping-mode/types";
import type { CuratedPick } from "./types";
import { buildSearchBrief, type BriefBuildContext } from "./search/archetype";
import type { SearchBrief } from "./search/types";
import {
  buildSearchIntent,
  sanitizeQueryText,
  sanitizeSearchBrief,
} from "./search/query-hygiene";

export const SHOPIFY_SEARCH_TOOL_NAME = "search_shopify_catalog";

/** Default when shopping mode is unknown. */
const PRODUCT_CARD_LIMIT_DEFAULT = 8;
/** Hard cap on the tool-result payload that goes back to Claude. */
const TOOL_RESULT_PRODUCT_LIMIT = Math.max(12, MAX_PRODUCT_DISPLAY_LIMIT);

export const shopifySearchToolInputSchema = z
  .object({
    query: z.string().min(2).max(400),
    filters: z
      .object({
        price_min_cents: z.number().int().min(0).optional(),
        price_max_cents: z.number().int().min(0).optional(),
        condition: z
          .array(z.enum(["new", "secondhand", "refurbished"]))
          .max(3)
          .optional(),
        ships_to_country: z
          .string()
          .min(2)
          .max(2)
          .regex(/^[A-Z]{2}$/i)
          .optional(),
      })
      .optional(),
    intent: z.string().max(280).optional(),
    /** Find products visually/semantically similar to these catalog product ids ("more like this"). */
    similar_to_product_ids: z
      .array(z.string().min(1).max(500))
      .max(5)
      .optional(),

    // --- Structured search brief (Stage 0). All optional: the engine fills
    // any gaps deterministically from the query + buyer memory. ---
    archetype: z
      .enum(["specific", "broad", "gift_directed", "gift_vague"])
      .optional(),
    category: z.string().max(120).optional(),
    use_case: z.string().max(200).optional(),
    must_haves: z.array(z.string().min(1).max(80)).max(8).optional(),
    nice_to_haves: z.array(z.string().min(1).max(80)).max(8).optional(),
    /** hard = never exceed; soft = ~10% overage allowed if it earns it; none = no cap. */
    budget_type: z.enum(["hard", "soft", "none"]).optional(),
    variant_constraints: z
      .object({
        size: z.string().max(40).optional(),
        color: z.string().max(40).optional(),
        other: z.record(z.string(), z.string().max(60)).optional(),
      })
      .optional(),
    gender_scope: z
      .enum(["mens", "womens", "unisex", "unknown"])
      .optional(),
    recipient: z
      .object({
        kind: z.enum(["self", "other"]),
        label: z.string().max(80).optional(),
        known_interests: z.array(z.string().min(1).max(80)).max(8).optional(),
      })
      .optional(),
    ranking_profile: z
      .enum([
        "relevance_first",
        "balanced",
        "value_first",
        "gift_diversity",
      ])
      .optional(),
    /** Internal: set when this search is one chosen gift direction. */
    direction_label: z.string().max(80).optional(),
  })
  .strict();

export type ShopifySearchToolInput = z.infer<typeof shopifySearchToolInputSchema>;

export const shopifySearchTool: Tool = {
  name: SHOPIFY_SEARCH_TOOL_NAME,
  description: `Search the Shopify Global Catalog for real, purchasable products.

Use this whenever the user wants to find, browse, compare, recommend, or buy products. This is the ONLY way you can see live product data — never invent products, prices, or URLs.

Guidelines:
- Pass a rich natural-language query in \`query\` (e.g. "lightweight men's running shoes with arch support around $100"). Embed style, use case, materials, and brand preferences inline — the catalog understands semantic queries. Keep the core noun + 2-4 strong attributes; do NOT stuff (over-long queries muddy relevance).
- Fill the STRUCTURED BRIEF fields when you can — they steer Shoop's own ranking + verification, which run server-side after the catalog returns:
  - \`archetype\`: specific | broad | gift_directed | gift_vague.
  - \`variant_constraints\` (size/color/etc): put the EXACT variant here, NOT in the query — Shoop verifies it really exists + is in stock via get_product before showing it. For size use ONE token (\`M\`, \`40\`, \`40R\`) — do not combine (\`M / 40R\`); put jacket length in \`other.Length\` when needed.
  - \`budget_type\`: hard (never exceed) | soft (~10% overage allowed if it earns it) | none.
  - \`recipient\`: { kind:"other", label, known_interests } for gifts so recipient memory drives ranking, never the buyer's own taste/gender.
  - \`direction_label\` when the buyer picked a gift direction (e.g. "Tech & Gadgets").
- GIFTS: set \`archetype\` to gift_directed only AFTER the buyer picked a direction (\`direction_label\`). While direction is unclear, use gift_vague and call \`propose_gift_directions\` — do NOT search yet (the server blocks gift searches without \`direction_label\`). Put occasion, recipient age/interests, and budget in structured fields + \`use_case\` — NOT the word "gift" in \`query\`.
- For multi-intent requests ("shoes AND a jacket"), emit SEPARATE tool calls — one brief per intent. Never blend intents into one query.
- Use \`filters\` only for hard requirements. Prices are in CENTS in the buyer's local currency. \`ships_to_country\` is an ISO-3166-1 alpha-2 code. To narrow by product type, put the category words directly in \`query\` — the catalog has no free-text category filter.
- Out-of-stock items are always excluded from search results.
- Provide \`intent\` when it adds buyer context the query cannot capture. ALWAYS set \`intent\` from the user's ACTIVE_INTENTS in <search_query_profile> when the intent category matches the current search.
- For "more like this" requests — when the buyer reacts to a specific product you already showed (e.g. "find more like that", "something like the second one but cheaper") — pass that product's id in \`similar_to_product_ids\`. You can combine it with a \`query\`/\`filters\` to steer the similarity (cheaper, different color, etc.).

Returns candidate products (count depends on the active shopping mode — up to ~10 in explore/copilot-style turns). While you write your reply, an Opus curator runs in parallel to label three of those products as Best Value / Most Popular / Shoop's Pick and attach a buy / wait / don't-recommend verdict to each. The chat UI always shows those three curated cards with reasons + verdicts, plus additional catalog matches when the mode calls for a wider gallery. You do NOT need to wait for curation. Write a short recap aligned with the mode; the cards render automatically.`,
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Natural-language query describing what the buyer wants. Be specific and embed constraints inline.",
      },
      filters: {
        type: "object",
        properties: {
          price_min_cents: {
            type: "integer",
            description: "Minimum price in cents of the buyer's currency.",
          },
          price_max_cents: {
            type: "integer",
            description: "Maximum price in cents of the buyer's currency.",
          },
          condition: {
            type: "array",
            description: "Restrict to product conditions.",
            items: { type: "string", enum: ["new", "secondhand", "refurbished"] },
          },
          ships_to_country: {
            type: "string",
            description: "ISO-3166-1 alpha-2 country code (e.g. 'US', 'FR').",
          },
        },
        additionalProperties: false,
      },
      intent: {
        type: "string",
        description:
          "Optional one-sentence buyer intent that adds shopping context the query cannot capture.",
      },
      similar_to_product_ids: {
        type: "array",
        description:
          "Catalog product ids to find similar items to ('more like this'). Use when the buyer reacts to a specific shown product (e.g. 'find more like that one' or 'something like X but cheaper'). Pass the product id(s); you can still set a query/filters to steer the similarity (e.g. lower price).",
        items: { type: "string" },
      },
      archetype: {
        type: "string",
        enum: ["specific", "broad", "gift_directed", "gift_vague"],
        description:
          "How to interpret this request: 'specific' (named item + constraints, verify exact variant), 'broad' (open category, fan out wide), 'gift_directed' (gift with a usable direction; use recipient memory), 'gift_vague' (gift with no direction — propose_gift_directions first).",
      },
      category: {
        type: "string",
        description: "Primary product category for this intent (e.g. 'running shoes').",
      },
      use_case: {
        type: "string",
        description: "What the buyer will use it for (e.g. 'first ultramarathon').",
      },
      must_haves: {
        type: "array",
        items: { type: "string" },
        description: "Hard qualitative requirements that the result MUST satisfy.",
      },
      nice_to_haves: {
        type: "array",
        items: { type: "string" },
        description: "Soft preferences that improve a result but are not required.",
      },
      budget_type: {
        type: "string",
        enum: ["hard", "soft", "none"],
        description:
          "Budget strictness. 'hard' = never exceed (set filters.price_max_cents). 'soft' = ~10% overage allowed if it clearly earns it. 'none' = no cap.",
      },
      variant_constraints: {
        type: "object",
        properties: {
          size: { type: "string" },
          color: { type: "string" },
          other: { type: "object", additionalProperties: { type: "string" } },
        },
        additionalProperties: false,
        description:
          "Exact variant the buyer needs (size/color/etc). NOT a server filter — used for availability verification. Keep size OUT of the query text.",
      },
      gender_scope: {
        type: "string",
        enum: ["mens", "womens", "unisex", "unknown"],
        description:
          "Gender scope for the QUERY. Never apply the buyer's own gender to a gift for someone else.",
      },
      recipient: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["self", "other"] },
          label: { type: "string" },
          known_interests: { type: "array", items: { type: "string" } },
        },
        required: ["kind"],
        additionalProperties: false,
        description:
          "Who this is for. Use 'other' + label for gifts so recipient memory (not the buyer's taste) drives ranking.",
      },
      ranking_profile: {
        type: "string",
        enum: [
          "relevance_first",
          "balanced",
          "value_first",
          "gift_diversity",
        ],
        description:
          "How to rank the pool. Defaults by archetype (specific->relevance_first, broad->balanced, gift->gift_diversity).",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export function shopifySearchSystemAddendum(): string {
  return `## Shopify Catalog Search
You can search a live Shopify global catalog with the tool \`${SHOPIFY_SEARCH_TOOL_NAME}\`. This is the ONLY source of real product data available to you.

When the user wants product recommendations, comparisons, or purchase help:
1. If you have enough context, call \`${SHOPIFY_SEARCH_TOOL_NAME}\` directly. Pack style, use case, and materials into \`query\`, and fill the structured brief fields (\`archetype\`, \`variant_constraints\`, \`budget_type\`, \`recipient\`, \`gender_scope\`). Shoop fans the brief into MULTIPLE parallel catalog queries, pools + de-dupes the results, re-ranks them with its own scoring, and verifies the exact variant is buyable before showing it — you do not manage any of that.
2. Put the buyer's exact size/color in \`variant_constraints\`, NOT in the query. For a multi-intent ask, emit one tool call per intent.
3. If critical attributes are still missing (size, budget, recipient, occasion, …) use the clarification tool first and wait for the answer. For budget, emit a \`budget_slider\` question; answers return \`budgetMin\` / \`budgetMax\` (null = open-ended on that side) plus a strict/soft type.
3. Never fabricate products, brands, prices, links, or stock status — only describe items returned by the tool. If the tool returns no products, say so honestly and offer to adjust the search.
4. Shoop's search engine labels picks with **Buy** / **Wait** / **Don't** verdicts and returns a \`narration_contract\` in the tool result. Follow that contract exactly: CLIENT READ → THE CALL → RUNNER-UP → kill count from ruled_out → escape hatch. Gold exemplars in the contract show voice and courage — match them. The UI renders product cards — do not re-list JSON or name slot labels.
5. Do NOT re-list the raw JSON. Write as a stylist with an opinion — resolve "work" against the profile, one primary verdict, runner-up tradeoff, real kill count, no closing questions.
6. If the user asks about products that aren't shopping-related (recipes, general knowledge, etc.), respond normally without calling the tool.
7. Each returned product has a verified \`availability\` field (stock status, whether the buyer's exact size/options are available, and a note when the selection was relaxed). Treat it as ground truth: never claim an item is "in your size" or "in stock" if availability says otherwise, and proactively flag when a size is running low, sold out, or was swapped to the closest available option.`;
}

export type ShopifySearchProductCard = {
  id: string;
  title: string;
  priceRange?: {
    min: { amount: number; currency: string };
    max: { amount: number; currency: string };
  };
  options?: Array<{ name: string; values: Array<{ label: string }> }>;
  /** Best-effort first image (Shopify guideline: render in real-time, never cache). */
  imageUrl?: string;
  /** Resolved offer variant for display and PDP (query-matched when possible). */
  featuredVariant?: SearchFeaturedVariant;
  /** Single price for chat UI when variant is confidently resolved. */
  displayPrice?: { amount: number; currency: string };
  /** Search `variants[]` for resolver (stripped before SSE if needed). */
  searchVariants?: CatalogProductSummary["variants"];
  /**
   * Option values to pre-select on the product detail page. Merges search
   * featured-variant options with `inferPreferredOptions` after the search.
   */
  preferredOptions?: Array<{ name: string; label: string }>;
  /** Buyer-aware stock / size / shipping snapshot from `get_product` hydration. */
  availability?: CardAvailability;
  /** Product rating + review count from `get_product` hydration. */
  rating?: CatalogProductRating;
  /** ML-inferred catalog attributes (material, style, occasion, …). */
  catalogAttributes?: import("@/lib/shopify/catalog-attributes").CatalogInferredAttribute[];
};

export type ShopifySearchExecution = {
  input: ShopifySearchToolInput;
  /** Surfaced to the UI (limited count, trimmed fields). */
  cards: ShopifySearchProductCard[];
  /** Raw products as returned by the catalog (cropped). */
  rawCount: number;
};

const SEARCH_VARIANTS_ON_CARD = 5;

function normalizeCard(p: CatalogProductSummary): ShopifySearchProductCard | null {
  if (!productSearchSummaryInStock(p)) return null;
  const imageUrl = extractCatalogImageUrl(p) ?? undefined;
  const searchVariants = p.variants?.slice(0, SEARCH_VARIANTS_ON_CARD);
  const featuredVariant = searchFeaturedVariantFromProduct(p);
  const rating = parseCatalogRating(p.rating);
  const offerVariant =
    p.variants?.find((v) => featuredVariant?.id && v.id === featuredVariant.id) ??
    p.variants?.find((v) => v.checkout_url) ??
    p.variants?.[0];
  const availability = availabilityFromSearchVariant(offerVariant);
  if (!availability || !isCardAvailabilityPurchasable(availability)) return null;
  const catalogAttributes = extractCatalogAttributes(p);
  return {
    id: p.id,
    title: p.title,
    searchVariants,
    featuredVariant,
    priceRange: p.price_range
      ? {
          min: {
            amount: p.price_range.min.amount,
            currency: p.price_range.min.currency,
          },
          max: {
            amount: p.price_range.max.amount,
            currency: p.price_range.max.currency,
          },
        }
      : undefined,
    options: p.options?.map((opt) => ({
      name: opt.name,
      values: opt.values.slice(0, 8).map((v) => ({ label: v.label })),
    })),
    imageUrl,
    ...(catalogAttributes.length ? { catalogAttributes } : {}),
    ...(rating ? { rating } : {}),
    ...(availability ? { availability } : {}),
  };
}

function toCatalogFilters(input: ShopifySearchToolInput): CatalogSearchFilters {
  const f: CatalogSearchFilters = { available: true };
  const src = input.filters;
  if (!src) return f;
  if (src.condition?.length) f.condition = src.condition;
  if (src.price_min_cents != null || src.price_max_cents != null) {
    f.price = {};
    if (src.price_min_cents != null) f.price.min = src.price_min_cents;
    if (src.price_max_cents != null) f.price.max = src.price_max_cents;
  }
  if (src.ships_to_country) {
    f.ships_to = { country: src.ships_to_country.toUpperCase() };
  }
  return f;
}

/**
 * W2: Broaden a query that returned too few results by progressively stripping
 * the most restrictive constraints. Returns a new input with looser filters and
 * a shorter, more generic query.
 *
 * Strategy (applied in order until rawCount ≥ MIN_RESULTS):
 *   Pass 1 — drop price filters
 *   Pass 2 — drop all filters, shorten query to the first 6 words
 */
function broadenSearchInput(
  input: ShopifySearchToolInput,
  pass: number,
): ShopifySearchToolInput {
  if (pass === 1) {
    const { price_min_cents: _a, price_max_cents: _b, ...restFilters } =
      input.filters ?? {};
    return {
      ...input,
      filters: Object.keys(restFilters).length ? restFilters : undefined,
    };
  }
  // Pass 2: strip all filters, shorten query to core nouns
  const shortQuery = input.query
    .split(/\s+/)
    .slice(0, 6)
    .join(" ")
    .replace(/\b(with|for|around|under|about|near|size|eu|us)\b.*$/i, "")
    .trim();
  return {
    query: shortQuery || input.query,
    intent: input.intent,
    similar_to_product_ids: input.similar_to_product_ids,
  };
}

/** W2: Minimum acceptable result count before triggering a broadened retry. */
const MIN_RESULTS_BEFORE_RETRY = 3;

/** Buyer signals enforced server-side regardless of what the model passes. */
export type ExecuteSearchBuyer = {
  /** ISO-3166-1 alpha-2 the buyer ships to. Applied when the model omits it. */
  shipsToCountry?: string;
  /** Localization context (currency, language, country) merged into the call. */
  context?: CatalogSearchContext;
};

async function runOneCatalogSearch(
  access_token: string,
  input: ShopifySearchToolInput,
  buyer?: ExecuteSearchBuyer,
  signal?: AbortSignal,
  limit?: number,
  audit?: {
    context: CatalogSearchAuditContext;
    attempt: number;
    originalToolInput: ShopifySearchToolInput;
  },
): Promise<{ products: CatalogProductSummary[] }> {
  const filters = toCatalogFilters(input);
  // Enforce the buyer's shipping destination even if the model forgot to set
  // it — never surface something that cannot reach them.
  if (!filters.ships_to && buyer?.shipsToCountry) {
    filters.ships_to = { country: buyer.shipsToCountry.toUpperCase() };
  }
  const ctxFromFilters = catalogContextFromSearchFilters(filters) ?? {};
  const context = buildCatalogCallContext(
    filters,
    {
      ...(buyer?.context ?? {}),
      ...ctxFromFilters,
    },
    input.intent,
  );
  const like = input.similar_to_product_ids?.length
    ? input.similar_to_product_ids.map((id) => ({ id }))
    : undefined;

  let lastExchange: CatalogMcpExchange | null = null;

  try {
    const result = await searchCatalog(access_token, input.query, filters, {
      context,
      like,
      limit,
      signal,
      onMcpExchange: (exchange) => {
        lastExchange = exchange;
      },
    });
    const products = result.products ?? [];

    if (audit) {
      recordCatalogSearchRun({
        ...audit.context,
        attempt: audit.attempt,
        callKind: audit.attempt === 0 ? null : "legacy_broaden",
        query: input.query,
        toolInput: audit.originalToolInput as unknown as Record<string, unknown>,
        effectiveInput: input as unknown as Record<string, unknown>,
        exchange: lastExchange,
        products,
      });
    }

    return { products };
  } catch (error) {
    if (audit) {
      recordCatalogSearchRun({
        ...audit.context,
        attempt: audit.attempt,
        callKind: audit.attempt === 0 ? null : "legacy_broaden",
        query: input.query,
        toolInput: audit.originalToolInput as unknown as Record<string, unknown>,
        effectiveInput: input as unknown as Record<string, unknown>,
        exchange: lastExchange,
        products: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

export async function executeShopifySearch(
  input: ShopifySearchToolInput,
  options?: {
    shoppingMode?: ShoppingMode;
    signal?: AbortSignal;
    buyer?: ExecuteSearchBuyer;
    audit?: CatalogSearchAuditContext;
  },
): Promise<ShopifySearchExecution> {
  const access_token = await accessTokenForCatalogMcp();
  const brief = sanitizeSearchBrief(briefFromSearchInput(input));
  const sanitizedQuery = sanitizeQueryText(input.query, brief);
  const baseInput: ShopifySearchToolInput = {
    ...input,
    query: sanitizedQuery,
    intent: input.intent ?? buildSearchIntent(brief) ?? undefined,
  };

  const cardLimit = options?.shoppingMode
    ? catalogCardLimitForMode(options.shoppingMode)
    : PRODUCT_CARD_LIMIT_DEFAULT;
  // Fetch a buffer beyond what we display: hard-avoid filtering can drop hits,
  // and the curator picks better with more candidates. MCP caps page size at 50.
  const fetchLimit = Math.min(50, Math.max(cardLimit + 6, 12));

  let currentInput = baseInput;
  let products: CatalogProductSummary[] = [];

  for (let pass = 0; pass <= 2; pass++) {
    if (options?.signal?.aborted) break;
    const result = await runOneCatalogSearch(
      access_token,
      currentInput,
      options?.buyer,
      options?.signal,
      fetchLimit,
      options?.audit
        ? {
            context: options.audit,
            attempt: pass,
            originalToolInput: baseInput,
          }
        : undefined,
    );
    products = result.products;
    // If we have enough results, stop. Otherwise broaden and retry.
    if (products.length >= MIN_RESULTS_BEFORE_RETRY || pass === 2) break;
    currentInput = broadenSearchInput(currentInput, pass + 1);
  }

  const cards = products
    .slice(0, cardLimit * 2)
    .map(normalizeCard)
    .filter((c): c is ShopifySearchProductCard => c != null)
    .slice(0, cardLimit);

  return {
    input: baseInput,
    cards,
    rawCount: products.length,
  };
}

/** What we send back to Claude as the `tool_result` body. */
export function buildToolResultPayload(
  exec: ShopifySearchExecution,
  curated?: { picks: CuratedPick[]; fallback: boolean },
): string {
  const slimmed = exec.cards.slice(0, TOOL_RESULT_PRODUCT_LIMIT).map((p) => ({
    id: p.id,
    title: p.title,
    price_min: p.priceRange
      ? `${(p.priceRange.min.amount / 100).toFixed(2)} ${p.priceRange.min.currency}`
      : null,
    price_max: p.priceRange
      ? `${(p.priceRange.max.amount / 100).toFixed(2)} ${p.priceRange.max.currency}`
      : null,
    options:
      p.options?.map((o) => ({
        name: o.name,
        values: o.values.map((v) => v.label),
      })) ?? [],
    featured_variant_id: p.featuredVariant?.id ?? null,
    featured_variant_price: p.featuredVariant?.price
      ? `${(p.featuredVariant.price.amount / 100).toFixed(2)} ${p.featuredVariant.price.currency}`
      : null,
    preferred_options:
      p.preferredOptions?.map((o) => ({ name: o.name, label: o.label })) ??
      [],
    resolved_variant_id: p.featuredVariant?.id ?? null,
    resolved_variant_price: p.displayPrice
      ? `${(p.displayPrice.amount / 100).toFixed(2)} ${p.displayPrice.currency}`
      : p.featuredVariant?.price
        ? `${(p.featuredVariant.price.amount / 100).toFixed(2)} ${p.featuredVariant.price.currency}`
        : null,
    // Verified buyer-aware stock so the recap never claims a perfect match
    // when the exact size was relaxed or the item is low/out of stock.
    availability: p.availability
      ? {
          stock: p.availability.status,
          buyer_size_available: p.availability.preferredMatched,
          note: p.availability.relaxedNote ?? null,
        }
      : null,
    rating: p.rating
      ? `${p.rating.value.toFixed(1)}/${p.rating.scaleMax} (${p.rating.count} reviews)`
      : null,
  }));

  const curatedPayload = curated?.picks?.length
    ? {
        source: curated.fallback ? "heuristic" : "opus_curator",
        picks: curated.picks.map((p) => ({
          slot: p.slot,
          product_id: p.id,
          title: p.title,
          reason: p.reason,
          verdict: p.verdict,
        })),
      }
    : null;

  return JSON.stringify({
    query: exec.input.query,
    total_returned: exec.rawCount,
    products: slimmed,
    curated: curatedPayload,
  });
}

export function emptyToolResultPayload(query: string, reason: string): string {
  return JSON.stringify({
    query,
    total_returned: 0,
    products: [],
    error: reason,
  });
}

/**
 * Build a complete `SearchBrief` (Stage 0) from a parsed search tool input plus
 * buyer/memory context. The engine consumes the brief; gaps the model left are
 * filled deterministically (archetype, ranking profile, budget, gender scope).
 */
export function briefFromSearchInput(
  input: ShopifySearchToolInput,
  ctx?: BriefBuildContext,
): SearchBrief {
  return sanitizeSearchBrief(
    buildSearchBrief({
      query: input.query,
      fields: {
        archetype: input.archetype,
        category: input.category,
        use_case: input.use_case,
        must_haves: input.must_haves,
        nice_to_haves: input.nice_to_haves,
        budget_type: input.budget_type,
        budget_amount_cents: input.filters?.price_max_cents,
        variant_constraints: input.variant_constraints,
        gender_scope: input.gender_scope,
        recipient: input.recipient,
        ranking_profile: input.ranking_profile,
        condition: input.filters?.condition,
        similar_to_product_ids: input.similar_to_product_ids,
        direction_label: input.direction_label,
      },
      priceMinCents: input.filters?.price_min_cents,
      priceMaxCents: input.filters?.price_max_cents,
      ctx,
    }),
  );
}
