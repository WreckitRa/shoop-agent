export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus = "completed" | "streaming" | "failed" | "stopped";

export type ResponseStyle = "concise" | "balanced" | "detailed";

export type ChatSettings = {
  model: string;
  temperature: number;
  maxTokens: number;
  responseStyle: ResponseStyle;
  systemPrompt?: string;
};

/** Stable id for the auto-injected "Other" chip on clarification questions. */
export const CLARIFICATION_OTHER_OPTION_ID = "other";

export type ClarificationOptionPreviewImage = {
  url: string;
  title: string;
  productId: string;
};

export type ClarificationOption = {
  id: string;
  label: string;
  /** Catalog search phrase for visual preview collages (server-fetched). */
  previewQuery?: string;
  /** Hydrated preview images — persisted after first fetch. */
  previewImages?: ClarificationOptionPreviewImage[];
};

export type ClarificationQuestion = {
  id: string;
  prompt: string;
  optional: boolean;
  /** @deprecated Prefer allowOther — shows an "Other" chip that reveals free text. */
  allowCustom?: boolean;
  /** When true, an "Other" chip is shown; selecting it reveals a free-text field. */
  allowOther?: boolean;
  /** When true, the user may pick more than one chip for this question. */
  allowMultiple?: boolean;
  /** Default `options` — use `budget_slider` for a flexible budget range control. */
  inputType?: "options" | "budget_slider";
  budgetSlider?: {
    /** Slider track lower bound (always 0 in the UI). */
    floor: number;
    /** Slider track upper bound. */
    ceiling: number;
    step: number;
    currency: string;
    defaultMode: "up_to" | "range" | "at_least" | "any";
    defaultMin: number;
    defaultMax: number;
  };
  options: ClarificationOption[];
};

export type ClarificationAnswer = {
  optionIds?: string[];
  customText?: string;
  /** Legacy single max — prefer budgetMin/budgetMax. */
  budgetAmount?: number;
  /** Null = no minimum / any price on the low end. */
  budgetMin?: number | null;
  /** Null = no maximum / open-ended. */
  budgetMax?: number | null;
  currency?: string;
  /**
   * How firmly the buyer holds the budget. "hard" = never exceed; "soft" =
   * a small overage is OK if it clearly earns it. Feeds the brief `budget.type`.
   */
  budgetType?: "hard" | "soft";
};

export type MessageClarificationV1 = {
  version: 1;
  questions: ClarificationQuestion[];
  status: "pending" | "answered" | "skipped";
  answers?: Record<string, ClarificationAnswer>;
  /** True when at least one option has a preview_query awaiting hydration. */
  expectsOptionPreviews?: boolean;
};

import type {
  CardAvailability,
  CatalogProductRating,
  CatalogVariantSummary,
  SearchFeaturedVariant,
} from "@/lib/shopify/catalog";
import type { CatalogInferredAttribute } from "@/lib/shopify/catalog-attributes";

export type ProductCard = {
  id: string;
  title: string;
  priceRange?: {
    min: { amount: number; currency: string };
    max: { amount: number; currency: string };
  };
  options?: Array<{ name: string; values: Array<{ label: string }> }>;
  /** Optional product thumbnail from the catalog. */
  imageUrl?: string;
  /** Featured offer from `search_catalog` (variant id, price, options). */
  featuredVariant?: SearchFeaturedVariant;
  /** Single price shown in chat when a variant is confidently resolved. */
  displayPrice?: { amount: number; currency: string };
  /** Raw search variants (server-side resolver input; omitted from client payloads). */
  searchVariants?: CatalogVariantSummary[];
  /**
   * Option values to pre-select on the product detail page when the user
   * opens it. Merges search featured-variant options with query/intent
   * inference and stored sizing/colour preferences.
   */
  preferredOptions?: Array<{ name: string; label: string }>;
  /** Buyer-aware stock / size / shipping snapshot (when verified). */
  availability?: CardAvailability;
  /** Product rating + review count (when verified during hydration). */
  rating?: CatalogProductRating;
  /** ML-inferred catalog attributes (material, style, occasion, …). */
  catalogAttributes?: CatalogInferredAttribute[];
};

export type CurationSlot =
  | "best_value"
  | "most_popular"
  | "shoop_pick"
  | "gallery"
  /** High raw rating, modest reviews, small seller (Stage 5 gem slot). */
  | "gem"
  /** Surfaced after a budget/constraint relaxation round. */
  | "loosened"
  /** Surfaced after the search was reframed to a broader/parent category. */
  | "reframed";

export type CurationVerdict = "buy" | "wait" | "dont_recommend";

/** Structured PDP copy persisted per curated product. */
export type CurationPdpInsight = {
  retailerCheckNote: string;
  fitReasons: [string, string, string];
  checkedItems: string[];
  pickStory: string;
  changeMindItems: string[];
};

/** One of the three Shoop-curated picks for a search turn. */
export type CuratedPick = ProductCard & {
  slot: CurationSlot;
  /** One-sentence verdict headline (sidebar + chat card). */
  reason: string;
  verdict: CurationVerdict;
  insight: CurationPdpInsight;
  /**
   * Honest one-line caveat shown on the card (budget overage, small shop,
   * relaxed constraint). See docs/search-improvements.md §1, §11.
   */
  caveat?: string;
  /** Cross-merchant cluster id (UPID) for de-dupe across searches. */
  upid?: string;
  /** Native (Rye-first) checkout URL captured at verification. */
  nativeCheckoutUrl?: string;
  /** Which engine produced this pick (heuristic | fast_haiku | deep_opus | engine). */
  sourceEngine?: string;
  /** Composite Shoop score (Stage 3) — for debugging / telemetry. */
  score?: number;
  /** Tier from judgment pass (1 = hero-quality). */
  tier?: number;
};

export type ProductSearchInvocation = {
  query: string;
  filters?: {
    price_min_cents?: number;
    price_max_cents?: number;
    condition?: string[];
    ships_to_country?: string;
  };
  intent?: string;
  /** Curated rack shown in chat (featured + gallery). Legacy callers may still attach a wider verify pool during streaming. */
  products: ProductCard[];
  /** Opus-selected Best value / Most popular / Shoop's pick with reason + verdict. */
  curatedPicks?: CuratedPick[];
  /** True when the catalog returned more products than we surface in cards. */
  truncated?: boolean;
  error?: string;
  /** Set when curation used a heuristic fallback after the curator model failed. */
  curationFallback?: boolean;
  /**
   * Stable id (tool_use block id from Anthropic) so async SSE updates can find
   * this invocation in the message metadata.
   */
  searchKey?: string;
  /** True while the Opus curator pass is still running for this invocation. */
  curationPending?: boolean;
  /**
   * Max products to render for this search (curated slots included).
   * Snapshotted from the resolved shopping mode when the search ran.
   */
  displayLimit?: number;
  /**
   * Gift-direction label when this invocation is one chosen direction of a
   * grouped gift_vague result set (renders as a labeled group in the UI).
   */
  directionLabel?: string;
  /** Resolved request archetype for this search (Stage 0). */
  archetype?: import("./search/types").Archetype;
  /** Structured mission snapshot for intent-branch compare (Stage 0 brief). */
  mission?: import("./intent-branch/search-mission").SearchMissionSnapshot;
  /**
   * `raw` — show catalog hits directly (fashion mode). Default curated path
   * omits this field.
   */
  displayMode?: "curated" | "raw";
};

export type MessageProductSearchV1 = {
  version: 1;
  searches: ProductSearchInvocation[];
};

export type ShoppingModeMetaV1 = {
  version: 1;
  mode: "judge" | "copilot" | "hybrid" | "directional";
  source: "user" | "auto";
  reason?: string;
  contextTag?: string | null;
};

export type TopicGuardMetaV1 = {
  version: 1;
  blocked: boolean;
  category: string;
  source: string;
  reason: string;
};

/** A single selectable gift direction (Stage 5 gift flow). */
export type GiftDirectionOption = {
  id: string;
  label: string;
  rationale?: string;
  /** Catalog search phrase for visual preview collages. */
  previewQuery?: string;
  previewImages?: ClarificationOptionPreviewImage[];
};

/** Multi-select gift directions surfaced to the buyer (docs §5 Step B). */
export type MessageGiftDirectionsV1 = {
  version: 1;
  recipientLabel: string;
  contextSummary?: string;
  directions: GiftDirectionOption[];
  /** How many directions to ask the buyer to choose (1-3). */
  pickCount: number;
  status: "pending" | "answered";
  /** Chosen direction labels once submitted. */
  selected?: string[];
  expectsOptionPreviews?: boolean;
};

/** Metadata for find-similar taste probe re-runs (attribute chip answers). */
export type SimilarTasteProbeMetaV1 = {
  version: 1;
  seedProductId: string;
  seedTitle: string;
  sourceMessageId: string;
  upid?: string;
  /** When the user selected multiple seeds before searching. */
  seeds?: Array<{
    productId: string;
    productTitle: string;
    upid?: string;
  }>;
};

import type { ComposerReplyContext } from "./composer-reply-context";

export type MessageMetadata = {
  clarification?: MessageClarificationV1;
  productSearch?: MessageProductSearchV1;
  shoppingMode?: ShoppingModeMetaV1;
  topicGuard?: TopicGuardMetaV1;
  giftDirections?: MessageGiftDirectionsV1;
  similarTasteProbe?: SimilarTasteProbeMetaV1;
  /** Product pick the user was asking about when they sent this message. */
  composerReply?: ComposerReplyContext;
  /** Fashion router turn outcome (clarification, off-topic, or search brief). */
  fashionRouter?: import("@/lib/fashion-memory/router/types").MessageFashionRouterMetaV1;
  fashionPendingBrief?: import("@/lib/fashion-memory/router/types").FashionPendingBriefMetaV1;
  /** Validated catalog retrieval plan (after ready_to_search). */
  fashionSearchPlan?: import("@/lib/fashion-memory/search-planner/types").MessageFashionSearchPlanMetaV1;
  /** Raw UCP catalog fan-out per slot (no normalization/scoring). */
  fashionCatalogSearch?: import("@/lib/fashion-memory/catalog-search/types").MessageFashionCatalogSearchMetaV1;
  /**
   * Compact turn pipeline events for the debug panel (capped/truncated).
   * Full history lives in admin via pipeline_events table.
   */
  fashionPipelineEvents?: import("@/lib/fashion-memory/observability/pipeline-event-payloads").CompactPipelineEvent[];
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  createdAt: string;
  updatedAt: string;
  branchId?: string | null;
  model?: string | null;
  finishReason?: string | null;
  error?: string | null;
  metadata?: MessageMetadata | null;
};

export type ConversationBranchSummary = {
  id: string;
  conversationId: string;
  index: number;
  title: string;
  anchorMessageId: string | null;
  sourceMessageId?: string | null;
  createdAt: string;
};

export type SidebarConversationNode = {
  conversation: ConversationSummary;
  branches: ConversationBranchSummary[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  /** ISO timestamp when the user deleted this shoop from their UI. */
  deletedAt?: string | null;
  pinned: boolean;
  model: string;
  responseStyle: ResponseStyle;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string | null;
  /** Per-chat shipping country (snapshot from profile at create; overridable). */
  shippingCountry?: string | null;
  /** Per-chat currency (snapshot from profile at create; overridable). */
  currency?: string | null;
};
