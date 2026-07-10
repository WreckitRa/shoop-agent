import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { createLightweightMessage } from "./anthropic";
import { RECENT_MESSAGES_LIMIT } from "./constants";
import { prisma } from "./db";
import { logAiChat } from "./observability";

type ConversationContextSummaryRow = {
  id: string;
  conversationId: string;
  summary: string;
  coveredThroughMessageId: string | null;
  coveredMessageCount: number;
};

type ConversationContextSummaryDelegate = {
  findUnique: (args: object) => Promise<ConversationContextSummaryRow | null>;
  upsert: (args: object) => Promise<ConversationContextSummaryRow>;
  deleteMany: (args: object) => Promise<unknown>;
};

type SummarizableMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
};

const SUMMARY_TRIGGER_MESSAGE_COUNT = RECENT_MESSAGES_LIMIT + 8;
const SUMMARY_KEEP_RECENT_COUNT = RECENT_MESSAGES_LIMIT;
const MAX_SUMMARY_SOURCE_CHARS = 24_000;

function summaryDelegate(): ConversationContextSummaryDelegate | null {
  const d = (prisma as unknown as { conversationContextSummary?: unknown })
    .conversationContextSummary;
  if (!d || (typeof d !== "object" && typeof d !== "function")) return null;
  return d as ConversationContextSummaryDelegate;
}

function formatMessagesForSummary(messages: SummarizableMessage[]): string {
  const chunks: string[] = [];
  let total = 0;
  for (const message of messages) {
    const label = message.role === "user" ? "User" : "Assistant";
    const text = message.content.trim();
    if (!text) continue;
    const chunk = `${label}: ${text}`;
    total += chunk.length;
    if (total > MAX_SUMMARY_SOURCE_CHARS) break;
    chunks.push(chunk);
  }
  return chunks.join("\n\n");
}

function textFromAnthropicResponse(response: Message): string {
  return response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

async function summarizeConversation(params: {
  previousSummary: string;
  messages: SummarizableMessage[];
  signal?: AbortSignal;
  userId: string;
  conversationId: string;
}): Promise<string> {
  const source = formatMessagesForSummary(params.messages);
  const previous = params.previousSummary.trim();

  const response = await createLightweightMessage(
    {
      max_tokens: 900,
      temperature: 0,
      system:
        "You compress older chat turns for a shopping assistant. Preserve user goals, constraints, preferences, decisions, unresolved questions, products discussed, and commitments. Omit filler and exact wording unless it matters. Write concise bullets, grouped by topic when useful.",
      messages: [
        {
          role: "user",
          content: [
            previous
              ? `Existing summary:\n${previous}`
              : "Existing summary: none",
            `New older turns to fold in:\n${source}`,
            "Return only the updated summary.",
          ].join("\n\n"),
        },
      ],
    },
    {
      signal: params.signal,
      audit: {
        userId: params.userId,
        kind: "conversation_summary",
        conversationId: params.conversationId,
        sequence: 0,
        metadata: {
          deltaMessageCount: params.messages.length,
        },
      },
    },
  );

  return textFromAnthropicResponse(response).slice(0, 6_000);
}

export async function getConversationContextSummary(
  conversationId: string,
): Promise<string> {
  const summaries = summaryDelegate();
  if (!summaries) return "";
  const row = await summaries.findUnique({ where: { conversationId } });
  return row?.summary?.trim() ?? "";
}

export async function invalidateConversationContextSummary(
  conversationId: string,
) {
  const summaries = summaryDelegate();
  if (!summaries) return;
  await summaries.deleteMany({ where: { conversationId } });
}

export async function refreshConversationContextSummary(params: {
  conversationId: string;
  signal?: AbortSignal;
}) {
  const summaries = summaryDelegate();
  if (!summaries) return;

  const conv = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    select: { userId: true },
  });
  if (!conv) return;

  const rows = (await prisma.message.findMany({
    where: {
      conversationId: params.conversationId,
      role: { in: ["user", "assistant"] },
      OR: [
        { status: "completed" },
        { status: "stopped", NOT: { content: "" } },
      ],
      NOT: { status: "failed" },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
    },
  })) as SummarizableMessage[];

  if (rows.length < SUMMARY_TRIGGER_MESSAGE_COUNT) return;

  const cutoff = rows.length - SUMMARY_KEEP_RECENT_COUNT;
  const older = rows.slice(0, cutoff);
  const coveredThrough = older.at(-1);
  if (!coveredThrough) return;

  const existing = await summaries.findUnique({
    where: { conversationId: params.conversationId },
  });
  if (
    existing?.coveredThroughMessageId === coveredThrough.id &&
    existing.coveredMessageCount === older.length
  ) {
    return;
  }

  const startIndex =
    existing?.coveredThroughMessageId
      ? Math.max(
          0,
          older.findIndex((m) => m.id === existing.coveredThroughMessageId) + 1,
        )
      : 0;
  const delta = older.slice(startIndex);
  if (!delta.length) return;

  const summary = await summarizeConversation({
    previousSummary: existing?.summary ?? "",
    messages: delta,
    signal: params.signal,
    userId: conv.userId,
    conversationId: params.conversationId,
  });
  if (!summary) return;

  await summaries.upsert({
    where: { conversationId: params.conversationId },
    create: {
      conversationId: params.conversationId,
      summary,
      coveredThroughMessageId: coveredThrough.id,
      coveredMessageCount: older.length,
    },
    update: {
      summary,
      coveredThroughMessageId: coveredThrough.id,
      coveredMessageCount: older.length,
    },
  });

  logAiChat("info", "conversation_summary_refreshed", {
    conversationId: params.conversationId,
    coveredMessageCount: older.length,
    deltaMessageCount: delta.length,
  });
}

export function kickConversationSummaryRefresh(conversationId: string) {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 60_000);
  void refreshConversationContextSummary({
    conversationId,
    signal: ac.signal,
  })
    .catch((error) => {
      logAiChat("warn", "conversation_summary_refresh_failed", {
        conversationId,
        error,
      });
    })
    .finally(() => clearTimeout(timeout));
}
