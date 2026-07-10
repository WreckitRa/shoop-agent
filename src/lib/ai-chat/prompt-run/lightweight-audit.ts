import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import type { PromptRunKind } from "@prisma/client";
import type { InputJsonValue } from "../prisma-types";
import {
  formatAnthropicMessageResult,
  formatPromptBundle,
  systemPromptText,
} from "./format";
import { recordPromptRun } from "./record";

export type LightweightPromptAudit = {
  userId: string;
  kind: PromptRunKind;
  conversationId?: string | null;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
  sequence?: number;
  metadata?: InputJsonValue | null;
};

/** Persist a completed lightweight Anthropic call (Haiku classifiers, titles, etc.). */
export function recordLightweightPromptRun(
  params: MessageCreateParamsNonStreaming,
  msg: Message,
  audit: LightweightPromptAudit,
): void {
  const system = systemPromptText(params.system);
  const messages = (params.messages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  recordPromptRun({
    userId: audit.userId,
    conversationId: audit.conversationId ?? null,
    userMessageId: audit.userMessageId ?? null,
    assistantMessageId: audit.assistantMessageId ?? null,
    kind: audit.kind,
    model: msg.model,
    sequence: audit.sequence ?? 0,
    promptText: formatPromptBundle(system, messages),
    resultText: formatAnthropicMessageResult(msg),
    metadata: audit.metadata ?? undefined,
  });
}
