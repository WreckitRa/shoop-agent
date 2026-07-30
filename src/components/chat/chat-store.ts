"use client";

import { create } from "zustand";
import type {
  ChatMessage,
  ClarificationOptionPreviewImage,
  ConversationBranchSummary,
  ConversationSummary,
  CuratedPick,
  ProductCard,
  MessageClarificationV1,
  MessageGiftDirectionsV1,
  MessageMetadata,
  ProductSearchInvocation,
  ResponseStyle,
  ShoppingModeMetaV1,
  SidebarConversationNode,
} from "@/lib/ai-chat/types";
import type { ComposerReplyContext } from "@/lib/ai-chat/composer-reply-context";
import { composerReplyFromPick } from "@/lib/ai-chat/composer-reply-context";
import { applyIntentBranchSplitsToMessages } from "@/lib/ai-chat/intent-branch/apply-splits-to-messages";
import { logIntentBranch } from "@/lib/ai-chat/intent-branch/debug-log";
import { mergeOptionPreviewsIntoClarification } from "@/lib/ai-chat/search-clarification";
import { mergeOptionPreviewsIntoFashionRouter } from "@/lib/fashion-memory/router/clarification-defaults";
import { mergeOptionPreviewsIntoGiftDirections } from "@/lib/ai-chat/search/gift-directions";
import {
  parseSidebarNodes,
  sidebarNodesToConversations,
} from "@/lib/client/sidebar-nodes";
import { useToastStore } from "@/lib/client/toast-store";
import { consumeChatSseStream } from "@/lib/ai-chat/sse-client";
import type { MessageFashionCatalogSearchMetaV1 } from "@/lib/fashion-memory/catalog-search/types";
import { scheduleIdleWork } from "@/lib/fashion-memory/schedule-detached";
import {
  loadGuestFashionStore,
  persistGuestFashionRequestEvent,
  readGuestFashionMemoryForUser,
  saveGuestFashionSnapshot,
} from "@/lib/fashion-memory/client/guest-bridge";
import { applyFashionMemoryDelta } from "@/lib/fashion-memory/local/apply-delta";
import type { GuestFashionMemorySnapshot } from "@/lib/fashion-memory/local/store";
import type { FashionLlmOp } from "@/lib/fashion-memory/extraction/tool-schema";
import type { RequestEventAttributes } from "@/lib/fashion-memory/types";
import { guestUserIdFromSessionId } from "@/lib/auth/guest-session";
import {
  scheduleGuestFashionExtraction,
  spawnGuestFashionExtractionSweep,
} from "@/lib/fashion-memory/client/spawn-extraction";
import { getGuestSessionId } from "@/lib/client/guest-storage";
import { DEFAULT_UI_SETTINGS } from "@/lib/ai-chat/constants";
import { mergeProductSearchMetadata } from "@/lib/ai-chat/merge-product-search-metadata";
import { formatFindSimilarUserText } from "@/lib/ai-chat/search/find-similar/action";
import {
  MAX_FIND_SIMILAR_SEEDS,
  type FindSimilarSeed,
} from "@/lib/ai-chat/search/find-similar/types";
import {
  mergeOptionPreviewMetadata,
  messageExpectsOptionPreviews,
  messageHasOptionPreviewImages,
} from "@/lib/ai-chat/merge-option-preview-metadata";
import { messageNeedsCurationEnhancement } from "@/lib/ai-chat/curation/enhancement-state";
import {
  isShoppingMode,
} from "@/lib/ai-chat/shopping-mode";
import {
  NEW_CHAT_PATH,
  conversationPath,
  isChatRoutePathname,
  parseConversationIdFromPath,
} from "@/lib/shared/chatRoutes";
import { guestFetch } from "@/lib/client/guest-fetch";
import { leaveConversationRoute } from "@/lib/client/chat-navigation";
import {
  useAgentDebugStore,
  ingestAgentDebugFromSse,
} from "@/components/chat/agent-debug-store";
import {
  useAppSessionStore,
} from "@/lib/client/app-session";
import { useCartStore } from "@/components/cart/cart-store";
import { SHOPIFY_COUNTRIES } from "@/lib/cart/countries";
import { currencyHintForCountry } from "@/lib/onboarding/form-options";
import { useUserProfileStore } from "@/lib/client/user-profile-store";
import {
  createGuestConversationPlaceholder,
  isGuestSessionActive,
  listVisibleGuestConversations,
  loadGuestData,
  saveGuestData,
  softDeleteGuestConversation,
  syncGuestChatFromStore,
  syncGuestBranchesToLocal,
  syncGuestConversationsToLocal,
  getGuestBranches,
  upsertGuestConversation,
} from "@/lib/client/guest-storage";

type NavigateFn = (path: string) => void;

let fetchConversationsInflight: Promise<void> | null = null;

/** Drop in-flight list results after an identity reset so the next fetch is fresh. */
export function invalidateConversationListFetch() {
  const token = useChatStore.getState()._fetchListToken + 1;
  useChatStore.setState({ _fetchListToken: token, loadingList: false });
  fetchConversationsInflight = null;
}

async function responseErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    return typeof j.error === "string" ? j.error : fallback;
  } catch {
    return fallback;
  }
}

function buildPayloadSettings(meta: ConversationSummary | null) {
  return {
    model: meta?.model ?? DEFAULT_UI_SETTINGS.model,
    temperature: meta?.temperature ?? DEFAULT_UI_SETTINGS.temperature,
    maxTokens: meta?.maxTokens ?? DEFAULT_UI_SETTINGS.maxTokens,
    responseStyle: (meta?.responseStyle ??
      DEFAULT_UI_SETTINGS.responseStyle) as ResponseStyle,
    systemPrompt:
      (meta?.systemPrompt ?? DEFAULT_UI_SETTINGS.systemPrompt)?.trim() ||
      undefined,
  };
}

/** Client-only ids so we can show messages before the first SSE arrives. */
const LOCAL_CONV_PLACEHOLDER = "__local_conv__";
const LOCAL_USER_PREFIX = "local-user-";
const LOCAL_ASSIST_PREFIX = "local-asst-";

function makeLocalUserId() {
  return `${LOCAL_USER_PREFIX}${crypto.randomUUID()}`;
}

function makeLocalAssistantId() {
  return `${LOCAL_ASSIST_PREFIX}${crypto.randomUUID()}`;
}

function persistGuestChatState(
  state: Pick<
    ChatState,
    "conversations" | "messages" | "activeConversationId"
  >,
) {
  if (!isGuestSessionActive()) return;
  const data = loadGuestData();
  if (!data) return;
  syncGuestChatFromStore({
    conversations: state.conversations,
    messagesByConversationId: data.messagesByConversationId,
    activeConversationId: state.activeConversationId,
    activeMessages: state.activeConversationId ? state.messages : undefined,
  });
}

function hasInMemoryConversationMessages(
  messages: ChatMessage[],
  conversationId: string,
): boolean {
  return messages.some(
    (m) =>
      m.conversationId === conversationId ||
      m.conversationId === LOCAL_CONV_PLACEHOLDER,
  );
}

/** Skip server reload when optimistic/streaming UI already owns this thread. */
function shouldPreserveInMemoryConversation(
  state: Pick<
    ChatState,
    "messages" | "isStreaming" | "activeStream" | "activeConversationId"
  >,
  conversationId: string,
): boolean {
  if (!hasInMemoryConversationMessages(state.messages, conversationId)) {
    return false;
  }
  if (state.isStreaming) {
    const streamConv = state.activeStream?.conversationId;
    if (streamConv === conversationId || streamConv === null) return true;
  }
  return (
    state.activeConversationId === conversationId && state.messages.length > 0
  );
}


function resolveAssistantMessageId(
  messages: ChatMessage[],
  messageId: string,
  streamingAssistantMessageId: string | null,
): string {
  if (messages.some((m) => m.id === messageId)) return messageId;
  if (
    streamingAssistantMessageId &&
    messages.some((m) => m.id === streamingAssistantMessageId)
  ) {
    return streamingAssistantMessageId;
  }
  const pending = [...messages]
    .reverse()
    .find(
      (m) =>
        m.role === "assistant" &&
        (m.metadata?.giftDirections?.status === "pending" ||
          m.metadata?.clarification?.status === "pending"),
    );
  return pending?.id ?? messageId;
}

/** Copy streamed tokens into `messages` on `done` so clearing `streamingDraft` does not blank the bubble. */
function applyAssistantStreamDone(
  messages: ChatMessage[],
  messageId: string,
  finalText: string,
  status: ChatMessage["status"],
  metadata?: ChatMessage["metadata"] | undefined,
  streamingAssistantMessageId: string | null = null,
  error?: string | null,
): ChatMessage[] {
  const targetId = resolveAssistantMessageId(
    messages,
    messageId,
    streamingAssistantMessageId,
  );
  return messages.map((m) => {
    if (m.id !== targetId) return m;
    let mergedMetadata = m.metadata;
    if (metadata !== undefined) {
      if (metadata === null) {
        mergedMetadata = null;
      } else {
        mergedMetadata = {
          ...mergeOptionPreviewMetadata(m.metadata, metadata),
          productSearch: mergeProductSearchMetadata(
            m.metadata?.productSearch,
            metadata.productSearch,
          ),
        };
      }
    }
    return {
      ...m,
      content: finalText.length > 0 ? finalText : m.content,
      status,
      ...(error !== undefined ? { error: error ?? undefined } : {}),
      ...(metadata !== undefined ? { metadata: mergedMetadata } : {}),
    };
  });
}

const CURATION_POLL_MS = 2500;
const CURATION_POLL_MAX_MS = 120_000;
const PREVIEW_POLL_MS = 1500;
const PREVIEW_POLL_MAX_MS = 12_000;
const activeOptionPreviewPolls = new Set<string>();

function optionPreviewPollKey(
  conversationId: string,
  assistantMessageId: string,
): string {
  return `${conversationId}:${assistantMessageId}`;
}

function logClientOptionPreview(stage: string, payload?: Record<string, unknown>) {
  if (process.env.NEXT_PUBLIC_OPTION_PREVIEW_DEBUG !== "1") return;
  console.info("[option_preview:client]", stage, payload ?? "");
}

/** Poll until preview images land in DB (fallback if SSE missed). */
function scheduleOptionPreviewPoll(args: {
  get: () => Pick<ChatState, "activeConversationId" | "messages" | "loadConversation">;
  conversationId: string | null;
  assistantMessageId: string | null;
}) {
  const { get, conversationId, assistantMessageId } = args;
  if (!conversationId || !assistantMessageId) return;

  const pollKey = optionPreviewPollKey(conversationId, assistantMessageId);
  if (activeOptionPreviewPolls.has(pollKey)) return;
  activeOptionPreviewPolls.add(pollKey);

  const startedAt = Date.now();

  const finishPoll = () => {
    activeOptionPreviewPolls.delete(pollKey);
  };

  const poll = () => {
    if (Date.now() - startedAt > PREVIEW_POLL_MAX_MS) {
      finishPoll();
      return;
    }
    if (!isActiveChatCurationContext(conversationId)) {
      finishPoll();
      return;
    }
    const s = get();
    if (s.activeConversationId !== conversationId) {
      finishPoll();
      return;
    }

    const msg =
      s.messages.find((m) => m.id === assistantMessageId) ??
      s.messages.find(
        (m) =>
          m.role === "assistant" &&
          (m.metadata?.giftDirections?.status === "pending" ||
            m.metadata?.clarification?.status === "pending"),
      );
    if (!msg) {
      finishPoll();
      return;
    }
    if (
      !messageExpectsOptionPreviews(msg.metadata) ||
      messageHasOptionPreviewImages(msg.metadata)
    ) {
      finishPoll();
      return;
    }

    logClientOptionPreview("poll_load", { conversationId, assistantMessageId });
    void get()
      .loadConversation(conversationId, { silent: true })
      .finally(() => {
        if (!isActiveChatCurationContext(conversationId)) {
          finishPoll();
          return;
        }
        if (Date.now() - startedAt > PREVIEW_POLL_MAX_MS) {
          finishPoll();
          return;
        }
        const latest = get().messages.find((m) => m.id === assistantMessageId);
        if (
          !latest ||
          !messageExpectsOptionPreviews(latest.metadata) ||
          messageHasOptionPreviewImages(latest.metadata)
        ) {
          finishPoll();
          return;
        }
        window.setTimeout(poll, PREVIEW_POLL_MS);
      });
  };

  window.setTimeout(poll, PREVIEW_POLL_MS);
}

/** Stop curation polling when the user leaves chat (timers otherwise keep hitting the API). */
function isActiveChatCurationContext(conversationId: string): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  if (!isChatRoutePathname(path)) return false;
  if (path === NEW_CHAT_PATH) return true;
  return parseConversationIdFromPath(path) === conversationId;
}

/** Poll until detached curator patches land in DB (SSE may close before update). */
function scheduleCurationEnhancementPoll(args: {
  get: () => Pick<ChatState, "activeConversationId" | "messages" | "loadConversation">;
  conversationId: string | null;
  assistantMessageId: string | null;
}) {
  const { get, conversationId, assistantMessageId } = args;
  if (!conversationId || !assistantMessageId) return;

  const startedAt = Date.now();

  const poll = () => {
    if (Date.now() - startedAt > CURATION_POLL_MAX_MS) return;
    if (!isActiveChatCurationContext(conversationId)) return;
    const s = get();
    if (s.activeConversationId !== conversationId) return;

    const msg = s.messages.find((m) => m.id === assistantMessageId);
    const stillAwaiting = msg ? messageNeedsCurationEnhancement(msg.metadata) : false;
    if (!stillAwaiting) return;

    void get()
      .loadConversation(conversationId, { silent: true })
      .finally(() => {
        if (!isActiveChatCurationContext(conversationId)) return;
        window.setTimeout(poll, CURATION_POLL_MS);
      });
  };

  window.setTimeout(poll, CURATION_POLL_MS);
}

function isMessageClarificationV1(v: unknown): v is MessageClarificationV1 {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.version === 1 && Array.isArray(o.questions);
}

function applyClarificationToMessage(
  messages: ChatMessage[],
  messageId: string,
  clarification: MessageClarificationV1,
  streamingAssistantMessageId: string | null = null,
): ChatMessage[] {
  const targetId = resolveAssistantMessageId(
    messages,
    messageId,
    streamingAssistantMessageId,
  );
  return messages.map((m) =>
    m.id === targetId
      ? {
          ...m,
          metadata: { ...(m.metadata ?? {}), clarification },
        }
      : m,
  );
}

function isMessageGiftDirectionsV1(v: unknown): v is MessageGiftDirectionsV1 {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.version === 1 && Array.isArray(o.directions);
}

function applyGiftDirectionsToMessage(
  messages: ChatMessage[],
  messageId: string,
  giftDirections: MessageGiftDirectionsV1,
  streamingAssistantMessageId: string | null = null,
): ChatMessage[] {
  const targetId = resolveAssistantMessageId(
    messages,
    messageId,
    streamingAssistantMessageId,
  );
  return messages.map((m) =>
    m.id === targetId
      ? {
          ...m,
          metadata: { ...(m.metadata ?? {}), giftDirections },
        }
      : m,
  );
}

function applyOptionPreviewsToMessage(
  messages: ChatMessage[],
  messageId: string,
  previews: Array<{ optionId: string; images: ClarificationOptionPreviewImage[] }>,
  streamingAssistantMessageId: string | null = null,
): ChatMessage[] {
  const targetId = resolveAssistantMessageId(
    messages,
    messageId,
    streamingAssistantMessageId,
  );
  return messages.map((m) => {
    if (m.id !== targetId) return m;
    const meta = m.metadata ?? {};
    const previewMap: Record<string, ClarificationOptionPreviewImage[]> = {};
    for (const row of previews) {
      if (row.images?.length) previewMap[row.optionId] = row.images;
    }

    let nextMeta = meta;
    if (meta.clarification) {
      nextMeta = {
        ...nextMeta,
        clarification: mergeOptionPreviewsIntoClarification(
          meta.clarification,
          previewMap,
        ),
      };
    }
    if (meta.giftDirections) {
      nextMeta = {
        ...nextMeta,
        giftDirections: mergeOptionPreviewsIntoGiftDirections(
          meta.giftDirections,
          previewMap,
        ),
      };
    }
    if (meta.fashionRouter) {
      nextMeta = {
        ...nextMeta,
        fashionRouter: mergeOptionPreviewsIntoFashionRouter(
          meta.fashionRouter,
          previewMap,
        ),
      };
    }
    return { ...m, metadata: nextMeta };
  });
}

function applyFashionCatalogSearch(
  messages: ChatMessage[],
  messageId: string,
  catalogSearch: MessageFashionCatalogSearchMetaV1,
): ChatMessage[] {
  return messages.map((m) => {
    if (m.id !== messageId) return m;
    return {
      ...m,
      metadata: {
        ...(m.metadata ?? {}),
        fashionCatalogSearch: catalogSearch,
      },
    };
  });
}

function isMessageFashionCatalogSearchV1(
  v: unknown,
): v is MessageFashionCatalogSearchMetaV1 {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.version === 1 && Array.isArray(o.slots);
}

function fashionCatalogHasResults(
  catalogSearch: MessageFashionCatalogSearchMetaV1 | undefined,
): boolean {
  return Boolean(
    catalogSearch?.curation ||
      catalogSearch?.render ||
      catalogSearch?.slots?.some((slot) => (slot.verified_pool?.length ?? 0) > 0),
  );
}

/** Append a product-search invocation to the streaming assistant's metadata. */
function applyProductSearchInvocation(
  messages: ChatMessage[],
  messageId: string,
  invocation: ProductSearchInvocation,
): ChatMessage[] {
  return messages.map((m) => {
    if (m.id !== messageId) return m;
    const meta: MessageMetadata = m.metadata ?? {};
    const prev = meta.productSearch;
    const nextSearches = prev?.searches
      ? [...prev.searches, invocation]
      : [invocation];
    return {
      ...m,
      metadata: {
        ...meta,
        productSearch: { version: 1, searches: nextSearches },
      },
    };
  });
}

function isProductSearchInvocation(v: unknown): v is ProductSearchInvocation {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.query !== "string") return false;
  if (!Array.isArray(o.products)) return false;
  return true;
}

type ProductSearchUpdatePayload = {
  searchKey: string;
  curatedPicks: CuratedPick[];
  curationFallback?: boolean;
  curationPending?: boolean;
  products?: ProductCard[];
};

function isProductSearchUpdate(v: unknown): v is ProductSearchUpdatePayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.searchKey !== "string") return false;
  if (!Array.isArray(o.curatedPicks)) return false;
  return true;
}

/** Merge a curator update into the matching invocation by `searchKey`. */
function applyProductSearchUpdate(
  messages: ChatMessage[],
  messageId: string,
  update: ProductSearchUpdatePayload,
): ChatMessage[] {
  return messages.map((m) => {
    if (m.id !== messageId) return m;
    const meta: MessageMetadata = m.metadata ?? {};
    const prev = meta.productSearch;
    if (!prev?.searches?.length) return m;
    let touched = false;
    const nextSearches = prev.searches.map((inv) => {
      if (inv.searchKey !== update.searchKey) return inv;
      touched = true;
      const keepExisting =
        (inv.curatedPicks?.length ?? 0) > 0 &&
        inv.curationFallback === false &&
        update.curationFallback === true &&
        inv.curationPending !== true;
      if (keepExisting) return inv;
      return {
        ...inv,
        curatedPicks: update.curatedPicks,
        curationFallback: update.curationFallback ?? inv.curationFallback,
        curationPending: update.curationPending ?? false,
        products: update.products ?? inv.products,
      };
    });
    if (!touched) return m;
    return {
      ...m,
      metadata: {
        ...meta,
        productSearch: { version: 1, searches: nextSearches },
      },
    };
  });
}

function isShoppingModeMeta(v: unknown): v is ShoppingModeMetaV1 {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (!isShoppingMode(o.mode)) return false;
  if (o.source !== "user" && o.source !== "auto") return false;
  return true;
}

function scheduleAgentDebugRunsFetch(args: { conversationId: string | null }) {
  const debug = useAgentDebugStore.getState();
  if (!debug.enabled || !args.conversationId) return;
  debug.hydratePipelineFromCache(args.conversationId);
  window.setTimeout(() => {
    void debug.fetchRuns({ conversationId: args.conversationId });
  }, 600);
}

type StreamMode =
  | "send"
  | "edit"
  | "regenerate"
  | "clarificationSubmit"
  | "findSimilarSubmit";

export type SimilarPickSeed = {
  productId: string;
  title: string;
  upid?: string;
};

export type SimilarPickSelection = {
  sourceMessageId: string;
  picks: SimilarPickSeed[];
};

type ActiveStream = {
  id: string;
  /** Captured at start. After the `conversation` SSE event, may be filled in for new chats. */
  conversationId: string | null;
  abortController: AbortController;
  mode: StreamMode;
};

type ChatState = {
  navigate: NavigateFn | null;
  setNavigate: (fn: NavigateFn | null) => void;

  conversations: ConversationSummary[];
  sidebarNodes: SidebarConversationNode[];
  /** ISO timestamps — intent-events poll cursor per conversation. */
  intentPollSinceByConversation: Record<string, string>;
  messages: ChatMessage[];
  activeConversationId: string | null;
  conversationMeta: ConversationSummary | null;

  input: string;
  /** Product pick referenced by the next outgoing message (ChatGPT-style reply). */
  composerReplyContext: ComposerReplyContext | null;
  /** Multi-select find-similar picks pending submit (scoped to one search message). */
  similarPickSelection: SimilarPickSelection | null;
  /** When set during a stream, auto-sends after the current stream finishes. */
  queuedSendText: string | null;
  isStreaming: boolean;
  streamingAssistantMessageId: string | null;
  /** Buffer for incoming tokens; avoids rewriting `messages` every chunk (smooth scrolling like ChatGPT). */
  streamingDraft: string;
  /** Transient search-engine progress lines (narration_line) shown while streaming. */
  streamingNarration: string[];
  /** Fashion catalog pipeline active — show rack loader until results land. */
  streamingFashionPipeline: boolean;
  /** Preview thumbnails streamed during fashion catalog fan-out. */
  streamingFashionPreviewImages: string[];
  /** Hard-dropped product thumbnails for the loader discard strip. */
  streamingFashionDroppedImages: string[];
  activeStream: ActiveStream | null;
  error: string | null;
  loadingList: boolean;
  loadingMessages: boolean;
  savingConversationLocale: boolean;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  /** Bumped to move keyboard focus into the composer (new chat, etc.). */
  composerFocusNonce: number;
  /** Home category marquee selections (names from HOME_CATEGORIES). */
  selectedCategories: string[];
  /** Fashion mode — raw Shopify search path, no curation. */
  fashionMode: boolean;
  /**
   * Mid-session fashion quiz answers queued for the next sendMessage so the
   * assistant bubble can persist status=answered across refresh.
   */
  pendingFashionClarification: {
    messageId: string;
    answers: Record<
      string,
      | string
      | { selected: string[]; customText?: string }
    >;
  } | null;

  /** Monotonic tokens — discard stale `loadConversation` / `fetchList` resolutions. */
  _loadConvToken: number;
  _fetchListToken: number;

  setInput: (v: string) => void;
  replyToPick: (
    pick: CuratedPick | ProductCard,
    sourceMessageId: string,
    priceLabel?: string | null,
  ) => void;
  clearComposerReplyContext: () => void;
  toggleSimilarPick: (pick: SimilarPickSeed, sourceMessageId: string) => void;
  clearSimilarPickSelection: () => void;
  submitSimilarPickSelection: () => Promise<void>;
  toggleHomeCategory: (name: string) => void;
  removeHomeCategory: (name: string) => void;
  toggleFashionMode: () => void;
  /** Mark a fashion mid-session quiz answered (optimistic) and queue persistence. */
  answerFashionClarification: (
    messageId: string,
    answers: Record<
      string,
      | string
      | { selected: string[]; customText?: string }
    >,
  ) => void;
  requestComposerFocus: () => void;
  setSidebarOpen: (v: boolean) => void;
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebarCollapsed: () => void;

  syncRouteConversationId: (id: string | undefined) => void;

  fetchConversations: (opts?: { background?: boolean }) => Promise<void>;
  pollIntentBranches: (
    conversationId: string,
    opts?: { attempt?: number },
  ) => Promise<void>;
  loadConversation: (id: string, opts?: { silent?: boolean }) => Promise<void>;
  createConversationAndNavigate: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  updateConversationLocale: (
    conversationId: string,
    countryCode: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  updateConversationCurrency: (
    conversationId: string,
    currencyCode: string,
  ) => Promise<{ ok: boolean; error?: string }>;

  sendMessage: () => Promise<void>;
  stopGeneration: () => Promise<void>;
  regenerateAssistant: (assistantMessageId: string) => Promise<void>;
  editUserMessage: (messageId: string, content: string) => Promise<void>;

  submitClarification: (
    assistantMessageId: string,
    answers: Record<
      string,
      {
        optionIds?: string[];
        customText?: string;
        budgetMin?: number | null;
        budgetMax?: number | null;
        budgetAmount?: number;
        currency?: string;
      }
    >,
  ) => Promise<void>;
  skipClarification: (assistantMessageId: string) => Promise<void>;
  submitGiftDirections: (
    assistantMessageId: string,
    labels: string[],
  ) => Promise<void>;
  submitFindSimilar: (params: {
    sourceMessageId: string;
    seeds: FindSimilarSeed[];
    confirmedAttribute?: string;
    closeEmbeddedPdp?: () => void;
  }) => Promise<void>;
};

/** Magic string the gift-direction chips post back (mirrors server constant). */
const GIFT_DIRECTIONS_MESSAGE_PREFIX = "__gift_directions__:";

type StreamRunArgs = {
  mode: StreamMode;
  /** Captured at start so SSE handlers can guard against stale stores. */
  conversationId: string | null;
  /** Optimistic id of the placeholder assistant row in the UI. */
  optimisticAssistantId: string;
  /** Optimistic user message id, only used for `send` (which mints a fresh local id). */
  optimisticUserId?: string;
  /** Pending text shown in the local user bubble — restored on hard error. */
  pendingUserText?: string;
  /** Endpoint to POST to (always `/api/chat`). */
  url: string;
  /** Request body. */
  body: Record<string, unknown>;
};

export const useChatStore = create<ChatState>((set, get) => {
  /**
   * Apply a state update only if the stream is still the active one AND the user
   * has not navigated away from the stream's conversation. Returns true if applied.
   */
  function setIfActive(streamId: string, updater: (s: ChatState) => Partial<ChatState>): boolean {
    const stream = get().activeStream;
    if (!stream || stream.id !== streamId) return false;
    set(updater);
    return true;
  }

  /** Convenience: guard message-mutation by stream conversation (ignore writes if the user navigated away). */
  function setMessagesIfStillViewing(
    streamId: string,
    streamConvId: string | null,
    updater: (s: ChatState) => Partial<ChatState>,
  ): boolean {
    const s = get();
    if (s.activeStream?.id !== streamId) return false;
    // If the stream's conversation has been resolved, only mutate when the user
    // is still on it. Before that resolution (new chat first send), always allow.
    if (streamConvId && s.activeConversationId && s.activeConversationId !== streamConvId) {
      return false;
    }
    set(updater);
    return true;
  }

  /** Core streaming runner shared by send / edit / regenerate / clarification. */
  async function runStream(args: StreamRunArgs) {
    const ac = new AbortController();
    const streamId = crypto.randomUUID();
    const stream: ActiveStream = {
      id: streamId,
      conversationId: args.conversationId,
      abortController: ac,
      mode: args.mode,
    };

    set({
      isStreaming: true,
      error: null,
      activeStream: stream,
      streamingAssistantMessageId: args.optimisticAssistantId,
      streamingDraft: "",
      streamingNarration: [],
      streamingFashionPipeline: false,
      streamingFashionPreviewImages: [],
      streamingFashionDroppedImages: [],
    });

    if (useAgentDebugStore.getState().enabled) {
      useAgentDebugStore.getState().beginTurn({
        conversationId: args.conversationId,
        assistantMessageId: args.optimisticAssistantId,
      });
    }

    let resolvedUserMessageId: string | null = null;

    try {
      const res = await guestFetch(args.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.body),
        signal: ac.signal,
      });

      if (!res.ok) {
        throw new Error(await responseErrorMessage(res, "Request failed."));
      }

      let resolvedAssistantId: string | null = null;
      let resolvedConversationId: string | null = args.conversationId;
      let isFirstTurn = false;

      const errored = await consumeChatSseStream(res, {
        onConversation: (payload) => {
          const cid = payload.conversationId;
          resolvedConversationId = cid;
          stream.conversationId = cid;
          const profileLoc = useUserProfileStore.getState().catalogLocalization;
          const localeSummary: ConversationSummary = {
            ...createGuestConversationPlaceholder(cid),
            shippingCountry:
              payload.shippingCountry ?? profileLoc?.profileRaw ?? null,
            currency: payload.currency ?? profileLoc?.currency ?? null,
          };
          if (isGuestSessionActive()) {
            upsertGuestConversation(localeSummary);
          }
          // Snapshot *before* mutating so we know whether the user was still
          // on the new-chat screen (and therefore wants to be navigated).
          const prevActive = get().activeConversationId;
          setMessagesIfStillViewing(streamId, args.conversationId, (s) => ({
            activeConversationId: cid,
            conversationMeta: localeSummary,
            messages: s.messages.map((m) =>
              m.conversationId === LOCAL_CONV_PLACEHOLDER
                ? { ...m, conversationId: cid }
                : m,
            ),
          }));
          if (
            args.mode === "send" &&
            !args.conversationId &&
            get().activeStream?.id === streamId &&
            prevActive === null
          ) {
            get().navigate?.(conversationPath(cid));
          }
        },
        onUserMessage: (mid, payload) => {
          resolvedUserMessageId = mid;
          if (useAgentDebugStore.getState().enabled) {
            useAgentDebugStore.setState({ userMessageId: mid });
          }
          // For 'send' / 'clarificationSubmit', server emits a fresh id. For 'edit'
          // the id is the existing one and content was updated client-side already.
          const serverContent =
            typeof payload?.content === "string" ? payload.content : null;
          setMessagesIfStillViewing(streamId, resolvedConversationId, (s) => ({
            messages: s.messages.map((m) => {
              if (args.optimisticUserId && m.id === args.optimisticUserId) {
                return {
                  ...m,
                  id: mid,
                  conversationId: resolvedConversationId ?? m.conversationId,
                  // If the server sent canonical content (clarification summary,
                  // edit normalization), use it instead of the optimistic text.
                  ...(serverContent !== null ? { content: serverContent } : {}),
                };
              }
              if (serverContent !== null && m.id === mid) {
                return { ...m, content: serverContent };
              }
              return m;
            }),
          }));
        },
        onAssistantMessage: (mid) => {
          resolvedAssistantId = mid;
          setMessagesIfStillViewing(streamId, resolvedConversationId, (s) => ({
            streamingAssistantMessageId: mid,
            streamingDraft: "",
            messages: s.messages.map((m) =>
              m.id === args.optimisticAssistantId
                ? {
                    ...m,
                    id: mid,
                    conversationId: resolvedConversationId ?? m.conversationId,
                  }
                : m,
            ),
          }));
        },
        onTextDelta: (delta) => {
          setMessagesIfStillViewing(streamId, resolvedConversationId, (s) => ({
            streamingDraft: s.streamingDraft + delta,
          }));
        },
        onProductSearch: (payload) => {
          if (!isProductSearchInvocation(payload)) return;
          const mid = resolvedAssistantId ?? args.optimisticAssistantId;
          if (!mid) return;
          setMessagesIfStillViewing(streamId, resolvedConversationId, (s) => ({
            messages: applyProductSearchInvocation(s.messages, mid, payload),
          }));
        },
        onProductSearchUpdate: (payload) => {
          if (!isProductSearchUpdate(payload)) return;
          const mid = resolvedAssistantId ?? args.optimisticAssistantId;
          if (!mid) return;
          setMessagesIfStillViewing(streamId, resolvedConversationId, (s) => ({
            messages: applyProductSearchUpdate(s.messages, mid, payload),
          }));
        },
        onNarrationLine: (payload) => {
          const line = typeof payload.line === "string" ? payload.line : null;
          if (!get().isStreaming) return;
          const previewImages = Array.isArray(payload.previewImages)
            ? payload.previewImages.filter(
                (url): url is string =>
                  typeof url === "string" && url.length > 0,
              )
            : [];
          const droppedImages = Array.isArray(payload.droppedImages)
            ? payload.droppedImages.filter(
                (url): url is string =>
                  typeof url === "string" && url.length > 0,
              )
            : [];
          if (!line && previewImages.length === 0 && droppedImages.length === 0) {
            return;
          }
          set((s) => {
            // Once hard-drops start, previewImages are survivors — replace the pool
            // so dropped thumbs don't keep flipping on the rack.
            let mergedPreview: string[];
            if (droppedImages.length > 0 && previewImages.length > 0) {
              mergedPreview = [...previewImages];
            } else {
              mergedPreview = [...s.streamingFashionPreviewImages];
              for (const url of previewImages) {
                if (!mergedPreview.includes(url)) mergedPreview.push(url);
              }
            }
            const mergedDropped = [...s.streamingFashionDroppedImages];
            for (const url of droppedImages) {
              if (!mergedDropped.includes(url)) mergedDropped.push(url);
            }
            return {
              ...(line
                ? {
                    streamingNarration: [...s.streamingNarration, line].slice(
                      -6,
                    ),
                  }
                : {}),
              // Keep a wide pool so the rack can keep randomizing.
              streamingFashionPreviewImages: mergedPreview.slice(-24),
              streamingFashionDroppedImages: mergedDropped.slice(-16),
            };
          });
        },
        onAgentDebug: (payload) => {
          ingestAgentDebugFromSse(payload);
        },
        onModeResolved: (payload) => {
          if (!isShoppingModeMeta(payload)) return;
          const mid = resolvedAssistantId ?? args.optimisticAssistantId;
          if (!mid) return;
          setMessagesIfStillViewing(streamId, resolvedConversationId, (s) => ({
            messages: s.messages.map((m) =>
              m.id === mid
                ? {
                    ...m,
                    metadata: { ...(m.metadata ?? {}), shoppingMode: payload },
                  }
                : m,
            ),
          }));
        },
        onClarification: (payload) => {
          const mid =
            typeof payload.messageId === "string"
              ? payload.messageId
              : resolvedAssistantId ?? args.optimisticAssistantId;
          if (!mid || !isMessageClarificationV1(payload.clarification)) return;
          setMessagesIfStillViewing(streamId, resolvedConversationId, (s) => ({
            messages: applyClarificationToMessage(
              s.messages,
              mid,
              payload.clarification as MessageClarificationV1,
              s.streamingAssistantMessageId,
            ),
          }));
        },
        onGiftDirections: (payload) => {
          const mid =
            typeof payload.messageId === "string"
              ? payload.messageId
              : resolvedAssistantId ?? args.optimisticAssistantId;
          if (!mid || !isMessageGiftDirectionsV1(payload.giftDirections)) return;
          setMessagesIfStillViewing(streamId, resolvedConversationId, (s) => ({
            messages: applyGiftDirectionsToMessage(
              s.messages,
              mid,
              payload.giftDirections as MessageGiftDirectionsV1,
              s.streamingAssistantMessageId,
            ),
          }));
        },
        onFashionMemoryDelta: (payload) => {
          const guestId = getGuestSessionId();
          if (!guestId) return;
          if (payload.version !== 1) return;
          if (typeof payload.conversationId !== "string") return;
          if (typeof payload.triggerMessageId !== "string") return;
          scheduleIdleWork(() => {
            try {
              const userId = guestUserIdFromSessionId(guestId);
              const store = loadGuestFashionStore(guestId);
              applyFashionMemoryDelta({
                store,
                userId,
                delta: {
                  version: 1,
                  conversationId: payload.conversationId as string,
                  triggerMessageId: payload.triggerMessageId as string,
                  requestEvent:
                    payload.requestEvent &&
                    typeof payload.requestEvent === "object"
                      ? (payload.requestEvent as {
                          personId?: string;
                          attributes: RequestEventAttributes;
                        })
                      : undefined,
                  extractionOps: Array.isArray(payload.extractionOps)
                    ? (payload.extractionOps as FashionLlmOp[])
                    : undefined,
                },
              });
              saveGuestFashionSnapshot(store.snapshot);
            } catch (error) {
              console.error("[shoop] fashion guest memory delta failed", error);
            }
          });
        },
        onFashionMemorySnapshot: (payload) => {
          const guestId = getGuestSessionId();
          if (!guestId) return;
          if (payload.version !== 1) return;
          const snapshot = payload.snapshot;
          if (!snapshot || typeof snapshot !== "object") return;
          scheduleIdleWork(() => {
            try {
              saveGuestFashionSnapshot(snapshot as GuestFashionMemorySnapshot);
              window.dispatchEvent(new Event("shoop-guest-changed"));
            } catch (error) {
              console.error("[shoop] fashion guest memory snapshot failed", error);
            }
          });
        },
        onFashionRequestEvent: (payload) => {
          const guestId = getGuestSessionId();
          if (!guestId) return;
          if (payload.version !== 1) return;
          if (typeof payload.conversationId !== "string") return;
          if (typeof payload.query !== "string") return;
          scheduleIdleWork(() => {
            try {
              persistGuestFashionRequestEvent({
                guestId,
                conversationId: payload.conversationId as string,
                query: payload.query as string,
                attributes:
                  payload.attributes &&
                  typeof payload.attributes === "object"
                    ? (payload.attributes as RequestEventAttributes)
                    : undefined,
                personId:
                  typeof payload.recipientPersonId === "string"
                    ? payload.recipientPersonId
                    : undefined,
              });
            } catch (error) {
              console.error("[shoop] fashion guest request event failed", error);
            }
          });
        },
        onFashionPipeline: (payload) => {
          if (typeof payload.phase !== "string") return;
          if (payload.phase === "started") {
            setIfActive(streamId, () => ({
              streamingFashionPipeline: true,
              streamingFashionPreviewImages: [],
              streamingFashionDroppedImages: [],
            }));
          } else if (payload.phase === "complete") {
            setIfActive(streamId, () => ({
              streamingFashionPipeline: false,
            }));
          }
        },
        onFashionCatalogSearch: (payload) => {
          if (payload.version !== 1) return;
          const mid = resolvedAssistantId ?? args.optimisticAssistantId;
          if (!mid) return;
          if (!isMessageFashionCatalogSearchV1(payload.catalogSearch)) return;
          const catalogSearch = payload.catalogSearch;
          setMessagesIfStillViewing(streamId, resolvedConversationId, (s) => ({
            messages: applyFashionCatalogSearch(s.messages, mid, catalogSearch),
          }));
          if (fashionCatalogHasResults(catalogSearch)) {
            setIfActive(streamId, () => ({
              streamingFashionPipeline: false,
              streamingFashionPreviewImages: [],
              streamingFashionDroppedImages: [],
            }));
          }
        },
        onOptionPreviews: (payload) => {
          const mid =
            typeof payload.messageId === "string"
              ? payload.messageId
              : resolvedAssistantId ?? args.optimisticAssistantId;
          if (!mid || !Array.isArray(payload.previews)) return;
          const previews = payload.previews.filter(
            (
              row,
            ): row is {
              optionId: string;
              images: ClarificationOptionPreviewImage[];
            } =>
              Boolean(row) &&
              typeof row === "object" &&
              typeof (row as { optionId?: unknown }).optionId === "string" &&
              Array.isArray((row as { images?: unknown }).images),
          );
          if (!previews.length) return;
          logClientOptionPreview("sse_hydrate", {
            messageId: mid,
            previewCount: previews.length,
          });
          setMessagesIfStillViewing(streamId, resolvedConversationId, (s) => ({
            messages: applyOptionPreviewsToMessage(
              s.messages,
              mid,
              previews,
              s.streamingAssistantMessageId,
            ),
          }));
        },
        onDone: (payload) => {
          const mid =
            typeof payload.messageId === "string"
              ? payload.messageId
              : resolvedAssistantId;
          const status =
            typeof payload.status === "string" ? payload.status : "completed";
          const partial =
            typeof payload.partial === "string" ? payload.partial : null;
          const fullContent =
            typeof payload.content === "string" ? payload.content : null;
          // `metadata` may be `null` (server clears) or an object (server sets).
          // Treat absent key as "leave untouched" so we don't wipe optimistic state.
          const metadata =
            "metadata" in payload
              ? (payload.metadata as ChatMessage["metadata"] | null)
              : undefined;
          const streamError =
            typeof payload.error === "string" ? payload.error : undefined;
          if (typeof payload.isFirstTurn === "boolean") {
            isFirstTurn = payload.isFirstTurn;
          }
          if (!mid) return;
          setMessagesIfStillViewing(streamId, resolvedConversationId, (s) => ({
            streamingNarration: [],
            streamingFashionPipeline: false,
            streamingFashionPreviewImages: [],
            streamingFashionDroppedImages: [],
            messages: applyAssistantStreamDone(
              s.messages,
              mid,
              fullContent ?? partial ?? s.streamingDraft,
              status as ChatMessage["status"],
              metadata,
              s.streamingAssistantMessageId,
              streamError,
            ),
          }));
          scheduleAgentDebugRunsFetch({
            conversationId: resolvedConversationId,
          });
        },
        onError: (msg) => {
          setIfActive(streamId, () => ({ error: msg }));
        },
      });

      if (errored) throw new Error("Something went wrong. Retry.");

      scheduleCurationEnhancementPoll({
        get,
        conversationId: resolvedConversationId,
        assistantMessageId: resolvedAssistantId ?? args.optimisticAssistantId,
      });

      scheduleOptionPreviewPoll({
        get,
        conversationId: resolvedConversationId,
        assistantMessageId: resolvedAssistantId ?? args.optimisticAssistantId,
      });

      if (resolvedConversationId) {
        window.setTimeout(() => {
          const s = get();
          if (s.activeConversationId !== resolvedConversationId) return;
          const aid = resolvedAssistantId ?? args.optimisticAssistantId;
          const msg =
            s.messages.find((m) => m.id === aid) ??
            [...s.messages]
              .reverse()
              .find(
                (m) =>
                  m.role === "assistant" &&
                  messageExpectsOptionPreviews(m.metadata),
              );
          if (
            msg &&
            messageExpectsOptionPreviews(msg.metadata) &&
            !messageHasOptionPreviewImages(msg.metadata)
          ) {
            logClientOptionPreview("post_stream_reload", {
              conversationId: resolvedConversationId,
              messageId: msg.id,
            });
            void get().loadConversation(resolvedConversationId!, {
              silent: true,
            });
          }
        }, 600);
      }

      if (resolvedConversationId) {
        const titleRefreshMs = isFirstTurn ? 2500 : 0;
        if (titleRefreshMs > 0) {
          window.setTimeout(() => {
            void get().fetchConversations({ background: true });
          }, titleRefreshMs);
        }
        // After deferred server-side intent worker (~4s); allow Haiku + DB headroom.
        window.setTimeout(() => {
          void get().fetchConversations({ background: true });
          void get().pollIntentBranches(resolvedConversationId!);
        }, 6000);
      }

      persistGuestChatState(get());
    } catch (e) {
      const aborted = ac.signal.aborted;
      if (!aborted) {
        const isStill = get().activeStream?.id === streamId;
        if (isStill) {
          set({
            error:
              e instanceof Error ? e.message : "Something went wrong. Retry.",
            // Restore typed text only for `send` so the user can retry; other modes
            // already have the content elsewhere (edit field, clarification chips).
            ...(args.mode === "send" && args.pendingUserText
              ? { input: args.pendingUserText }
              : {}),
          });
          // Drop any optimistic placeholders for this failed turn so the UI
          // doesn't permanently show a half-baked "Generating…" bubble.
          set((s) => ({
            messages: s.messages.filter(
              (m) =>
                m.id !== args.optimisticAssistantId &&
                m.id !== args.optimisticUserId,
            ),
          }));
          // If we already had a real conversation, silently resync with server
          // truth so partial mutations (edit truncate, clarification update)
          // don't leave the UI inconsistent.
          const cid = stream.conversationId;
          if (cid) {
            void get().loadConversation(cid, { silent: true }).catch(() => {});
          }
        }
      }
    } finally {
      // Only clear if WE are still the active stream — a newer stream may have started.
      if (get().activeStream?.id === streamId) {
        set({
          isStreaming: false,
          activeStream: null,
          streamingAssistantMessageId: null,
          streamingDraft: "",
          streamingNarration: [],
          streamingFashionPipeline: false,
          streamingFashionPreviewImages: [],
          streamingFashionDroppedImages: [],
        });

        // Auto-send a message queued during streaming.
        const queued = get().queuedSendText;
        if (queued && queued.trim()) {
          set({ queuedSendText: null, input: queued });
          // Schedule a microtask so React commits the cleared state first.
          queueMicrotask(() => void get().sendMessage());
        } else if (queued) {
          set({ queuedSendText: null });
        }

        // Guest fashion extraction — after stream teardown, never on the SSE hot path.
        if (args.mode === "send" && get().fashionMode) {
          const convId = stream.conversationId ?? args.conversationId;
          const guestId = getGuestSessionId();
          if (guestId && convId) {
            scheduleGuestFashionExtraction({
              guestId,
              conversationId: convId,
              messages: get().messages,
            });
          }
        }
      }
    }
  }

  return {
    navigate: null,
    setNavigate: (fn) => set({ navigate: fn }),

    conversations: [],
    sidebarNodes: [],
    intentPollSinceByConversation: {},
    messages: [],
    activeConversationId: null,
    conversationMeta: null,

    input: "",
    composerReplyContext: null,
    similarPickSelection: null,
    queuedSendText: null,
    isStreaming: false,
    streamingAssistantMessageId: null,
    streamingDraft: "",
    streamingNarration: [],
    streamingFashionPipeline: false,
    streamingFashionPreviewImages: [],
    streamingFashionDroppedImages: [],
    activeStream: null,
    error: null,
    loadingList: false,
    loadingMessages: false,
    savingConversationLocale: false,
    sidebarOpen: false,
    sidebarCollapsed: false,
    composerFocusNonce: 0,
    selectedCategories: [],
    fashionMode: true,
    pendingFashionClarification: null,

    _loadConvToken: 0,
    _fetchListToken: 0,

    setInput: (v) => set({ input: v }),
    replyToPick: (pick, sourceMessageId, priceLabel) =>
      set({
        composerReplyContext: composerReplyFromPick(
          pick,
          sourceMessageId,
          priceLabel,
        ),
        composerFocusNonce: get().composerFocusNonce + 1,
      }),
    clearComposerReplyContext: () => set({ composerReplyContext: null }),
    toggleSimilarPick: (pick, sourceMessageId) =>
      set((s) => {
        const cur = s.similarPickSelection;
        if (!cur || cur.sourceMessageId !== sourceMessageId) {
          return {
            similarPickSelection: {
              sourceMessageId,
              picks: [pick],
            },
          };
        }
        const idx = cur.picks.findIndex((p) => p.productId === pick.productId);
        if (idx >= 0) {
          const picks = cur.picks.filter((_, i) => i !== idx);
          return {
            similarPickSelection: picks.length
              ? { ...cur, picks }
              : null,
          };
        }
        if (cur.picks.length >= MAX_FIND_SIMILAR_SEEDS) return s;
        return {
          similarPickSelection: {
            ...cur,
            picks: [...cur.picks, pick],
          },
        };
      }),
    clearSimilarPickSelection: () => set({ similarPickSelection: null }),
    submitSimilarPickSelection: async () => {
      const sel = get().similarPickSelection;
      if (!sel?.picks.length || get().isStreaming) return;
      const seeds: FindSimilarSeed[] = sel.picks.map((p) => ({
        productId: p.productId,
        productTitle: p.title,
        upid: p.upid,
      }));
      set({ similarPickSelection: null });
      await get().submitFindSimilar({
        sourceMessageId: sel.sourceMessageId,
        seeds,
      });
    },
    toggleHomeCategory: (name) =>
      set((s) => ({
        selectedCategories: s.selectedCategories.includes(name)
          ? s.selectedCategories.filter((c) => c !== name)
          : [...s.selectedCategories, name],
      })),
    removeHomeCategory: (name) =>
      set((s) => ({
        selectedCategories: s.selectedCategories.filter((c) => c !== name),
      })),
    toggleFashionMode: () =>
      set((s) => ({ fashionMode: !s.fashionMode })),
    answerFashionClarification: (messageId, answers) => {
      set((s) => ({
        pendingFashionClarification: { messageId, answers },
        messages: s.messages.map((m) => {
          if (m.id !== messageId || !m.metadata?.fashionRouter) return m;
          const fashionRouter = m.metadata.fashionRouter;
          if (fashionRouter.move !== "ask_clarification") return m;
          return {
            ...m,
            metadata: {
              ...m.metadata,
              fashionRouter: {
                ...fashionRouter,
                status: "answered" as const,
                answers,
              },
            },
          };
        }),
      }));
      persistGuestChatState(get());
    },
    requestComposerFocus: () =>
      set((s) => ({ composerFocusNonce: s.composerFocusNonce + 1 })),
    setSidebarOpen: (v) => {
      if (v) {
        useCartStore.getState().setDrawerOpen(false);
      }
      set({ sidebarOpen: v });
    },
    setSidebarCollapsed: (v) => {
      if (!v) {
        useCartStore.getState().setDrawerOpen(false);
      }
      set({ sidebarCollapsed: v });
    },
    toggleSidebarCollapsed: () => {
      get().setSidebarCollapsed(!get().sidebarCollapsed);
    },

    syncRouteConversationId: (id) => {
      const accessMode = useAppSessionStore.getState().mode;
      // Wait for AuthGate / identity resync — loading is not a definitive access denial.
      if (accessMode === "loading") return;
      if (id && accessMode === "anonymous") {
        leaveConversationRoute();
        return;
      }

      const state = get();
      const prev = state.activeConversationId;
      if (id === undefined && prev === null) return;
      if (prev === id) {
        if (
          id &&
          state.messages.some(
            (m) =>
              m.role === "assistant" &&
              messageNeedsCurationEnhancement(m.metadata),
          )
        ) {
          void get().loadConversation(id, { silent: true });
        }
        return;
      }

      set({ activeConversationId: id ?? null });

      if (!id) {
        set({
          messages: [],
          conversationMeta: null,
          loadingMessages: false,
          streamingDraft: "",
        });
        get().requestComposerFocus();
        return;
      }

      if (shouldPreserveInMemoryConversation(get(), id)) {
        return;
      }

      void get().loadConversation(id);
    },

    pollIntentBranches: async (conversationId, opts) => {
      const attempt = opts?.attempt ?? 0;
      const since =
        get().intentPollSinceByConversation[conversationId] ??
        new Date(Date.now() - 5 * 60_000).toISOString();
      logIntentBranch("client_poll_start", {
        conversationId,
        since,
        attempt,
      });
      try {
        const res = await guestFetch(
          `/api/conversations/${conversationId}/intent-events?since=${encodeURIComponent(since)}`,
        );
        if (!res.ok) {
          logIntentBranch("client_poll_http_error", {
            conversationId,
            status: res.status,
            attempt,
          });
          return;
        }
        const data = (await res.json()) as {
          branches?: ConversationBranchSummary[];
        };
        const branches = data.branches ?? [];

        logIntentBranch("client_poll_result", {
          conversationId,
          attempt,
          branchCount: branches.length,
          branches: branches.map((b) => ({
            id: b.id,
            index: b.index,
            title: b.title,
            sourceMessageId: b.sourceMessageId,
          })),
        });

        if (branches.length === 0) {
          if (
            attempt < 2 &&
            get().activeConversationId === conversationId
          ) {
            logIntentBranch("client_poll_retry", {
              conversationId,
              nextAttempt: attempt + 1,
              delayMs: 3500,
            });
            window.setTimeout(() => {
              void get().pollIntentBranches(conversationId, {
                attempt: attempt + 1,
              });
            }, 3500);
          }
          return;
        }

        const now = new Date().toISOString();
        set((s) => ({
          intentPollSinceByConversation: {
            ...s.intentPollSinceByConversation,
            [conversationId]: now,
          },
        }));

        const branchMap: Record<string, ConversationBranchSummary[]> = {};
        const existingGuestBranches = isGuestSessionActive()
          ? getGuestBranches(conversationId)
          : [];
        const nodeBranches =
          get().sidebarNodes.find((n) => n.conversation.id === conversationId)
            ?.branches ?? [];
        const mergedBranches = [...nodeBranches];
        for (const branch of [...existingGuestBranches, ...branches]) {
          if (mergedBranches.some((b) => b.id === branch.id)) continue;
          mergedBranches.push(branch);
        }
        mergedBranches.sort((a, b) => a.index - b.index);
        branchMap[conversationId] = mergedBranches;
        if (isGuestSessionActive()) {
          syncGuestBranchesToLocal(branchMap);
        }

        set((s) => {
          let nodes = s.sidebarNodes;
          for (const branch of branches) {
            const idx = nodes.findIndex(
              (n) => n.conversation.id === branch.conversationId,
            );
            if (idx === -1) continue;
            const node = nodes[idx]!;
            if (node.branches.some((b) => b.id === branch.id)) continue;
            const nextBranches = [...node.branches, branch].sort(
              (a, b) => a.index - b.index,
            );
            nodes = nodes.map((n, i) =>
              i === idx ? { ...n, branches: nextBranches } : n,
            );
          }
          const viewing =
            s.activeConversationId === conversationId && !s.isStreaming;
          const nextMessages = viewing
            ? applyIntentBranchSplitsToMessages(s.messages, branches)
            : s.messages;
          if (viewing) {
            logIntentBranch("client_apply_splits", {
              conversationId,
              branchCount: branches.length,
              messageCountBefore: s.messages.length,
              messageCountAfter: nextMessages.length,
              branchIds: branches.map((b) => b.id),
            });
          }
          return {
            sidebarNodes: nodes,
            conversations: sidebarNodesToConversations(nodes),
            ...(viewing ? { messages: nextMessages } : {}),
          };
        });

        if (
          get().activeConversationId === conversationId &&
          !get().isStreaming
        ) {
          void get().loadConversation(conversationId, { silent: true });
        }

        const showToast = useToastStore.getState().show;
        for (const branch of branches) {
          logIntentBranch("client_toast", {
            conversationId,
            branchId: branch.id,
            title: branch.title,
          });
          showToast({
            emoji: "↳",
            title: "New topic detected",
            body: `"${branch.title}" — added to this Shoop in the sidebar.`,
          });
        }
      } catch (error) {
        logIntentBranch("client_poll_error", {
          conversationId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    fetchConversations: async (opts) => {
      if (fetchConversationsInflight) {
        return fetchConversationsInflight;
      }

      fetchConversationsInflight = (async () => {
        const background = opts?.background ?? get().conversations.length > 0;
        const token = get()._fetchListToken + 1;
        if (!background) {
          set({ loadingList: true, error: null, _fetchListToken: token });
        } else {
          set({ _fetchListToken: token });
        }
        try {
          if (isGuestSessionActive()) {
            try {
              const res = await guestFetch("/api/conversations");
              if (!res.ok) throw new Error("list");
              const data = await res.json();
              if (get()._fetchListToken !== token) return;
              const nodes = parseSidebarNodes(data);
              set({
                sidebarNodes: nodes,
                conversations: sidebarNodesToConversations(nodes),
              });
              syncGuestConversationsToLocal(sidebarNodesToConversations(nodes));
              return;
            } catch {
              const data = loadGuestData();
              if (get()._fetchListToken !== token) return;
              const conversations = listVisibleGuestConversations(
                data?.conversations ?? [],
              );
              const nodes: SidebarConversationNode[] = conversations.map((c) => ({
                conversation: c,
                branches: (() => {
                  const all = data?.branchesByConversationId?.[c.id] ?? [];
                  return all.length > 1
                    ? all.filter((b) => b.anchorMessageId && b.index > 0)
                    : [];
                })(),
              }));
              set({ conversations, sidebarNodes: nodes });
              return;
            }
          }

          let res = await guestFetch("/api/conversations");
          // Auth cookie can lag the client session on hard refresh — retry once.
          if (res.status === 401) {
            await new Promise((r) => setTimeout(r, 350));
            if (get()._fetchListToken !== token) return;
            res = await guestFetch("/api/conversations");
          }
          if (!res.ok) {
            if (res.status === 401) return;
            throw new Error("list");
          }
          const data = await res.json();
          if (get()._fetchListToken !== token) return; // stale
          const nodes = parseSidebarNodes(data);
          set({
            sidebarNodes: nodes,
            conversations: sidebarNodesToConversations(nodes),
          });
        } catch {
          if (get()._fetchListToken === token && !background) {
            const mode = useAppSessionStore.getState().mode;
            if (mode === "authenticated" || mode === "guest") {
              set({ error: "Could not load conversations." });
            }
          }
        } finally {
          if (get()._fetchListToken === token && !background) {
            set({ loadingList: false });
          }
        }
      })().finally(() => {
        fetchConversationsInflight = null;
      });

      return fetchConversationsInflight;
    },

    loadConversation: async (id: string, opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      const state = get();

      if (
        !silent &&
        state.isStreaming &&
        state.activeConversationId === id &&
        state.messages.length > 0
      ) {
        return;
      }

      const token = state._loadConvToken + 1;
      set({
        _loadConvToken: token,
        ...(silent ? {} : { loadingMessages: true, error: null }),
      });
      try {
        const res = await guestFetch(`/api/conversations/${id}`);
        if (
          res.status === 404 ||
          res.status === 403 ||
          res.status === 401
        ) {
          if (get()._loadConvToken !== token) return;
          leaveConversationRoute();
          return;
        }
        if (!res.ok) throw new Error("load");
        const data = (await res.json()) as {
          conversation: ConversationSummary;
          messages: ChatMessage[];
          branches?: ConversationBranchSummary[];
        };
        if (get()._loadConvToken !== token) return;
        if (get().activeConversationId !== id) return;

        const live = get();
        const preserveStream =
          live.isStreaming &&
          live.activeConversationId === id &&
          live.messages.length > 0;

        const allBranches = data.branches ?? [];
        const visibleBranches =
          allBranches.length > 1
            ? allBranches.filter((b) => b.anchorMessageId && b.index > 0)
            : [];
        set((s) => {
          const nodes = s.sidebarNodes.map((n) =>
            n.conversation.id === id
              ? { ...n, branches: visibleBranches }
              : n,
          );
          const hasNode = nodes.some((n) => n.conversation.id === id);
          const sidebarNodes = hasNode
            ? nodes
            : [
                { conversation: data.conversation, branches: visibleBranches },
                ...nodes,
              ];
          return {
            conversationMeta: data.conversation,
            messages: preserveStream ? live.messages : data.messages,
            activeConversationId: id,
            composerReplyContext: preserveStream
              ? live.composerReplyContext
              : null,
            similarPickSelection: preserveStream
              ? live.similarPickSelection
              : null,
            streamingDraft: preserveStream ? live.streamingDraft : "",
            sidebarNodes,
            conversations: sidebarNodesToConversations(sidebarNodes),
          };
        });

        if (!preserveStream) {
          for (const msg of data.messages) {
            if (
              msg.role !== "assistant" ||
              !messageExpectsOptionPreviews(msg.metadata) ||
              messageHasOptionPreviewImages(msg.metadata)
            ) {
              continue;
            }
            scheduleOptionPreviewPoll({
              get,
              conversationId: id,
              assistantMessageId: msg.id,
            });
          }
        }
        if (isGuestSessionActive()) {
          upsertGuestConversation(data.conversation);
          if (visibleBranches.length) {
            syncGuestBranchesToLocal({ [id]: visibleBranches });
          }
          persistGuestChatState(get());
        }

        const sweepMessages = preserveStream ? live.messages : data.messages;
        const guestId = getGuestSessionId();
        if (guestId) {
          void spawnGuestFashionExtractionSweep({
            guestId,
            conversationId: id,
            messages: sweepMessages,
          });
        } else {
          scheduleIdleWork(() => {
            void guestFetch("/api/fashion-memory/sweep", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ conversationId: id, idle: true }),
            }).catch(() => undefined);
          });
        }
      } catch {
        if (get()._loadConvToken === token && isGuestSessionActive()) {
          const data = loadGuestData();
          const conversation =
            data?.conversations.find((c) => c.id === id) ?? null;
          if (conversation && !conversation.deletedAt) {
            if (get().activeConversationId !== id) return;
            set({
              conversationMeta: conversation,
              messages: data?.messagesByConversationId[id] ?? [],
              activeConversationId: id,
              streamingDraft: "",
            });
            return;
          }
        }
        if (get()._loadConvToken === token) {
          if (get().activeConversationId === id) {
            set({
              activeConversationId: null,
              messages: [],
              conversationMeta: null,
              streamingDraft: "",
            });
            get().navigate?.(NEW_CHAT_PATH);
          }
          set({ error: "Could not load messages." });
        }
      } finally {
        if (!silent && get()._loadConvToken === token) {
          set({ loadingMessages: false });
        }
      }
    },

    createConversationAndNavigate: async () => {
      set({ input: "", error: null });
      const pathname =
        typeof window !== "undefined" ? window.location.pathname : NEW_CHAT_PATH;
      const onEmptyHome =
        pathname === NEW_CHAT_PATH && get().activeConversationId === null;

      if (!onEmptyHome) {
        get().navigate?.(NEW_CHAT_PATH);
      } else {
        get().requestComposerFocus();
      }
      void get().fetchConversations();
    },

    deleteConversation: async (id: string) => {
      try {
        if (isGuestSessionActive()) {
          if (!softDeleteGuestConversation(id)) throw new Error("delete");
          const data = loadGuestData();
          const conversations = listVisibleGuestConversations(
            data?.conversations ?? [],
          );
          const nodes: SidebarConversationNode[] = conversations.map((c) => {
            const all = data?.branchesByConversationId?.[c.id] ?? [];
            return {
              conversation: c,
              branches:
                all.length > 1
                  ? all.filter((b) => b.anchorMessageId && b.index > 0)
                  : [],
            };
          });
          set({ conversations, sidebarNodes: nodes });
          if (get().activeConversationId === id) {
            set({
              activeConversationId: null,
              messages: [],
              conversationMeta: null,
              streamingDraft: "",
            });
            get().navigate?.(NEW_CHAT_PATH);
            get().requestComposerFocus();
          }
          return;
        }

        const res = await guestFetch(`/api/conversations/${id}`, {
          method: "DELETE",
        });
        if (!res.ok && res.status !== 204) throw new Error("delete");
        const nextNodes = get().sidebarNodes.filter((n) => n.conversation.id !== id);
        set({
          sidebarNodes: nextNodes,
          conversations: sidebarNodesToConversations(nextNodes),
        });
        if (get().activeConversationId === id) {
          set({
            activeConversationId: null,
            messages: [],
            conversationMeta: null,
            streamingDraft: "",
          });
          get().navigate?.(NEW_CHAT_PATH);
          get().requestComposerFocus();
        }
        void get().fetchConversations();
      } catch {
        set({ error: "Could not delete conversation." });
      }
    },

    updateConversationLocale: async (conversationId, countryCode) => {
      const country = SHOPIFY_COUNTRIES.find((c) => c.code === countryCode);
      if (!country) return { ok: false, error: "Invalid country" };

      const state = get();
      const meta =
        state.conversationMeta?.id === conversationId
          ? state.conversationMeta
          : state.sidebarNodes.find((n) => n.conversation.id === conversationId)
              ?.conversation;
      const previousCurrency = meta?.currency ?? null;
      const currencyHint = currencyHintForCountry(country.label);
      const optimistic: ConversationSummary = {
        ...(meta ?? createGuestConversationPlaceholder(conversationId)),
        shippingCountry: country.label,
        currency: previousCurrency?.trim()
          ? previousCurrency
          : currencyHint,
      };

      set({ savingConversationLocale: true });
      set((s) => ({
        conversationMeta:
          s.conversationMeta?.id === conversationId
            ? optimistic
            : s.conversationMeta,
        sidebarNodes: s.sidebarNodes.map((n) =>
          n.conversation.id === conversationId
            ? { ...n, conversation: optimistic }
            : n,
        ),
        conversations: sidebarNodesToConversations(
          s.sidebarNodes.map((n) =>
            n.conversation.id === conversationId
              ? { ...n, conversation: optimistic }
              : n,
          ),
        ),
      }));

      try {
        const body: Record<string, string> = { shippingCountry: country.label };
        if (!previousCurrency?.trim() && currencyHint) {
          body.currency = currencyHint;
        }
        const res = await guestFetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          if (meta) {
            set((s) => ({
              conversationMeta:
                s.conversationMeta?.id === conversationId ? meta : s.conversationMeta,
              sidebarNodes: s.sidebarNodes.map((n) =>
                n.conversation.id === conversationId
                  ? { ...n, conversation: meta }
                  : n,
              ),
              conversations: sidebarNodesToConversations(
                s.sidebarNodes.map((n) =>
                  n.conversation.id === conversationId
                    ? { ...n, conversation: meta }
                    : n,
                ),
              ),
            }));
          }
          return { ok: false, error: "Could not save region for this chat" };
        }
        const updated = (await res.json()) as ConversationSummary;
        set((s) => {
          const sidebarNodes = s.sidebarNodes.map((n) =>
            n.conversation.id === conversationId
              ? { ...n, conversation: updated }
              : n,
          );
          return {
            conversationMeta:
              s.conversationMeta?.id === conversationId
                ? updated
                : s.conversationMeta,
            sidebarNodes,
            conversations: sidebarNodesToConversations(sidebarNodes),
          };
        });
        if (isGuestSessionActive()) {
          upsertGuestConversation(updated);
          persistGuestChatState(get());
        }
        return { ok: true };
      } catch {
        if (meta) {
          set((s) => ({
            conversationMeta:
              s.conversationMeta?.id === conversationId ? meta : s.conversationMeta,
          }));
        }
        return { ok: false, error: "Could not save region for this chat" };
      } finally {
        set({ savingConversationLocale: false });
      }
    },

    updateConversationCurrency: async (conversationId, currencyCode) => {
      const currency = currencyCode.trim().toUpperCase().slice(0, 6);
      if (!currency) return { ok: false, error: "Invalid currency" };

      const state = get();
      const meta =
        state.conversationMeta?.id === conversationId
          ? state.conversationMeta
          : state.sidebarNodes.find((n) => n.conversation.id === conversationId)
              ?.conversation;
      const optimistic: ConversationSummary = {
        ...(meta ?? createGuestConversationPlaceholder(conversationId)),
        currency,
      };

      set({ savingConversationLocale: true });
      set((s) => ({
        conversationMeta:
          s.conversationMeta?.id === conversationId
            ? optimistic
            : s.conversationMeta,
        sidebarNodes: s.sidebarNodes.map((n) =>
          n.conversation.id === conversationId
            ? { ...n, conversation: optimistic }
            : n,
        ),
        conversations: sidebarNodesToConversations(
          s.sidebarNodes.map((n) =>
            n.conversation.id === conversationId
              ? { ...n, conversation: optimistic }
              : n,
          ),
        ),
      }));

      try {
        const res = await guestFetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currency }),
        });
        if (!res.ok) {
          if (meta) {
            set((s) => ({
              conversationMeta:
                s.conversationMeta?.id === conversationId ? meta : s.conversationMeta,
              sidebarNodes: s.sidebarNodes.map((n) =>
                n.conversation.id === conversationId
                  ? { ...n, conversation: meta }
                  : n,
              ),
              conversations: sidebarNodesToConversations(
                s.sidebarNodes.map((n) =>
                  n.conversation.id === conversationId
                    ? { ...n, conversation: meta }
                    : n,
                ),
              ),
            }));
          }
          return { ok: false, error: "Could not save currency for this chat" };
        }
        const updated = (await res.json()) as ConversationSummary;
        set((s) => {
          const sidebarNodes = s.sidebarNodes.map((n) =>
            n.conversation.id === conversationId
              ? { ...n, conversation: updated }
              : n,
          );
          return {
            conversationMeta:
              s.conversationMeta?.id === conversationId
                ? updated
                : s.conversationMeta,
            sidebarNodes,
            conversations: sidebarNodesToConversations(sidebarNodes),
          };
        });
        if (isGuestSessionActive()) {
          upsertGuestConversation(updated);
          persistGuestChatState(get());
        }
        return { ok: true };
      } catch {
        if (meta) {
          set((s) => ({
            conversationMeta:
              s.conversationMeta?.id === conversationId ? meta : s.conversationMeta,
          }));
        }
        return { ok: false, error: "Could not save currency for this chat" };
      } finally {
        set({ savingConversationLocale: false });
      }
    },

    setArchived: async (id: string, archived: boolean) => {
      try {
        if (isGuestSessionActive()) {
          const data = loadGuestData();
          if (!data) throw new Error("archive");
          const conversations = data.conversations.map((c) =>
            c.id === id ? { ...c, archived } : c,
          );
          saveGuestData({ ...data, conversations });
          set({ conversations });
          if (get().activeConversationId === id) {
            await get().loadConversation(id, { silent: true });
          }
          return;
        }

        const res = await guestFetch(`/api/conversations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
        });
        if (!res.ok) throw new Error("archive");
        await get().fetchConversations();
        if (get().activeConversationId === id) {
          await get().loadConversation(id, { silent: true });
        }
      } catch {
        set({ error: "Could not update archive state." });
      }
    },

    sendMessage: async () => {
      const text = get().input.trim();
      if (!text) return;

      // Typing-while-streaming: queue the next send and let the current one finish.
      if (get().isStreaming) {
        set({ queuedSendText: text, input: "" });
        return;
      }

      const meta = get().conversationMeta;
      const conversationId = get().activeConversationId ?? undefined;
      const replyContext = get().composerReplyContext;
      const fashionMode = get().fashionMode;
      const guestId = isGuestSessionActive() ? getGuestSessionId() : null;
      const guestFashionMemory =
        fashionMode && guestId
          ? readGuestFashionMemoryForUser(guestId)
          : undefined;
      const pendingFashionClarification = get().pendingFashionClarification;

      const optimisticUserId = makeLocalUserId();
      const optimisticAssistantId = makeLocalAssistantId();
      const convPlace = conversationId ?? LOCAL_CONV_PLACEHOLDER;
      const ts = new Date().toISOString();

      set((s) => ({
        input: "",
        composerReplyContext: null,
        similarPickSelection: null,
        pendingFashionClarification: null,
        messages: [
          ...s.messages,
          {
            id: optimisticUserId,
            conversationId: convPlace,
            role: "user",
            content: text,
            status: "completed",
            createdAt: ts,
            updatedAt: ts,
            ...(replyContext
              ? { metadata: { composerReply: replyContext } }
              : {}),
          },
          {
            id: optimisticAssistantId,
            conversationId: convPlace,
            role: "assistant",
            content: "",
            status: "streaming",
            createdAt: ts,
            updatedAt: ts,
          },
        ],
      }));

      await runStream({
        mode: "send",
        conversationId: conversationId ?? null,
        optimisticAssistantId,
        optimisticUserId,
        pendingUserText: text,
        url: "/api/chat",
        body: {
          conversationId,
          mode: "send",
          message: text,
          replyContext: replyContext ?? undefined,
          settings: buildPayloadSettings(meta),
          ...(fashionMode
            ? {
                fashionMode: true,
                guestFashionMemory,
                ...(pendingFashionClarification
                  ? {
                      fashionClarificationMessageId:
                        pendingFashionClarification.messageId,
                      fashionClarificationAnswers:
                        pendingFashionClarification.answers,
                    }
                  : {}),
              }
            : {
                shoppingMode: "auto",
                selectedCategories:
                  get().selectedCategories.length > 0
                    ? get().selectedCategories
                    : undefined,
              }),
        },
      });
    },

    stopGeneration: async () => {
      const stream = get().activeStream;
      const assistantId = get().streamingAssistantMessageId;
      const draft = get().streamingDraft;

      stream?.abortController.abort();

      // Apply the partial content + 'stopped' status locally so the bubble
      // doesn't blank out when streamingDraft is cleared. The server has
      // already (or is about to) persist the same accumulated content.
      if (assistantId) {
        set((s) => ({
          messages: applyAssistantStreamDone(
            s.messages,
            assistantId,
            draft,
            "stopped",
          ),
        }));
      }

      // Note: we intentionally do NOT call /api/messages/:id PATCH here.
      // The server's stream handler writes status=stopped + content=accumulated
      // in its abort branch — duplicating that from the client introduces a
      // last-writer-wins race where the two contents disagree.

      // `runStream`'s finally will clear isStreaming/etc when it observes the
      // abort, so no extra cleanup needed here.
    },

    regenerateAssistant: async (assistantMessageId: string) => {
      if (get().isStreaming) return;

      const conversationId = get().activeConversationId;
      if (!conversationId) return;

      const meta = get().conversationMeta;
      const optimisticAssistantId = makeLocalAssistantId();
      const ts = new Date().toISOString();

      // Replace the existing assistant message in-place with a streaming placeholder.
      set((s) => ({
        messages: [
          ...s.messages.filter((m) => m.id !== assistantMessageId),
          {
            id: optimisticAssistantId,
            conversationId,
            role: "assistant",
            content: "",
            status: "streaming",
            createdAt: ts,
            updatedAt: ts,
          },
        ],
      }));

      await runStream({
        mode: "regenerate",
        conversationId,
        optimisticAssistantId,
        url: "/api/chat",
        body: {
          conversationId,
          mode: "regenerate",
          targetMessageId: assistantMessageId,
          settings: buildPayloadSettings(meta),
          shoppingMode: "auto",
        },
      });
    },

    editUserMessage: async (messageId: string, content: string) => {
      if (get().isStreaming) return;
      const cid = get().activeConversationId;
      if (!cid) return;

      const trimmed = content.trim();
      if (!trimmed) return;

      const meta = get().conversationMeta;
      const optimisticAssistantId = makeLocalAssistantId();
      const ts = new Date().toISOString();

      // Optimistic: drop everything after the edited message, update its content,
      // and append a streaming assistant placeholder.
      const idxNow = get().messages.findIndex((m) => m.id === messageId);
      if (idxNow === -1) {
        set({ error: "Could not find that message to edit." });
        return;
      }
      set((s) => {
        const idx = s.messages.findIndex((m) => m.id === messageId);
        if (idx === -1) return {};
        const keep = s.messages.slice(0, idx + 1).map((m) =>
          m.id === messageId ? { ...m, content: trimmed } : m,
        );
        return {
          messages: [
            ...keep,
            {
              id: optimisticAssistantId,
              conversationId: cid,
              role: "assistant",
              content: "",
              status: "streaming",
              createdAt: ts,
              updatedAt: ts,
            },
          ],
        };
      });

      await runStream({
        mode: "edit",
        conversationId: cid,
        optimisticAssistantId,
        url: "/api/chat",
        body: {
          conversationId: cid,
          mode: "edit",
          targetMessageId: messageId,
          message: trimmed,
          settings: buildPayloadSettings(meta),
          shoppingMode: "auto",
        },
      });
    },

    submitClarification: async (assistantMessageId, answers) => {
      if (get().isStreaming) return;
      const cid = get().activeConversationId;
      if (!cid) return;

      const assistantMsg = get().messages.find((m) => m.id === assistantMessageId);
      const tasteProbe = assistantMsg?.metadata?.similarTasteProbe;
      const similarAnswer = answers.similar_attr;
      if (tasteProbe && similarAnswer?.optionIds?.length) {
        const chipId = similarAnswer.optionIds[0];
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantMessageId &&
            m.metadata?.clarification?.status === "pending"
              ? {
                  ...m,
                  metadata: {
                    ...m.metadata,
                    clarification: {
                      ...m.metadata!.clarification!,
                      status: "answered" as const,
                      answers,
                    },
                  },
                }
              : m,
          ),
        }));
        if (chipId && chipId !== "just_similar") {
          const label =
            chipId === "material"
              ? "Material"
              : chipId === "color"
                ? "Color"
                : chipId === "shape"
                  ? "Shape"
                  : chipId;
          await get().submitFindSimilar({
            sourceMessageId: tasteProbe.sourceMessageId,
            seeds:
              tasteProbe.seeds?.length ?
                tasteProbe.seeds.map((s) => ({
                  productId: s.productId,
                  productTitle: s.productTitle,
                  upid: s.upid,
                }))
              : [
                  {
                    productId: tasteProbe.seedProductId,
                    productTitle: tasteProbe.seedTitle,
                    upid: tasteProbe.upid,
                  },
                ],
            confirmedAttribute: label,
          });
        }
        return;
      }

      const meta = get().conversationMeta;
      const optimisticAssistantId = makeLocalAssistantId();
      const optimisticUserId = makeLocalUserId();
      const ts = new Date().toISOString();

      // Optimistic answered state + user-summary message + streaming assistant
      // bubble. Marking the original quiz answered immediately closes the form
      // instead of leaving disabled controls visible while the assistant streams.
      // We let the server's actual content win via the user_message event payload,
      // but show *something* immediately so the UI never freezes after clicking Apply.
      set((s) => ({
        messages: [
          ...s.messages.map((m) =>
            m.id === assistantMessageId &&
            m.metadata?.clarification?.status === "pending"
              ? {
                  ...m,
                  metadata: {
                    ...m.metadata,
                    clarification: {
                      ...m.metadata.clarification,
                      status: "answered" as const,
                      answers,
                    },
                  },
                }
              : m,
          ),
          {
            id: optimisticUserId,
            conversationId: cid,
            role: "user",
            content: "Applying your selections…",
            status: "completed",
            createdAt: ts,
            updatedAt: ts,
          },
          {
            id: optimisticAssistantId,
            conversationId: cid,
            role: "assistant",
            content: "",
            status: "streaming",
            createdAt: ts,
            updatedAt: ts,
          },
        ],
      }));

      await runStream({
        mode: "clarificationSubmit",
        conversationId: cid,
        optimisticAssistantId,
        optimisticUserId,
        url: "/api/chat",
        body: {
          conversationId: cid,
          mode: "clarificationSubmit",
          targetMessageId: assistantMessageId,
          clarificationAnswers: answers,
          settings: buildPayloadSettings(meta),
          shoppingMode: "auto",
        },
      });
    },

    submitGiftDirections: async (assistantMessageId, labels) => {
      if (get().isStreaming) return;
      const cid = get().activeConversationId;
      if (!cid || !labels.length) return;

      const meta = get().conversationMeta;
      const optimisticAssistantId = makeLocalAssistantId();
      const optimisticUserId = makeLocalUserId();
      const ts = new Date().toISOString();
      const magicString = `${GIFT_DIRECTIONS_MESSAGE_PREFIX} ${labels.join(", ")}`;
      const optimisticUserText =
        labels.length === 1
          ? `Let's explore: ${labels[0]}`
          : `Let's explore: ${labels.join(", ")}`;

      set((s) => ({
        messages: [
          ...s.messages.map((m) =>
            m.id === assistantMessageId &&
            m.metadata?.giftDirections?.status === "pending"
              ? {
                  ...m,
                  metadata: {
                    ...m.metadata,
                    giftDirections: {
                      ...m.metadata.giftDirections,
                      status: "answered" as const,
                      selected: labels,
                    },
                  },
                }
              : m,
          ),
          {
            id: optimisticUserId,
            conversationId: cid,
            role: "user",
            content: optimisticUserText,
            status: "completed",
            createdAt: ts,
            updatedAt: ts,
          },
          {
            id: optimisticAssistantId,
            conversationId: cid,
            role: "assistant",
            content: "",
            status: "streaming",
            createdAt: ts,
            updatedAt: ts,
          },
        ],
      }));

      await runStream({
        mode: "send",
        conversationId: cid,
        optimisticAssistantId,
        optimisticUserId,
        pendingUserText: magicString,
        url: "/api/chat",
        body: {
          conversationId: cid,
          mode: "send",
          message: magicString,
          settings: buildPayloadSettings(meta),
          shoppingMode: "auto",
        },
      });
    },

    submitFindSimilar: async (params) => {
      if (get().isStreaming) return;
      const cid = get().activeConversationId;
      if (!cid || !params.seeds.length) return;

      params.closeEmbeddedPdp?.();
      set({ similarPickSelection: null });

      const meta = get().conversationMeta;
      const userText = formatFindSimilarUserText(params.seeds);
      const optimisticAssistantId = makeLocalAssistantId();
      const optimisticUserId = makeLocalUserId();
      const ts = new Date().toISOString();

      set((s) => ({
        messages: [
          ...s.messages,
          {
            id: optimisticUserId,
            conversationId: cid,
            role: "user",
            content: userText,
            status: "completed",
            createdAt: ts,
            updatedAt: ts,
          },
          {
            id: optimisticAssistantId,
            conversationId: cid,
            role: "assistant",
            content: "",
            status: "streaming",
            createdAt: ts,
            updatedAt: ts,
          },
        ],
      }));

      await runStream({
        mode: "findSimilarSubmit",
        conversationId: cid,
        optimisticAssistantId,
        optimisticUserId,
        pendingUserText: userText,
        url: "/api/chat",
        body: {
          conversationId: cid,
          mode: "findSimilarSubmit",
          findSimilar: {
            sourceMessageId: params.sourceMessageId,
            seeds: params.seeds,
            confirmedAttribute: params.confirmedAttribute,
          },
          settings: buildPayloadSettings(meta),
        },
      });
    },

    skipClarification: async (assistantMessageId) => {
      const cid = get().activeConversationId;
      if (!cid || get().isStreaming) return;
      try {
        const res = await guestFetch(`/api/messages/${assistantMessageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clarificationSkip: true }),
        });
        if (!res.ok) {
          throw new Error(await responseErrorMessage(res, "Could not skip."));
        }
        // Optimistic: mark the local message as skipped without a full reload.
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantMessageId &&
            m.metadata?.clarification?.status === "pending"
              ? {
                  ...m,
                  metadata: {
                    ...m.metadata,
                    clarification: {
                      ...m.metadata.clarification,
                      status: "skipped",
                    },
                  },
                }
              : m,
          ),
        }));
        persistGuestChatState(get());
      } catch (e) {
        set({
          error:
            e instanceof Error ? e.message : "Something went wrong. Retry.",
        });
      }
    },
  };
});

/** Flush in-memory guest chat into localStorage before account migration. */
export function flushGuestChatStateForMigration() {
  if (!isGuestSessionActive()) return;
  const { conversations, messages, activeConversationId } = useChatStore.getState();
  persistGuestChatState({ conversations, messages, activeConversationId });
}
