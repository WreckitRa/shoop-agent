import type { ConversationSummary } from "./types";

/** Prisma `where` clause — conversations the user can see in sidebar / resume hints. */
export function userVisibleConversationWhere(
  userId: string,
  options?: { includeArchived?: boolean },
) {
  return {
    userId,
    deletedAt: null,
    ...(options?.includeArchived ? {} : { archived: false }),
  } as const;
}

export function isConversationSummaryVisible(c: ConversationSummary): boolean {
  return !c.deletedAt && !c.archived;
}
