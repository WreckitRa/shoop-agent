import type { ChatMessage, ConversationBranchSummary } from "../types";

/**
 * Patch in-memory messages when the server creates intent splits after send.
 * Matches server behavior: anchor user message + immediately following assistant
 * receive the new branch id.
 */
export function applyIntentBranchSplitsToMessages(
  messages: ChatMessage[],
  branches: ConversationBranchSummary[],
): ChatMessage[] {
  if (branches.length === 0) return messages;

  let next = messages;
  for (const branch of branches) {
    if (branch.index <= 0 || !branch.anchorMessageId) continue;
    const anchorIdx = next.findIndex((m) => m.id === branch.anchorMessageId);
    if (anchorIdx < 0) continue;

    next = next.map((m, i) => {
      if (i === anchorIdx) {
        return m.branchId === branch.id ? m : { ...m, branchId: branch.id };
      }
      if (
        i === anchorIdx + 1 &&
        next[i]?.role === "assistant" &&
        m.branchId !== branch.id
      ) {
        return { ...m, branchId: branch.id };
      }
      return m;
    });
  }
  return next;
}
