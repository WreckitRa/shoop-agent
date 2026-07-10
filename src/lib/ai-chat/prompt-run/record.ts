import type { PromptRunKind } from "@prisma/client";
import { prisma } from "../db";
import type { InputJsonValue } from "../prisma-types";
import { logAiChat } from "../observability";

const MAX_FIELD_CHARS = 500_000;

function clampField(text: string): string {
  if (text.length <= MAX_FIELD_CHARS) return text;
  return `${text.slice(0, MAX_FIELD_CHARS)}\n\n… [truncated at ${MAX_FIELD_CHARS} chars]`;
}

export type RecordPromptRunInput = {
  userId: string;
  conversationId?: string | null;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
  kind: PromptRunKind;
  model?: string | null;
  sequence: number;
  iteration?: number | null;
  promptText: string;
  resultText: string;
  metadata?: InputJsonValue | null;
};

/** Best-effort audit write — never blocks or throws to callers. */
export function recordPromptRun(input: RecordPromptRunInput): void {
  void prisma.promptRun
    .create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId ?? null,
        userMessageId: input.userMessageId ?? null,
        assistantMessageId: input.assistantMessageId ?? null,
        kind: input.kind,
        model: input.model ?? null,
        sequence: input.sequence,
        iteration: input.iteration ?? null,
        promptText: clampField(input.promptText),
        resultText: clampField(input.resultText),
        metadata: input.metadata ?? undefined,
      },
    })
    .catch((error) => {
      logAiChat("warn", "prompt_run_persist_failed", {
        kind: input.kind,
        conversationId: input.conversationId,
        error,
      });
    });
}
