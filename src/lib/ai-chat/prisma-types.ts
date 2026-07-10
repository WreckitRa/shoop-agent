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

/** Row shape from `prisma.shoppingMemory.findMany`. */
export type ShoppingMemoryRow = Awaited<
  ReturnType<PrismaDb["shoppingMemory"]["findMany"]>
>[number];

/** Row shape from `prisma.memoryObservation.findMany`. */
export type MemoryObservationRow = Awaited<
  ReturnType<PrismaDb["memoryObservation"]["findMany"]>
>[number];

/** Prisma enum unions used by shopping-memory mapping (derived from delegates). */
export type MemoryObservationSignalType =
  MemoryObservationRow["signalType"];
export type MemoryObservationSource = MemoryObservationRow["source"];
export type ShoppingMemoryScope = ShoppingMemoryRow["scope"];
export type ShoppingMemoryType = ShoppingMemoryRow["type"];

/** Result of `findUnique` on shopping profile (includes `null`). */
export type ShoppingProfileSummaryRow = Awaited<
  ReturnType<PrismaDb["shoppingProfileSummary"]["findUnique"]>
>;
