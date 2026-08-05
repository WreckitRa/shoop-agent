export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus = "completed" | "streaming" | "failed" | "stopped";

export type ResponseStyle = "concise" | "balanced" | "detailed";

/** Stable id for the auto-injected "Other" chip on clarification questions. */
export { CLARIFICATION_OTHER_OPTION_ID } from "@/lib/fashion-memory/router/clarification-defaults";

export type ClarificationOptionPreviewImage = {
  url: string;
  title: string;
  productId: string;
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
   * relaxed constraint).
   */
  caveat?: string;
  /** Cross-merchant cluster id (UPID) for de-dupe across searches. */
  upid?: string;
  /** Native (Rye-first) checkout URL captured at verification. */
  nativeCheckoutUrl?: string;
  /** Which engine produced this pick (heuristic | fast_haiku | deep_opus | engine). */
  sourceEngine?: string;
  /** Composite Shoop score (Stage 3). */
  score?: number;
  /** Tier from judgment pass (1 = hero-quality). */
  tier?: number;
};

import type { ComposerReplyContext } from "./composer-reply-context";

export type MessageMetadata = {
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
   * Compact “Ask your friends” share card injected after Studying Scan.
   */
  lookAsk?: {
    token: string;
    imageUrl: string;
    verdictTitle: string;
    askPath: string;
    shoopVote?: string;
  };
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
