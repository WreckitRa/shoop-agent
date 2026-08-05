/**
 * Types inferred from the real Prisma proxy in `./db` (via `typeof import`).
 * Avoids flaky IDE resolution for `@prisma/client` model exports and generic `PrismaClient["delegate"]` indexing.
 */
type PrismaDb = typeof import("./db").prisma;

/** Callback argument for interactive `prisma.$transaction(async (tx) => …)`. */
export type InteractiveTransactionClient = Omit<
  PrismaDb,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type { InputJsonValue } from "@prisma/client/runtime/library";

export type ConversationRecord = Awaited<
  ReturnType<PrismaDb["conversation"]["create"]>
>;

export type MessageRecord = Awaited<
  ReturnType<PrismaDb["message"]["create"]>
>;

/** Fields we patch from chat UI (`conversationPatchFromSettings`). */
export type ConversationUpdateData = Partial<
  Pick<
    ConversationRecord,
    "model" | "temperature" | "maxTokens" | "responseStyle" | "systemPrompt"
  >
>;
