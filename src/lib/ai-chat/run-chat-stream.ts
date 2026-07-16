import { APIUserAbortError } from "@anthropic-ai/sdk/error";
import { clientErrorMessage } from "./client-error-message";
import type {
  ContentBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { prisma } from "./db";
import type {
  ConversationRecord,
  ConversationUpdateData,
  InputJsonValue,
} from "./prisma-types";
import { getAnthropicClient } from "./anthropic";
import { buildAnthropicContext } from "./context-builder";
import {
  AI_CHAT_DEFAULT_USER_ID,
  AI_CHAT_TOPIC_GUARD_MODEL,
  anthropicTemperatureForModel,
  isAllowedModel,
  MAX_OUTPUT_TOKENS_MAX,
  MAX_OUTPUT_TOKENS_MIN,
  SSE_HEARTBEAT_MS,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
} from "./constants";
import {
  deleteMessagesStrictlyAfter,
  ensureConversationForUser,
  kickConversationTitleRename,
  persistAssistantFinal,
  skipPendingClarificationsForConversation,
  touchConversationUpdatedAt,
} from "./chat-service";
import {
  anchorBootstrapBranchIfNeeded,
  getOrCreateActiveBranchId,
} from "./intent-branch/bootstrap";
import { spawnSearchIntentPipeline } from "./intent-branch/jobs";
import { searchMissionFromBrief } from "./intent-branch/search-mission";
import type { SearchMissionSnapshot } from "./intent-branch/search-mission";
import {
  enqueueShoppingMemoryJob,
  kickShoppingMemoryJobWorker,
} from "./shopping-memory/jobs";
import { processUserMessageShoppingMemory } from "./shopping-memory/pipeline";
import { kickConversationSummaryRefresh } from "./conversation-summary";
import { logAiChat } from "./observability";
import type { GuestFashionMemorySnapshot } from "@/lib/fashion-memory/local/store";
import {
  formatAnthropicMessageResult,
  formatPromptBundle,
} from "./prompt-run/format";
import { recordPromptRun } from "./prompt-run/record";
import type { z } from "zod";
import type {
  chatPostBodySchema,
  ChatStreamMode,
  settingsPayloadSchema,
} from "./validators";
import type {
  MessageClarificationV1,
  MessageGiftDirectionsV1,
  MessageMetadata,
  MessageProductSearchV1,
  ProductSearchInvocation,
  ShoppingModeMetaV1,
} from "./types";
import {
  collectPreviewRequests,
  clarificationExpectsOptionPreviews,
  ensureClarificationQuestions,
  formatClarificationUserSummary,
  mergeOptionPreviewsIntoClarification,
  normalizePatchAnswers,
  parseClarificationToolInput,
  productSearchClarificationTool,
  PRODUCT_SEARCH_CLARIFICATION_TOOL_NAME,
  validateClarificationSubmission,
} from "./search-clarification";
import { loadWarmSearchCandidates } from "./clarification-warm-start";
import { mergeOptionPreviewMetadata } from "./merge-option-preview-metadata";
import { runOptionPreviews } from "./schedule-option-previews";
import { getKnownClarificationAttributes } from "./shopping-memory/search-hints";
import { ensureBrandClarificationQuestion } from "./brand-clarification";
import {
  collectGiftDirectionPreviewRequests,
  expandGiftDirectionsUserText,
  mergeOptionPreviewsIntoGiftDirections,
  parseGiftDirectionsSelection,
  parseGiftDirectionsToolInput,
  proposeGiftDirectionsTool,
  PROPOSE_GIFT_DIRECTIONS_TOOL_NAME,
} from "./search/gift-directions";
import { genderScopeFromPresentation } from "./search/archetype";
import { buildEngineToolResultPayload, runSearchEngine } from "./search/engine";
import { isGiftArchetype } from "./search/portfolio";
import { enrichSearchBriefFromMemory } from "./search/brief-enrichment";
import { craftGiftDirectionsFromBrief } from "./search/craft-gift-directions";
import {
  giftSearchNeedsDirectionPicker,
  inferGiftDirectionLabelFromQuery,
} from "./search/gift-direction-gate";
import { recordSearchQueryYields } from "./search/telemetry";
import {
  loadExcludedKeysForConversation,
  loadFeedbackAvoidSet,
} from "./search/learning";
import {
  detectShoppingMode,
  isShoppingMode,
  productDisplayLimitForMode,
  type ShoppingMode,
  type ShoppingModeSelection,
} from "./shopping-mode";
import {
  briefFromSearchInput,
  emptyToolResultPayload,
  SHOPIFY_SEARCH_TOOL_NAME,
  shopifySearchTool,
  shopifySearchToolInputSchema,
} from "./shopify-search-tool";
import { persistCuratedPicks } from "./curation/curator";
import {
  loadUserOptionHints,
  type UserOptionHints,
} from "./curation/preferred-options";
import {
  loadBuyerCatalogContext,
  type BuyerCatalogContext,
} from "./shopping-memory/search-hints";
import { whatSizesAreNeeded } from "./shopping-memory/category-detector";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import { formatUserTurnWithReplyContext } from "./composer-reply-context";
import { createFindSimilarSseStream } from "./run-find-similar-stream";
import { createFashionChatSseStream } from "./run-fashion-chat-stream";
import { createTextDeltaCoalescer, formatSse, SSE_HEARTBEAT } from "./sse";
import {
  evaluateTopicGuard,
  formatTopicGuardClassifierPrompt,
  type TopicGuardEvaluation,
  toTopicGuardMetadata,
} from "./topic-guard";
import { isAgentDebugEnabled, pipelineDebugForPersist } from "./agent-debug";
import type { QueryPlannerRunDebug } from "./search/query-planner-debug";

/** Anthropic message turns we can build — string content (history) OR rich blocks (tool loop). */
type AnthropicTurn = {
  role: "user" | "assistant";
  content: string | ContentBlockParam[];
};

/** Cap for the tool-use loop so a misbehaving model can't burn budget forever. */
const MAX_TOOL_ITERATIONS = 3;

const CHAT_TOOLS: Tool[] = [
  productSearchClarificationTool,
  proposeGiftDirectionsTool,
  shopifySearchTool,
];

type ChatBody = z.infer<typeof chatPostBodySchema>;
type SettingsPayload = z.infer<typeof settingsPayloadSchema>;

function clampTokens(n: number | undefined, fallback: number) {
  const v = n ?? fallback;
  return Math.min(MAX_OUTPUT_TOKENS_MAX, Math.max(MAX_OUTPUT_TOKENS_MIN, v));
}

function clampTemperature(n: number | undefined, fallback: number) {
  const v = n ?? fallback;
  return Math.min(TEMPERATURE_MAX, Math.max(TEMPERATURE_MIN, v));
}

function conversationPatchFromSettings(
  s: SettingsPayload | undefined,
): ConversationUpdateData {
  if (!s) return {};
  const data: ConversationUpdateData = {};
  if (s.model !== undefined && isAllowedModel(s.model)) data.model = s.model;
  if (s.temperature !== undefined)
    data.temperature = clampTemperature(s.temperature, 0.7);
  if (s.maxTokens !== undefined)
    data.maxTokens = clampTokens(s.maxTokens, 4096);
  if (s.responseStyle !== undefined) data.responseStyle = s.responseStyle;
  if (s.systemPrompt !== undefined) data.systemPrompt = s.systemPrompt;
  return data;
}

function pushAgentDebug(
  push: (chunk: string) => void,
  event: {
    stage: string;
    label: string;
    conversationId?: string | null;
    userMessageId?: string | null;
    assistantMessageId?: string | null;
    data?: Record<string, unknown>;
  },
) {
  if (!isAgentDebugEnabled()) return;
  push(
    formatSse("agent_debug", {
      ts: Date.now(),
      stage: event.stage,
      label: event.label,
      conversationId: event.conversationId ?? null,
      userMessageId: event.userMessageId ?? null,
      assistantMessageId: event.assistantMessageId ?? null,
      data: event.data ?? null,
    }),
  );
}

function resolveMode(body: ChatBody): ChatStreamMode {
  return body.mode ?? "send";
}

/**
 * Pulls the most-recent persisted shopping mode for this conversation so
 * auto-detection has a soft anchor (so a one-word follow-up doesn't bounce
 * the user into a different mode mid-thread).
 */
async function fetchPreviousShoppingMode(
  conversationId: string,
): Promise<ShoppingMode | null> {
  const recent = await prisma.message.findFirst({
    where: {
      conversationId,
      role: "assistant",
      status: "completed",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { metadata: true },
  });
  const meta = recent?.metadata as MessageMetadata | null;
  const m = meta?.shoppingMode?.mode;
  return isShoppingMode(m) ? m : null;
}

type ResolvedShoppingMode = {
  meta: ShoppingModeMetaV1;
  /** Forwarded to context-builder for prompt injection. */
  mode: ShoppingMode;
};

async function resolveShoppingMode(params: {
  selection: ShoppingModeSelection | undefined;
  queryHint: string;
  conversationId: string;
}): Promise<ResolvedShoppingMode> {
  const sel = params.selection ?? "auto";
  if (sel !== "auto") {
    return {
      mode: sel,
      meta: {
        version: 1,
        mode: sel,
        source: "user",
      },
    };
  }
  const previousMode = await fetchPreviousShoppingMode(
    params.conversationId,
  ).catch(() => null);
  const detected = detectShoppingMode({
    query: params.queryHint,
    previousMode,
  });
  return {
    mode: detected.mode,
    meta: {
      version: 1,
      mode: detected.mode,
      source: "auto",
      reason: detected.reason,
      contextTag: detected.contextTag,
    },
  };
}

type PreparedPrompt = {
  /** Anthropic turns to send (excludes the new user content; we append it). */
  excludeMessageIds: string[];
  /** New user content to append to the context (not yet persisted or just persisted). */
  newUserText: string;
  /** Optional id to emit via SSE so the client can swap optimistic state. */
  userMessageEventId: string | null;
  /** True for 'edit': UI already shows the new content, but server emits an event so client confirms. */
  userMessageEdited: boolean;
  /** Hint for shopping-memory injection (top of the system prompt). */
  memoryQueryHint: string;
  /** When set, the memory pipeline will run after the stream completes. */
  pendingMemory: {
    userId: string;
    conversationId: string;
    messageId: string;
    text: string;
  } | null;
  activeBranchId: string;
};

/**
 * Enqueue the shopping-memory pipeline in durable storage, then kick the worker.
 *
 * Critical: this is not tied to the chat request signal. Once `done` is sent,
 * the browser usually closes the SSE request. Persisting the job first keeps
 * memory extraction recoverable even if the request process is torn down.
 */
function spawnDetachedMemoryPipeline(
  pending: NonNullable<PreparedPrompt["pendingMemory"]>,
) {
  void enqueueShoppingMemoryJob(pending)
    .then((enqueued) => {
      if (enqueued) {
        kickShoppingMemoryJobWorker();
        return;
      }

      // If the durable job table has not been pushed/generated yet, keep the
      // current behavior as a development fallback so memory still works.
      logAiChat("warn", "shopping_memory_job_unavailable_fallback", {
        conversationId: pending.conversationId,
        messageId: pending.messageId,
      });
      void processUserMessageShoppingMemory(pending).catch((error) => {
        logAiChat("error", "shopping_memory_fallback_failed", {
          conversationId: pending.conversationId,
          messageId: pending.messageId,
          error,
        });
      });
    })
    .catch((error) => {
      logAiChat("error", "shopping_memory_job_enqueue_failed", {
        conversationId: pending.conversationId,
        messageId: pending.messageId,
        error,
      });
    });
}

type RequiredSizeType = "shoe" | "top" | "bottom" | "ring";

const REQUIRED_SIZE_LABEL: Record<RequiredSizeType, string> = {
  shoe: "shoe size",
  top: "top / clothing size",
  bottom: "waist / bottom size",
  ring: "ring size",
};

/** True when the query already states a size, so the model embedded one. */
function queryMentionsAnySize(query: string): boolean {
  const t = query.toLowerCase();
  if (/\bsize\b/.test(t)) return true;
  if (/\b(eu|us|uk)\s?\d{1,2}(?:\.5)?\b/.test(t)) return true;
  if (/\b\d{1,2}(?:\.5)?\s?(eu|us|uk)\b/.test(t)) return true;
  if (/\bsize\s+(xxs|xs|s|m|l|xl|xxl|2xl|3xl)\b/.test(t)) return true;
  if (/\b(xxs|xs|xl|xxl|xxxl|2xl|3xl|4xl)\b/.test(t)) return true;
  return false;
}

function hasProfileSize(
  type: RequiredSizeType,
  hints: UserOptionHints,
): boolean {
  switch (type) {
    case "shoe":
      return (
        hints.shoeEU != null || hints.shoeUS != null || hints.shoeUK != null
      );
    case "top":
      return Boolean(hints.topUsualSize);
    case "bottom":
      return Boolean(hints.bottomUsualSize || hints.bottomWaist);
    case "ring":
      return Boolean(hints.ringSize);
  }
}

/**
 * Readiness gate: for a clearly sized category (shoes/apparel/rings), refuse to
 * search blind when we have NO size at all — not in the query, not in the
 * profile. Returns the missing size type so the model can ask first. This is
 * what stops Shoop from confidently picking something in the wrong size.
 */
function detectMissingRequiredSize(
  query: string,
  hints: UserOptionHints,
): RequiredSizeType | null {
  const needed = whatSizesAreNeeded(query);
  if (!needed.length) return null;
  // If the model already embedded any size in the query, trust it.
  if (queryMentionsAnySize(query)) return null;
  for (const type of needed) {
    if (!hasProfileSize(type, hints)) return type;
  }
  return null;
}

/**
 * Per-mode preparation. Performs the necessary DB mutations atomically and
 * returns enough info for the streaming layer to build the prompt and emit
 * the right SSE events. Designed to run in parallel with `buildAnthropicContext`.
 */
async function prepareModeMutation(params: {
  mode: ChatStreamMode;
  conv: ConversationRecord;
  userId: string;
  body: ChatBody;
  pushEvent: (chunk: string) => void;
}): Promise<PreparedPrompt> {
  const { mode, conv, userId, body, pushEvent } = params;

  switch (mode) {
    case "send": {
      const rawText = body.message!.trim();
      // Gift-direction selections come back as a `__gift_directions__:` magic
      // string. Expand them into a natural directed-search instruction so the
      // chat reads cleanly and the model fans out one search per direction.
      const giftDirectionLabels = parseGiftDirectionsSelection(rawText);
      const text = giftDirectionLabels
        ? expandGiftDirectionsUserText(giftDirectionLabels)
        : rawText;
      const [, activeBranchId] = await Promise.all([
        skipPendingClarificationsForConversation(conv.id),
        getOrCreateActiveBranchId(conv.id, conv.title),
      ]);
      const userRow = await prisma.message.create({
        data: {
          conversationId: conv.id,
          role: "user",
          content: text,
          status: "completed",
          branchId: activeBranchId,
          ...(body.replyContext
            ? {
                metadata: {
                  composerReply: body.replyContext,
                } satisfies MessageMetadata,
              }
            : {}),
        },
      });
      void anchorBootstrapBranchIfNeeded(conv.id, userRow.id);
      pushEvent(formatSse("user_message", { messageId: userRow.id }));
      return {
        excludeMessageIds: [],
        newUserText: text,
        userMessageEventId: userRow.id,
        userMessageEdited: false,
        memoryQueryHint: text,
        pendingMemory: {
          userId,
          conversationId: conv.id,
          messageId: userRow.id,
          text,
        },
        activeBranchId,
      };
    }

    case "edit": {
      const targetId = body.targetMessageId!;
      const newText = body.message!.trim();

      const target = await prisma.message.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          role: true,
          conversationId: true,
          content: true,
          branchId: true,
        },
      });
      if (
        !target ||
        target.conversationId !== conv.id ||
        target.role !== "user"
      ) {
        throw new Error("Target message is not an editable user message.");
      }

      const latestUser = await prisma.message.findFirst({
        where: { conversationId: conv.id, role: "user" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      if (latestUser?.id !== target.id) {
        throw new Error("Only the latest user message can be edited.");
      }

      await prisma.$transaction([
        prisma.messageVersion.create({
          data: { messageId: target.id, content: target.content },
        }),
        prisma.message.update({
          where: { id: target.id },
          data: { content: newText, status: "completed" },
        }),
      ]);
      await deleteMessagesStrictlyAfter(conv.id, target.id);

      const activeBranchId =
        target.branchId ??
        (await getOrCreateActiveBranchId(conv.id, conv.title));

      pushEvent(
        formatSse("user_message", {
          messageId: target.id,
          edited: true,
          content: newText,
        }),
      );

      return {
        // The target row may show up in the message.findMany; we'll inject the
        // new text explicitly via `newUserText`, so exclude it from the prompt
        // history to avoid duplication.
        excludeMessageIds: [target.id],
        newUserText: newText,
        userMessageEventId: target.id,
        userMessageEdited: true,
        memoryQueryHint: newText,
        pendingMemory: {
          userId,
          conversationId: conv.id,
          messageId: target.id,
          text: newText,
        },
        activeBranchId,
      };
    }

    case "regenerate": {
      const targetId = body.targetMessageId!;
      const target = await prisma.message.findUnique({
        where: { id: targetId },
        select: { id: true, role: true, conversationId: true },
      });
      if (
        !target ||
        target.conversationId !== conv.id ||
        target.role !== "assistant"
      ) {
        throw new Error(
          "Target message is not a regenerable assistant message.",
        );
      }

      const newest = await prisma.message.findMany({
        where: { conversationId: conv.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true },
      });
      if (newest[0]?.id !== target.id) {
        throw new Error("Only the latest assistant reply can be regenerated.");
      }

      await prisma.message.delete({ where: { id: target.id } });

      // Find the latest user message to use as memory hint.
      const latestUser = await prisma.message.findFirst({
        where: { conversationId: conv.id, role: "user", status: "completed" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { content: true, branchId: true },
      });

      const activeBranchId =
        latestUser?.branchId ??
        (await getOrCreateActiveBranchId(conv.id, conv.title));

      return {
        excludeMessageIds: [],
        newUserText: "", // No new user text; assistant regenerates against existing history.
        userMessageEventId: null,
        userMessageEdited: false,
        memoryQueryHint: latestUser?.content ?? "",
        pendingMemory: null,
        activeBranchId,
      };
    }

    case "clarificationSubmit": {
      const targetId = body.targetMessageId!;
      const target = await prisma.message.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          role: true,
          conversationId: true,
          metadata: true,
        },
      });
      if (
        !target ||
        target.conversationId !== conv.id ||
        target.role !== "assistant"
      ) {
        throw new Error("Clarification target is not an assistant message.");
      }

      const meta = target.metadata as MessageMetadata | null;
      const clar = meta?.clarification;
      if (!clar || clar.status !== "pending") {
        throw new Error("No pending clarification on the target message.");
      }

      const answers = normalizePatchAnswers(body.clarificationAnswers ?? {});
      const checked = validateClarificationSubmission({
        questions: clar.questions,
        answers,
      });
      if (!checked.ok) throw new Error(checked.error);

      const userText = formatClarificationUserSummary(clar.questions, answers);

      const activeBranchId = await getOrCreateActiveBranchId(
        conv.id,
        conv.title,
      );

      const [, userRow] = await prisma.$transaction([
        prisma.message.update({
          where: { id: target.id },
          data: {
            metadata: {
              ...meta,
              clarification: { ...clar, status: "answered", answers },
            } as InputJsonValue,
          },
        }),
        prisma.message.create({
          data: {
            conversationId: conv.id,
            role: "user",
            content: userText,
            status: "completed",
            branchId: activeBranchId,
          },
        }),
      ]);

      void anchorBootstrapBranchIfNeeded(conv.id, userRow.id);

      pushEvent(
        formatSse("user_message", {
          messageId: userRow.id,
          content: userText,
        }),
      );

      return {
        excludeMessageIds: [],
        newUserText: userText,
        userMessageEventId: userRow.id,
        userMessageEdited: false,
        memoryQueryHint: userText,
        pendingMemory: {
          userId,
          conversationId: conv.id,
          messageId: userRow.id,
          text: userText,
        },
        activeBranchId,
      };
    }

    case "findSimilarSubmit": {
      throw new Error(
        "findSimilarSubmit is handled by createFindSimilarSseStream.",
      );
    }

    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unsupported chat stream mode: ${String(_exhaustive)}`);
    }
  }
}

export function createChatSseStream(params: {
  body: ChatBody;
  signal: AbortSignal;
  userId?: string;
  qaFaultsHeader?: string | null;
}): ReadableStream<Uint8Array> {
  const mode = resolveMode(params.body);
  if (mode === "findSimilarSubmit") {
    return createFindSimilarSseStream({
      body: params.body,
      signal: params.signal,
      userId: params.userId ?? AI_CHAT_DEFAULT_USER_ID,
    });
  }
  if (mode === "send" && params.body.fashionMode === true) {
    return createFashionChatSseStream({
      body: {
        conversationId: params.body.conversationId,
        message: params.body.message?.trim() ?? "",
        guestFashionMemory: params.body.guestFashionMemory as
          | GuestFashionMemorySnapshot
          | undefined,
      },
      signal: params.signal,
      userId: params.userId ?? AI_CHAT_DEFAULT_USER_ID,
      qaFaultsHeader: params.qaFaultsHeader,
    });
  }

  const encoder = new TextEncoder();
  const userId = params.userId ?? AI_CHAT_DEFAULT_USER_ID;

  return new ReadableStream({
    async start(controller) {
      let closed = false;
      const push = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Client disconnected mid-flush. Mark closed to skip future writes.
          closed = true;
        }
      };

      // Heartbeat so reverse proxies / mobile radios don't drop the connection
      // during long pauses (tool calls, slow first-token, etc.).
      const heartbeat = setInterval(() => {
        push(SSE_HEARTBEAT);
      }, SSE_HEARTBEAT_MS);

      const coalescer = createTextDeltaCoalescer(push);

      let assistantRowId: string | null = null;
      let activeConversationId: string | null = null;
      let accumulated = "";
      let preparedMemory: PreparedPrompt["pendingMemory"] = null;
      let primarySearchMission: SearchMissionSnapshot | null = null;
      let intentUserMessageId: string | null = null;
      let intentBranchId: string | null = null;
      const streamStartedAt = Date.now();

      try {
        getAnthropicClient();

        // 1) Resolve / patch the conversation.
        const ensured = await ensureConversationForUser({
          conversationId: params.body.conversationId,
          userId,
          model: params.body.settings?.model,
          temperature: params.body.settings?.temperature,
          maxTokens: params.body.settings?.maxTokens,
          responseStyle: params.body.settings?.responseStyle,
          systemPrompt: params.body.settings?.systemPrompt ?? undefined,
        });

        const patch = conversationPatchFromSettings(params.body.settings);
        const conv: ConversationRecord =
          Object.keys(patch).length > 0
            ? await prisma.conversation.update({
                where: { id: ensured.id },
                data: patch,
              })
            : ensured;

        activeConversationId = conv.id;
        logAiChat("info", "chat_stream_started", {
          conversationId: conv.id,
          mode,
          hasExistingConversation: Boolean(params.body.conversationId),
        });
        push(
          formatSse("conversation", {
            conversationId: conv.id,
            shippingCountry: conv.shippingCountry,
            currency: conv.currency,
          }),
        );
        pushAgentDebug(push, {
          stage: "stream_started",
          label: `Chat stream (${mode})`,
          conversationId: conv.id,
          data: { mode, model: conv.model },
        });

        // 2) Prep mode-specific mutations (creates the user row for send/clarification,
        //    truncates for edit, deletes for regenerate). Emits `user_message` itself.
        const prep = await prepareModeMutation({
          mode,
          conv,
          userId,
          body: params.body,
          pushEvent: push,
        });
        preparedMemory = prep.pendingMemory;
        intentUserMessageId = prep.userMessageEventId;
        intentBranchId = prep.activeBranchId;

        // 2.25) Topic guard — block off-topic / jailbreak before the main model.
        const topicGuardText = prep.newUserText.trim();
        const runTopicGuard =
          topicGuardText.length > 0 && (mode === "send" || mode === "edit");

        let promptSequence = 0;
        const nextPromptSeq = () => promptSequence++;
        const turnPromptMetadata: Record<string, unknown> = {};
        const promptAudit = () => ({
          userId,
          conversationId: conv.id,
          userMessageId: prep.userMessageEventId,
          assistantMessageId: assistantRowId,
          metadata:
            Object.keys(turnPromptMetadata).length > 0
              ? (turnPromptMetadata as InputJsonValue)
              : undefined,
        });

        let topicEvaluationForAudit: TopicGuardEvaluation | null = null;

        const recordTopicGuardAudit = () => {
          if (!topicEvaluationForAudit) return;
          const ranClassifier =
            topicEvaluationForAudit.decision.source !== "disabled";
          recordPromptRun({
            ...promptAudit(),
            kind: "topic_guard",
            model: ranClassifier ? AI_CHAT_TOPIC_GUARD_MODEL : null,
            sequence: nextPromptSeq(),
            promptText: ranClassifier
              ? formatTopicGuardClassifierPrompt(
                  topicGuardText,
                  topicEvaluationForAudit.history,
                )
              : "",
            resultText: [
              topicEvaluationForAudit.classifier
                ? `=== CLASSIFIER OUTPUT ===\n${JSON.stringify(topicEvaluationForAudit.classifier, null, 2)}`
                : null,
              `=== DECISION ===\n${JSON.stringify(topicEvaluationForAudit.decision, null, 2)}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
            metadata: {
              historyTurnCount: topicEvaluationForAudit.history.length,
            } as InputJsonValue,
          });
        };

        if (runTopicGuard) {
          topicEvaluationForAudit = await evaluateTopicGuard(topicGuardText, {
            signal: params.signal,
            conversationId: conv.id,
            excludeMessageIds: prep.excludeMessageIds,
          });
          const topicDecision = topicEvaluationForAudit.decision;
          const topicMeta = toTopicGuardMetadata(topicDecision);
          const canned =
            topicDecision.allowed && topicDecision.cannedResponse
              ? topicDecision.cannedResponse
              : null;
          const blocked = !topicDecision.allowed;

          if (blocked || canned) {
            if (blocked || topicDecision.category === "greeting") {
              preparedMemory = null;
            }

            const responseText = blocked ? topicDecision.userMessage : canned!;

            const assistantRow = await prisma.message.create({
              data: {
                conversationId: conv.id,
                role: "assistant",
                content: "",
                status: "streaming",
                model: conv.model,
                branchId: prep.activeBranchId,
              },
            });
            assistantRowId = assistantRow.id;
            recordTopicGuardAudit();
            push(
              formatSse("assistant_message", { messageId: assistantRow.id }),
            );
            push(formatSse("topic_guard", topicMeta));
            pushAgentDebug(push, {
              stage: "topic_guard",
              label: blocked ? "Topic blocked" : "Topic guard (canned reply)",
              conversationId: conv.id,
              userMessageId: prep.userMessageEventId,
              assistantMessageId: assistantRow.id,
              data: topicMeta,
            });

            accumulated = responseText;
            coalescer.enqueue(responseText);
            coalescer.flush();

            const isFirstTurn = !params.body.conversationId;
            await Promise.all([
              persistAssistantFinal({
                messageId: assistantRow.id,
                content: responseText,
                status: "completed",
                model: conv.model,
                finishReason: blocked ? "topic_guard" : "end_turn",
                metadata: { topicGuard: topicMeta },
              }),
              touchConversationUpdatedAt(conv.id),
            ]);

            if (isFirstTurn) {
              kickConversationTitleRename(conv.id);
            }

            logAiChat("info", "chat_stream_topic_guard", {
              conversationId: conv.id,
              assistantMessageId: assistantRow.id,
              blocked,
              category: topicMeta.category,
              reason: topicMeta.reason,
              durationMs: Date.now() - streamStartedAt,
            });

            push(
              formatSse("done", {
                messageId: assistantRow.id,
                conversationId: conv.id,
                status: "completed",
                finishReason: blocked ? "topic_guard" : "end_turn",
                isFirstTurn,
                metadata: { topicGuard: topicMeta },
                content: responseText,
              }),
            );
            return;
          }

          pushAgentDebug(push, {
            stage: "topic_guard",
            label: "Topic guard passed",
            conversationId: conv.id,
            userMessageId: prep.userMessageEventId,
            data: topicMeta,
          });
        }

        // 2.5) Resolve the shopping mode for this turn (user pick or auto-detected
        //      from the query) and tell the client which one we settled on. The
        //      resolution feeds the context-builder for the prompt injection and
        //      gets persisted on the assistant message metadata at the end.
        const shoppingResolved = await resolveShoppingMode({
          selection: params.body.shoppingMode,
          queryHint: prep.memoryQueryHint,
          conversationId: conv.id,
        });
        turnPromptMetadata.shoppingMode = shoppingResolved.meta;
        push(formatSse("mode_resolved", shoppingResolved.meta));
        pushAgentDebug(push, {
          stage: "shopping_mode",
          label: `Shopping mode: ${shoppingResolved.mode}`,
          conversationId: conv.id,
          userMessageId: prep.userMessageEventId,
          data: shoppingResolved.meta,
        });

        // 3) Build context (uses preloaded conv → skips a findUnique).
        //    Run in PARALLEL with the assistant row insert below.
        const effectiveModel =
          (params.body.settings?.model &&
          isAllowedModel(params.body.settings.model)
            ? params.body.settings.model
            : null) ?? conv.model;
        const effectiveTemperature = clampTemperature(
          params.body.settings?.temperature,
          conv.temperature,
        );
        const effectiveMaxTokens = clampTokens(
          params.body.settings?.maxTokens,
          conv.maxTokens,
        );

        const contextPromise = buildAnthropicContext(conv.id, {
          conversation: conv,
          excludeMessageIds: prep.excludeMessageIds,
          memoryQueryHint: prep.memoryQueryHint,
          shoppingMode: shoppingResolved.mode,
          contextTag: shoppingResolved.meta.contextTag ?? null,
          homeCategoryNames: params.body.selectedCategories,
        });

        const assistantRowPromise = prisma.message.create({
          data: {
            conversationId: conv.id,
            role: "assistant",
            content: "",
            status: "streaming",
            model: effectiveModel,
            branchId: prep.activeBranchId,
          },
        });

        const [built, assistantRow] = await Promise.all([
          contextPromise,
          assistantRowPromise,
        ]);
        assistantRowId = assistantRow.id;
        if (runTopicGuard) {
          recordTopicGuardAudit();
        }

        // 4) Compose the final Anthropic message list. We inject the new user
        //    text rather than rely on the DB read having committed (parallelism-safe).
        const anthropicMessages: AnthropicTurn[] = [...built.anthropicMessages];
        if (prep.newUserText) {
          anthropicMessages.push({
            role: "user",
            content: formatUserTurnWithReplyContext(
              prep.newUserText,
              params.body.replyContext,
            ),
          });
        }
        if (anthropicMessages.length === 0) {
          push(formatSse("error", { message: "Nothing to reply to yet." }));
          return;
        }

        pushAgentDebug(push, {
          stage: "context_built",
          label: "Context assembled",
          conversationId: conv.id,
          userMessageId: prep.userMessageEventId,
          assistantMessageId: assistantRow.id,
          data: {
            systemPromptChars: built.systemPrompt.length,
            shoppingMemoryChars: built.shoppingMemoryXml.length,
            historyMessages: built.anthropicMessages.length,
            totalMessages: anthropicMessages.length,
            shoppingMode: shoppingResolved.mode,
            contextTag: shoppingResolved.meta.contextTag ?? null,
            memoryQueryHint: prep.memoryQueryHint.slice(0, 200),
            homeCategories: params.body.selectedCategories ?? [],
          },
        });

        push(formatSse("assistant_message", { messageId: assistantRow.id }));

        // 5) Stream from Anthropic with tool-use loop.
        //    The model can either:
        //      - Reply with plain text (loop ends)
        //      - Emit a clarification tool use (terminal — UI shows chips)
        //      - Emit Shopify catalog searches (we run them, feed tool_result back, re-stream)
        const anthropic = getAnthropicClient();

        let metadataPayload: MessageMetadata | undefined;
        let clarificationState: MessageClarificationV1 | null = null;
        let giftDirectionsState: MessageGiftDirectionsV1 | null = null;
        const pendingOptionPreviewJobs: Promise<void>[] = [];
        let lastInputTokens: number | null = null;
        let lastOutputTokens: number | null = null;
        let lastStopReason: string | null = null;
        const productSearches: ProductSearchInvocation[] = [];
        // Once a real catalog search has run, the next model pass is the recap.
        // We drop tools on that pass to force a single text reply — capping a
        // search turn at 2 model calls instead of up to 4. (Not set by the
        // readiness gate, which still needs the clarification tool available.)
        let searchedThisTurn = false;
        // (`curatorWaiters` is declared in the outer scope so the catch can
        // drain any in-flight curator passes for persistence.)

        // Lazy, per-turn promise for the buyer's sizing / colour hints. Used
        // to pre-select option values on the PDP link for every card we
        // surface. Started the first time a search runs and reused across
        // every subsequent search in the same chat turn (directional mode
        // emits one per direction).
        let optionHintsPromise: Promise<UserOptionHints> | null = null;
        const getOptionHints = () => {
          if (!optionHintsPromise) {
            optionHintsPromise = loadUserOptionHints(
              userId,
              prep.memoryQueryHint,
            );
          }
          return optionHintsPromise;
        };
        // Buyer shipping destination + locale + hard avoid terms. Loaded once
        // per turn and enforced on every search/hydration so we never surface
        // something that can't ship to them or that they've told us to avoid.
        let buyerContextPromise: Promise<BuyerCatalogContext> | null = null;
        const getBuyerContext = () => {
          if (!buyerContextPromise) {
            buyerContextPromise = loadBuyerCatalogContext(
              userId,
              prep.memoryQueryHint,
              conv.id,
            );
          }
          return buyerContextPromise;
        };

        const attachGiftDirections = (
          giftDirections: MessageGiftDirectionsV1,
        ) => {
          giftDirectionsState = giftDirections;
          metadataPayload = {
            ...(metadataPayload ?? {}),
            giftDirections,
          };
          push(
            formatSse("gift_directions", {
              messageId: assistantRow.id,
              giftDirections,
              expectsOptionPreviews:
                giftDirections.expectsOptionPreviews ?? false,
            }),
          );
          const previewOptions =
            collectGiftDirectionPreviewRequests(giftDirections);
          pendingOptionPreviewJobs.push(
            runOptionPreviews({
              messageId: assistantRow.id,
              conversationId: conv.id,
              options: previewOptions,
              getBuyerContext,
              fallbackShippingCountry: conv.shippingCountry,
              push,
              applyPreviews: (previewMap) => {
                const merged = mergeOptionPreviewsIntoGiftDirections(
                  giftDirectionsState ?? giftDirections,
                  previewMap,
                );
                giftDirectionsState = merged;
                metadataPayload = {
                  ...(metadataPayload ?? {}),
                  giftDirections: merged,
                };
                return { giftDirections: merged };
              },
            }),
          );
        };

        // We separate tool-loop iterations with a blank line in the persisted
        // text so the model's preface ("Let me look that up…") doesn't run into
        // its post-search recap.
        let iterationBoundaryPending = false;

        for (let iter = 0; iter < MAX_TOOL_ITERATIONS + 1; iter++) {
          // Check for client disconnect before starting each LLM call or tool round-trip.
          if (params.signal.aborted) break;

          const isFinalIter = iter === MAX_TOOL_ITERATIONS;
          // Drop tools on the final pass (force a close-out) AND on the recap
          // pass right after a real search (cap the round-trips).
          const toolsDisabled = isFinalIter || searchedThisTurn;
          const messagesSent: AnthropicTurn[] = [...anthropicMessages];
          const systemSent = built.systemPrompt;
          pushAgentDebug(push, {
            stage: "llm_call",
            label: `LLM call (iter ${iter})`,
            conversationId: conv.id,
            userMessageId: prep.userMessageEventId,
            assistantMessageId: assistantRow.id,
            data: {
              iteration: iter,
              model: effectiveModel,
              toolsDisabled,
              maxTokens: effectiveMaxTokens,
              temperature: effectiveTemperature,
              messageCount: messagesSent.length,
              systemPromptChars: systemSent.length,
            },
          });
          const apiTemperature = anthropicTemperatureForModel(
            effectiveModel,
            effectiveTemperature,
          );
          const stream = anthropic.messages.stream(
            {
              model: effectiveModel,
              max_tokens: effectiveMaxTokens,
              ...(apiTemperature !== undefined
                ? { temperature: apiTemperature }
                : {}),
              system: built.systemPrompt,
              messages: anthropicMessages,
              ...(toolsDisabled ? {} : { tools: CHAT_TOOLS }),
            },
            { signal: params.signal },
          );

          let iterHadText = false;
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const t = event.delta.text;
              if (!iterHadText && iterationBoundaryPending && accumulated) {
                accumulated += "\n\n";
                coalescer.enqueue("\n\n");
                iterationBoundaryPending = false;
              }
              iterHadText = true;
              accumulated += t;
              coalescer.enqueue(t);
            }
          }
          coalescer.flush();

          const finalMsg = await stream.finalMessage();
          lastInputTokens = finalMsg.usage?.input_tokens ?? lastInputTokens;
          lastOutputTokens = finalMsg.usage?.output_tokens ?? lastOutputTokens;
          lastStopReason = finalMsg.stop_reason ?? lastStopReason;

          recordPromptRun({
            ...promptAudit(),
            kind: "main_chat",
            model: effectiveModel,
            sequence: nextPromptSeq(),
            iteration: iter,
            promptText: formatPromptBundle(systemSent, messagesSent),
            resultText: formatAnthropicMessageResult(finalMsg),
            metadata: {
              ...turnPromptMetadata,
              toolsDisabled,
            } as InputJsonValue,
          });

          const toolUseBlocks = finalMsg.content.filter(
            (b) => b.type === "tool_use",
          );
          pushAgentDebug(push, {
            stage: "llm_result",
            label: `LLM result (iter ${iter})`,
            conversationId: conv.id,
            userMessageId: prep.userMessageEventId,
            assistantMessageId: assistantRow.id,
            data: {
              iteration: iter,
              stopReason: finalMsg.stop_reason,
              inputTokens: finalMsg.usage?.input_tokens ?? null,
              outputTokens: finalMsg.usage?.output_tokens ?? null,
              toolUses: toolUseBlocks.map((b) =>
                b.type === "tool_use"
                  ? { name: b.name, id: b.id, input: b.input }
                  : null,
              ),
            },
          });
          for (const block of toolUseBlocks) {
            if (block.type !== "tool_use") continue;
            pushAgentDebug(push, {
              stage: "tool_call",
              label: `Tool: ${block.name}`,
              conversationId: conv.id,
              userMessageId: prep.userMessageEventId,
              assistantMessageId: assistantRow.id,
              data: {
                toolUseId: block.id,
                name: block.name,
                input: block.input,
              },
            });
          }

          // Capture clarification tool use (terminal).
          const clarificationBlock = toolUseBlocks.find(
            (b) => b.name === PRODUCT_SEARCH_CLARIFICATION_TOOL_NAME,
          );
          if (clarificationBlock) {
            const clarification = parseClarificationToolInput(
              clarificationBlock.input,
            );
            if (clarification?.questions?.length) {
              // W7: Suppress clarification questions for attributes already stored in
              // shopping memory. This prevents the system from asking a returning user
              // for their shoe size for the 5th time.
              let filteredQuestions = clarification.questions;
              try {
                const knownAttrs =
                  await getKnownClarificationAttributes(userId);
                if (knownAttrs.size > 0) {
                  filteredQuestions = clarification.questions.filter(
                    (q) => !knownAttrs.has(q.id.toLowerCase()),
                  );
                }
              } catch {
                // Best-effort: if the check fails, show all questions
              }

              try {
                filteredQuestions = await ensureBrandClarificationQuestion({
                  userId,
                  queryHint: prep.memoryQueryHint,
                  questions: filteredQuestions,
                });
                filteredQuestions =
                  ensureClarificationQuestions(filteredQuestions);
              } catch {
                // Best-effort brand enrichment
              }

              if (filteredQuestions.length > 0) {
                const clarificationMeta: MessageClarificationV1 = {
                  ...clarification,
                  questions: filteredQuestions,
                  expectsOptionPreviews: clarificationExpectsOptionPreviews({
                    questions: filteredQuestions,
                  }),
                };
                clarificationState = clarificationMeta;
                metadataPayload = {
                  ...(metadataPayload ?? {}),
                  clarification: clarificationMeta,
                };

                push(
                  formatSse("clarification", {
                    messageId: assistantRow.id,
                    clarification: clarificationMeta,
                    expectsOptionPreviews:
                      clarificationMeta.expectsOptionPreviews ?? false,
                  }),
                );

                const previewOptions =
                  collectPreviewRequests(clarificationMeta);
                pendingOptionPreviewJobs.push(
                  runOptionPreviews({
                    messageId: assistantRow.id,
                    conversationId: conv.id,
                    options: previewOptions,
                    getBuyerContext,
                    fallbackShippingCountry: conv.shippingCountry,
                    push,
                    applyPreviews: (previewMap) => {
                      const merged = mergeOptionPreviewsIntoClarification(
                        clarificationState ?? clarificationMeta,
                        previewMap,
                      );
                      clarificationState = merged;
                      metadataPayload = {
                        ...(metadataPayload ?? {}),
                        clarification: merged,
                      };
                      return { clarification: merged };
                    },
                  }),
                );
              }
              // If all questions were suppressed, skip clarification entirely —
              // the model will proceed to search on the next iteration.
            }
          }

          // Capture gift-direction proposals (terminal: rendered as multi-select
          // chips; the buyer's choices come back as a new turn).
          const giftDirectionsBlock = toolUseBlocks.find(
            (b) => b.name === PROPOSE_GIFT_DIRECTIONS_TOOL_NAME,
          );
          if (giftDirectionsBlock) {
            const giftDirections = parseGiftDirectionsToolInput(
              giftDirectionsBlock.input,
            );
            if (giftDirections) {
              attachGiftDirections(giftDirections);
            }
          }

          const searchBlocks = toolUseBlocks.filter(
            (b) => b.name === SHOPIFY_SEARCH_TOOL_NAME,
          );

          // Terminal: no actionable tools (plain text or clarification only).
          if (!searchBlocks.length) break;

          // Append the assistant turn with its full content (incl. tool_use)
          // so we can attach tool_result blocks in the user turn that follows.
          anthropicMessages.push({
            role: "assistant",
            content: finalMsg.content as ContentBlockParam[],
          });

          // Resolve the buyer's shipping destination + locale once, then apply
          // it to every search in this iteration (enforced server-side).
          const buyerContext = await getBuyerContext().catch(
            () => ({ avoidTerms: [] }) as BuyerCatalogContext,
          );
          // Buyer sizing — used by the readiness gate to avoid blind searches.
          const sizingHints = await getOptionHints().catch(() => null);

          // Engine prerequisites: a catalog token (shared across the fan-out)
          // and the buyer's gender scope (self requests only — never applied to
          // gifts for someone else).
          const engineCatalogToken = await accessTokenForCatalogMcp().catch(
            (): null => null,
          );
          const buyerGenderScope = genderScopeFromPresentation(
            (
              await prisma.userProfile
                .findUnique({
                  where: { userId },
                  select: { genderPresentation: true },
                })
                .catch(() => null)
            )?.genderPresentation,
          );

          // Refine-round dedupe (Stage 6): never repeat a product already shown
          // earlier in this conversation. Applied to every engine search this
          // turn so "show me more" surfaces fresh results.
          const engineExcludedKeys = await loadExcludedKeysForConversation(
            conv.id,
          ).catch(() => new Set<string>());

          const warmSearchProducts = await loadWarmSearchCandidates({
            conversationId: conv.id,
          }).catch(() => []);

          // Run EVERY catalog search in this iteration in parallel. Directional
          // mode emits one search per style direction; the old sequential loop
          // serialized them and added seconds of wall-clock latency.
          const searchExecutions = await Promise.all(
            searchBlocks.map(async (block) => {
              if (block.type !== "tool_use") {
                return { kind: "skip" as const, block };
              }
              const parsed = shopifySearchToolInputSchema.safeParse(
                block.input,
              );
              if (!parsed.success) {
                return { kind: "invalid" as const, block };
              }
              // Readiness gate: never search a sized category blind. If we have
              // no size from the query OR the profile, ask first.
              const missingSize = sizingHints
                ? detectMissingRequiredSize(parsed.data.query, sizingHints)
                : null;
              if (missingSize) {
                return {
                  kind: "needs_size" as const,
                  block,
                  parsed: parsed.data,
                  sizeType: missingSize,
                };
              }

              let brief = briefFromSearchInput(parsed.data, {
                buyerGenderScope,
                defaultCurrency: buyerContext.context?.currency,
              });
              if (isGiftArchetype(brief)) {
                brief = await enrichSearchBriefFromMemory(userId, brief).catch(
                  () => brief,
                );
                brief = inferGiftDirectionLabelFromQuery(
                  brief,
                  parsed.data.query,
                );
              }
              if (giftSearchNeedsDirectionPicker(brief)) {
                return {
                  kind: "needs_gift_direction" as const,
                  block,
                  parsed: parsed.data,
                  brief,
                };
              }

              // Always run the multi-query search engine (no legacy single-query path).
              // null means Global API token mint failed.
              const catalogTokenForEngine =
                engineCatalogToken ??
                (await accessTokenForCatalogMcp().catch((): null => null));

              if (catalogTokenForEngine === null) {
                return {
                  kind: "error" as const,
                  block,
                  parsed: parsed.data,
                  error:
                    "Catalog authentication failed — search engine could not start.",
                };
              }

              const feedback = await loadFeedbackAvoidSet(userId, brief).catch(
                () => undefined,
              );

              let partialSearchEmitted = false;
              try {
                const engine = await runSearchEngine({
                  brief,
                  userId,
                  accessToken: catalogTokenForEngine,
                  contextTag: shoppingResolved.meta.contextTag ?? null,
                  displayLimit: productDisplayLimitForMode(
                    shoppingResolved.mode,
                  ),
                  shipsToCountry: buyerContext.shipsToCountry,
                  context: buyerContext.context,
                  avoidTerms: buyerContext.avoidTerms,
                  excludedKeys: engineExcludedKeys,
                  warmProducts: warmSearchProducts,
                  feedback,
                  signal: params.signal,
                  audit: {
                    userId,
                    conversationId: conv.id,
                    userMessageId: prep.userMessageEventId,
                    assistantMessageId: assistantRow.id,
                    searchKey: block.id,
                    toolInput: parsed.data as unknown as Record<
                      string,
                      unknown
                    >,
                  },
                  onNarration: (line) => {
                    if (closed) return;
                    push(
                      formatSse("narration_line", {
                        searchKey: block.id,
                        line,
                      }),
                    );
                  },
                  onSearchPartial: (partial) => {
                    if (closed) return;
                    partialSearchEmitted = true;
                    const skeletonInvocation: ProductSearchInvocation = {
                      query: parsed.data.query,
                      filters: parsed.data.filters,
                      intent: parsed.data.intent,
                      products: partial.products,
                      displayLimit: productDisplayLimitForMode(
                        shoppingResolved.mode,
                      ),
                      curatedPicks: partial.curatedPicks,
                      curationPending: true,
                      curationFallback: false,
                      searchKey: block.id,
                      directionLabel: brief.directionLabel,
                      archetype: brief.archetype,
                      mission: searchMissionFromBrief(brief),
                    };
                    productSearches.push(skeletonInvocation);
                    push(formatSse("product_search", skeletonInvocation));
                  },
                  queryPlannerDebug: {
                    audit: {
                      userId,
                      conversationId: conv.id,
                      userMessageId: prep.userMessageEventId,
                      assistantMessageId: assistantRow.id,
                    },
                    nextSequence: nextPromptSeq,
                    extraMetadata: { searchKey: block.id },
                    ...(isAgentDebugEnabled()
                      ? {
                          onRun: (run: QueryPlannerRunDebug) => {
                            pushAgentDebug(push, {
                              stage: "query_planner",
                              label: run.step.replace(/_/g, " "),
                              conversationId: conv.id,
                              userMessageId: prep.userMessageEventId,
                              assistantMessageId: assistantRow.id,
                              data: {
                                step: run.step,
                                model: run.model,
                                promptText: run.promptText,
                                resultText: run.resultText,
                              },
                            });
                          },
                        }
                      : {}),
                  },
                  ...(isAgentDebugEnabled()
                    ? {
                        onPipelineDebug: (pipeline) => {
                          const persisted = pipelineDebugForPersist(pipeline);
                          recordPromptRun({
                            ...promptAudit(),
                            kind: "search_pipeline",
                            sequence: nextPromptSeq(),
                            promptText: pipeline.query,
                            resultText: JSON.stringify(persisted),
                            metadata: {
                              searchKey: pipeline.searchKey,
                              method: pipeline.method,
                            } as InputJsonValue,
                          });
                          pushAgentDebug(push, {
                            stage: "search_pipeline",
                            label: "Search pipeline",
                            conversationId: conv.id,
                            userMessageId: prep.userMessageEventId,
                            assistantMessageId: assistantRow.id,
                            data: persisted as unknown as Record<
                              string,
                              unknown
                            >,
                          });
                        },
                      }
                    : {}),
                });
                return {
                  kind: "engine" as const,
                  block,
                  parsed: parsed.data,
                  brief,
                  engine,
                  partialSearchEmitted,
                };
              } catch (e) {
                logAiChat("warn", "search_engine_failed", {
                  conversationId: conv.id,
                  query: parsed.data.query.slice(0, 120),
                  error: e instanceof Error ? e.message : String(e),
                });
                return {
                  kind: "error" as const,
                  block,
                  parsed: parsed.data,
                  error:
                    e instanceof Error ? e.message : "Search engine failed.",
                };
              }
            }),
          );

          const toolResultBlocks: ContentBlockParam[] = [];
          for (const r of searchExecutions) {
            if (r.kind === "skip") continue;
            const block = r.block;
            if (block.type !== "tool_use") continue;

            if (r.kind === "invalid") {
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: block.id,
                is_error: true,
                content: emptyToolResultPayload(
                  typeof (block.input as { query?: unknown })?.query ===
                    "string"
                    ? String((block.input as { query?: unknown }).query)
                    : "",
                  "Invalid tool arguments — re-check the schema.",
                ),
              });
              continue;
            }

            if (r.kind === "error") {
              const invocation: ProductSearchInvocation = {
                query: r.parsed.query,
                filters: r.parsed.filters,
                intent: r.parsed.intent,
                products: [],
                error: r.error,
                searchKey: block.id,
              };
              productSearches.push(invocation);
              push(formatSse("product_search", invocation));
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: block.id,
                is_error: true,
                content: emptyToolResultPayload(r.parsed.query, r.error),
              });
              continue;
            }

            if (r.kind === "needs_size") {
              // Don't surface products — instruct the model to get the size
              // first so we never pick the wrong one. No invocation is emitted.
              const label = REQUIRED_SIZE_LABEL[r.sizeType];
              logAiChat("info", "search_readiness_gate", {
                conversationId: conv.id,
                sizeType: r.sizeType,
                query: r.parsed.query.slice(0, 120),
              });
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({
                  query: r.parsed.query,
                  total_returned: 0,
                  products: [],
                  needs: `${r.sizeType}_size`,
                  message:
                    `Do NOT show products yet. This is a sized category and the buyer's ${label} is unknown ` +
                    `(not in their message and not in their saved profile). Picking now risks the wrong size. ` +
                    `Ask the buyer for their ${label} first — prefer the emit_product_search_clarification tool with a single size question — ` +
                    `then search again with the size embedded in the query.`,
                }),
              });
              continue;
            }

            if (r.kind === "needs_gift_direction") {
              logAiChat("info", "search_gift_direction_gate", {
                conversationId: conv.id,
                query: r.parsed.query.slice(0, 120),
                recipient: r.brief.recipient.label,
              });
              if (
                !(metadataPayload as { giftDirections?: unknown } | undefined)
                  ?.giftDirections
              ) {
                const directions = await craftGiftDirectionsFromBrief(r.brief, {
                  signal: params.signal,
                });
                attachGiftDirections(directions);
              }
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({
                  query: r.parsed.query,
                  total_returned: 0,
                  products: [],
                  blocked: true,
                  needs: "gift_direction",
                  message:
                    "Do NOT show products yet. Direction chips are shown to the buyer — invite them to pick 1-2 themes. " +
                    "After they submit, run one search_shopify_catalog per chosen direction with direction_label set, " +
                    "archetype gift_directed, and recipient.kind other.",
                }),
              });
              continue;
            }

            if (r.kind === "engine") {
              const { parsed, engine, brief, partialSearchEmitted } = r;
              searchedThisTurn = true;
              const displayLimit = productDisplayLimitForMode(
                shoppingResolved.mode,
              );

              if (partialSearchEmitted) {
                push(
                  formatSse("product_search_update", {
                    searchKey: block.id,
                    curatedPicks: engine.curatedPicks,
                    curationFallback: engine.curationFallback,
                    curationPending: false,
                    products: engine.products,
                  }),
                );
                const existing = productSearches.find(
                  (inv) => inv.searchKey === block.id,
                );
                if (existing) {
                  existing.products = engine.products;
                  existing.curatedPicks = engine.curatedPicks;
                  existing.curationFallback = engine.curationFallback;
                  existing.curationPending = false;
                  existing.truncated = engine.rawCount > engine.products.length;
                }
                if (!primarySearchMission && engine.products.length > 0) {
                  primarySearchMission = searchMissionFromBrief(brief);
                }
              } else {
                const invocation: ProductSearchInvocation = {
                  query: parsed.query,
                  filters: parsed.filters,
                  intent: parsed.intent,
                  products: engine.products,
                  displayLimit,
                  truncated: engine.rawCount > engine.products.length,
                  curatedPicks: engine.curatedPicks,
                  curationFallback: engine.curationFallback,
                  curationPending: false,
                  searchKey: block.id,
                  directionLabel: brief.directionLabel,
                  archetype: brief.archetype,
                  mission: searchMissionFromBrief(brief),
                };
                productSearches.push(invocation);
                if (!primarySearchMission && engine.products.length > 0) {
                  primarySearchMission = invocation.mission!;
                }
                push(formatSse("product_search", invocation));
              }

              // Persist curated rows for the PDP (with engine provenance).
              void persistCuratedPicks(
                {
                  userId,
                  conversationId: conv.id,
                  messageId: assistantRow.id,
                  searchInput: parsed,
                },
                engine.curatedPicks,
              ).catch((error) => {
                logAiChat("warn", "engine_persist_failed", {
                  conversationId: conv.id,
                  searchKey: block.id,
                  error,
                });
              });

              // Query-yield telemetry (Stage 6 learning flywheel).
              void recordSearchQueryYields({
                userId,
                conversationId: conv.id,
                searchKey: block.id,
                brief,
                stats: engine.stats,
              }).catch(() => {});

              const toolResultContent = buildEngineToolResultPayload(engine);
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: toolResultContent,
              });

              recordPromptRun({
                ...promptAudit(),
                kind: "catalog_search",
                sequence: nextPromptSeq(),
                promptText: `=== ENGINE BRIEF (${SHOPIFY_SEARCH_TOOL_NAME}) ===\n${JSON.stringify(
                  brief,
                  null,
                  2,
                )}`,
                resultText: toolResultContent,
                metadata: {
                  ...turnPromptMetadata,
                  searchKey: block.id,
                  engine: true,
                  archetype: brief.archetype,
                  productCount: engine.products.length,
                  rawCount: engine.rawCount,
                } as InputJsonValue,
              });
              continue;
            }
          }

          anthropicMessages.push({ role: "user", content: toolResultBlocks });
          // Mark a soft boundary so the next iteration's text (the model's
          // post-search recap) doesn't run straight into the preface.
          iterationBoundaryPending = true;
          // Loop continues — next iteration streams the model's follow-up.
        }

        // Curator picks are final at search time (engine slotting + tier judgment).

        if (productSearches.length) {
          const productSearch: MessageProductSearchV1 = {
            version: 1,
            searches: productSearches,
          };
          metadataPayload = {
            ...(metadataPayload ?? {}),
            productSearch,
          };
        }

        // Always record the resolved shopping mode on the assistant message
        // so the UI can render the mode badge after reload + so future turns
        // can use it as a previous-mode anchor.
        if (clarificationState) {
          metadataPayload = {
            ...(metadataPayload ?? {}),
            clarification: clarificationState,
          };
        }
        if (giftDirectionsState) {
          metadataPayload = {
            ...(metadataPayload ?? {}),
            giftDirections: giftDirectionsState,
          };
        }
        metadataPayload = {
          ...(metadataPayload ?? {}),
          shoppingMode: shoppingResolved.meta,
        };

        // The streamed `accumulated` text is the user-visible source of truth
        // and naturally includes every iteration's text (separated by blank
        // lines via the boundary token above). Use it for both persistence and
        // the terminal `done` event.
        const finalText = accumulated;

        // Let in-flight preview fetches finish (bounded) so `done` carries
        // hydrated collages and `option_previews` SSE reaches the client before
        // the stream controller closes.
        if (pendingOptionPreviewJobs.length) {
          await Promise.race([
            Promise.allSettled(pendingOptionPreviewJobs),
            new Promise<void>((resolve) => {
              setTimeout(resolve, 2800);
            }),
          ]);
        }

        // Merge any preview images written by async jobs before final persist.
        if (metadataPayload) {
          try {
            const previewRow = await prisma.message.findUnique({
              where: { id: assistantRow.id },
              select: { metadata: true },
            });
            const previewMeta = previewRow?.metadata as MessageMetadata | null;
            if (previewMeta) {
              metadataPayload =
                (mergeOptionPreviewMetadata(
                  previewMeta,
                  metadataPayload,
                ) as MessageMetadata | null) ?? metadataPayload;
              if (clarificationState && metadataPayload.clarification) {
                clarificationState = metadataPayload.clarification;
              }
              if (giftDirectionsState && metadataPayload.giftDirections) {
                giftDirectionsState = metadataPayload.giftDirections;
              }
            }
          } catch (error) {
            logAiChat("warn", "preview_metadata_merge_skipped", {
              conversationId: conv.id,
              assistantMessageId: assistantRow.id,
              error,
            });
          }
        }

        // 6) Persist final + bump conversation.updatedAt (sidebar ordering).
        const isFirstTurn = !params.body.conversationId;
        await Promise.all([
          persistAssistantFinal({
            messageId: assistantRow.id,
            content: finalText,
            status: "completed",
            model: effectiveModel,
            inputTokens: lastInputTokens,
            outputTokens: lastOutputTokens,
            finishReason: lastStopReason,
            metadata: metadataPayload ?? null,
          }),
          touchConversationUpdatedAt(conv.id),
        ]);

        if (isFirstTurn) {
          kickConversationTitleRename(conv.id);
        }

        if (preparedMemory) {
          spawnDetachedMemoryPipeline(preparedMemory);
        }
        if (primarySearchMission && intentUserMessageId && intentBranchId) {
          spawnSearchIntentPipeline({
            userId,
            conversationId: conv.id,
            userMessageId: intentUserMessageId,
            branchId: intentBranchId,
            currentMission: primarySearchMission,
          });
        }
        kickConversationSummaryRefresh(conv.id);

        accumulated = finalText;
        logAiChat("info", "chat_stream_completed", {
          conversationId: conv.id,
          assistantMessageId: assistantRow.id,
          mode,
          model: effectiveModel,
          inputTokens: lastInputTokens,
          outputTokens: lastOutputTokens,
          finishReason: lastStopReason,
          productSearchCount: productSearches.length,
          durationMs: Date.now() - streamStartedAt,
        });

        pushAgentDebug(push, {
          stage: "turn_done",
          label: "Turn completed",
          conversationId: conv.id,
          userMessageId: prep.userMessageEventId,
          assistantMessageId: assistantRow.id,
          data: {
            finishReason: lastStopReason,
            inputTokens: lastInputTokens,
            outputTokens: lastOutputTokens,
            productSearchCount: productSearches.length,
            durationMs: Date.now() - streamStartedAt,
            metadata: metadataPayload ?? null,
          },
        });
        push(
          formatSse("done", {
            messageId: assistantRow.id,
            conversationId: conv.id,
            status: "completed",
            finishReason: lastStopReason,
            inputTokens: lastInputTokens,
            outputTokens: lastOutputTokens,
            isFirstTurn,
            // Without this, the client never learns about clarification chips
            // or product cards because we no longer reload the conversation
            // after every stream. Carry the structured metadata in the
            // terminal event.
            metadata: metadataPayload ?? null,
            content: finalText,
          }),
        );
      } catch (err) {
        coalescer.flush();
        const aborted =
          params.signal.aborted || err instanceof APIUserAbortError;
        if (assistantRowId) {
          try {
            await persistAssistantFinal({
              messageId: assistantRowId,
              content: accumulated,
              status: aborted ? "stopped" : "failed",
              error: aborted ? undefined : clientErrorMessage(err),
            });
          } catch {
            // already disconnected — DB write may have raced; best-effort.
          }

          const clientError = aborted ? undefined : clientErrorMessage(err);
          push(
            formatSse("done", {
              messageId: assistantRowId,
              conversationId: activeConversationId,
              status: aborted ? "stopped" : "failed",
              partial: accumulated,
              ...(clientError ? { error: clientError } : {}),
            }),
          );
        }

        if (!aborted) {
          push(formatSse("error", { message: clientErrorMessage(err) }));
          logAiChat("error", "chat_stream_failed", {
            conversationId: activeConversationId,
            assistantMessageId: assistantRowId,
            mode,
            durationMs: Date.now() - streamStartedAt,
            error: err,
          });
        } else if (preparedMemory || primarySearchMission) {
          // User-aborted: still spawn memory so prefs from the user's message
          // (which already persisted) aren't lost.
          if (preparedMemory) spawnDetachedMemoryPipeline(preparedMemory);
          if (
            primarySearchMission &&
            intentUserMessageId &&
            intentBranchId &&
            activeConversationId
          ) {
            spawnSearchIntentPipeline({
              userId,
              conversationId: activeConversationId,
              userMessageId: intentUserMessageId,
              branchId: intentBranchId,
              currentMission: primarySearchMission,
            });
          }
          if (activeConversationId)
            kickConversationSummaryRefresh(activeConversationId);
          logAiChat("info", "chat_stream_stopped", {
            conversationId: activeConversationId,
            assistantMessageId: assistantRowId,
            mode,
            durationMs: Date.now() - streamStartedAt,
          });
        }

        if (activeConversationId) {
          // Best-effort bump so the sidebar still reorders stopped/failed turns.
          await touchConversationUpdatedAt(activeConversationId).catch(
            () => {},
          );
        }
      } finally {
        clearInterval(heartbeat);
        coalescer.dispose();
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
}
