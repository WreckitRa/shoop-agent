import { prisma } from "./db";
import type { InputJsonValue } from "./prisma-types";
import type { MessageMetadata, MessageStatus, ResponseStyle } from "./types";
import { mergeOptionPreviewMetadata } from "./merge-option-preview-metadata";
import {
  AI_CHAT_DEFAULT_USER_ID,
  AI_CHAT_DEFAULT_MODEL,
  NEW_CHAT_TITLE,
  isAllowedModel,
} from "./constants";
import { invalidateConversationContextSummary } from "./conversation-summary";
import { bootstrapConversationBranch } from "./intent-branch/bootstrap";
import { logAiChat } from "./observability";
import { generateConversationTitle } from "./title-generator";
import { localeSnapshotFromProfile } from "@/lib/shopify/catalog-localization";
import { loadDefaultSavedAddressLocale } from "@/lib/shopify/default-saved-address";

export async function touchConversationUpdatedAt(conversationId: string) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
}

/**
 * Deletes every message that appears after `anchorMessageId` in conversation order.
 * Uses (createdAt, id) ordering so ties on `createdAt` cannot strand a trailing assistant.
 */
export async function deleteMessagesStrictlyAfter(
  conversationId: string,
  anchorMessageId: string,
): Promise<void> {
  const ordered: { id: string }[] = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const idx = ordered.findIndex((m) => m.id === anchorMessageId);
  if (idx === -1) return;
  const ids = ordered.slice(idx + 1).map((m) => m.id);
  if (!ids.length) return;
  await Promise.all([
    prisma.message.deleteMany({ where: { id: { in: ids } } }),
    invalidateConversationContextSummary(conversationId),
  ]);
}

export async function ensureConversationForUser(params: {
  conversationId?: string;
  userId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseStyle?: ResponseStyle;
  systemPrompt?: string | null;
}) {
  const userId = params.userId ?? AI_CHAT_DEFAULT_USER_ID;
  const model =
    params.model && isAllowedModel(params.model)
      ? params.model
      : AI_CHAT_DEFAULT_MODEL;

  if (params.conversationId) {
    const existing = await prisma.conversation.findFirst({
      where: { id: params.conversationId, userId },
    });
    if (!existing || existing.deletedAt) throw new Error("Conversation not found");
    return existing;
  }

  const [profile, savedAddress] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: { shippingCountry: true, country: true, currency: true },
    }),
    loadDefaultSavedAddressLocale(userId),
  ]);
  const locale = localeSnapshotFromProfile(profile, savedAddress);

  const conv = await prisma.conversation.create({
    data: {
      title: NEW_CHAT_TITLE,
      userId,
      model,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens ?? 4096,
      responseStyle: params.responseStyle ?? "balanced",
      systemPrompt: params.systemPrompt ?? null,
      shippingCountry: locale.shippingCountry,
      currency: locale.currency,
    },
  });

  await bootstrapConversationBranch({
    conversationId: conv.id,
    title: conv.title,
  });

  return conv;
}

export async function maybeRenameConversationAfterFirstReply(params: {
  conversationId: string;
  signal?: AbortSignal;
}) {
  const conv = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    include: {
      messages: {
        where: { role: "user", status: "completed" },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  if (!conv || conv.title !== NEW_CHAT_TITLE) return;
  const firstUser = conv.messages[0]?.content;
  if (!firstUser?.trim()) return;

  const title = await generateConversationTitle(firstUser, params.signal, {
    userId: conv.userId,
    kind: "conversation_title",
    conversationId: conv.id,
    sequence: 0,
  });
  if (title === NEW_CHAT_TITLE) return;

  await prisma.conversation.update({
    where: { id: conv.id },
    data: { title },
  });

  await prisma.conversationBranch.updateMany({
    where: { conversationId: conv.id, index: 0 },
    data: { title },
  });

  logAiChat("info", "conversation_title_renamed", {
    conversationId: conv.id,
    title,
  });
}

export function kickConversationTitleRename(conversationId: string) {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 15_000);
  void maybeRenameConversationAfterFirstReply({
    conversationId,
    signal: ac.signal,
  })
    .catch((error) => {
      logAiChat("warn", "conversation_title_rename_failed", {
        conversationId,
        error: String(error),
      });
    })
    .finally(() => clearTimeout(timeout));
}

export async function persistAssistantFinal(params: {
  messageId: string;
  content: string;
  status: MessageStatus;
  model?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  finishReason?: string | null;
  error?: string | null;
  metadata?: MessageMetadata | null;
}) {
  const row = await prisma.message.findUnique({
    where: { id: params.messageId },
    select: { metadata: true },
  });
  const existingMeta = (row?.metadata as MessageMetadata | null) ?? null;

  let metadata = params.metadata;
  if (metadata && existingMeta) {
    metadata = mergeOptionPreviewMetadata(
      existingMeta,
      metadata,
    ) as MessageMetadata;
  }

  await prisma.message.update({
    where: { id: params.messageId },
    data: {
      content: params.content,
      status: params.status,
      model: params.model,
      inputTokens: params.inputTokens ?? undefined,
      outputTokens: params.outputTokens ?? undefined,
      finishReason: params.finishReason ?? undefined,
      error: params.error ?? undefined,
      ...(metadata !== undefined
        ? { metadata: metadata as InputJsonValue }
        : {}),
    },
  });
}

/** When the user sends a new chat message, unanswered clarification chips are dismissed. */
export async function skipPendingClarificationsForConversation(
  conversationId: string,
  opts?: {
    /** Fashion quiz message that was just answered via chips. */
    fashionClarificationMessageId?: string;
    /** question.text → structured answer. */
    fashionClarificationAnswers?: Record<
      string,
      { selected: string[]; customText?: string }
    >;
  },
) {
  const rows: { id: string; metadata: unknown }[] = await prisma.message.findMany({
    where: {
      conversationId,
      role: "assistant",
      status: "completed",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: { id: true, metadata: true },
  });

  const updates = rows.flatMap((row) => {
    const meta = row.metadata as MessageMetadata | null;
    if (!meta) return [];

    let nextMeta: MessageMetadata | null = null;

    const fashion = meta.fashionRouter;
    if (
      fashion?.move === "ask_clarification" &&
      fashion.status !== "answered"
    ) {
      const isSource =
        opts?.fashionClarificationMessageId != null &&
        opts.fashionClarificationMessageId === row.id;
      nextMeta = {
        ...meta,
        fashionRouter: {
          ...fashion,
          status: "answered",
          ...(isSource && opts.fashionClarificationAnswers
            ? { answers: opts.fashionClarificationAnswers }
            : fashion.answers
              ? { answers: fashion.answers }
              : {}),
        },
      };
    }

    if (!nextMeta) return [];
    return [
      prisma.message.update({
        where: { id: row.id },
        data: {
          metadata: nextMeta as InputJsonValue,
        },
      }),
    ];
  });

  if (updates.length) await prisma.$transaction(updates);
}
