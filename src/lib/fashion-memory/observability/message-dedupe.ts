import { safeTrim } from "../safe-trim";

export function normalizeUserMessageText(text: string): string {
  return safeTrim(text).toLowerCase();
}

/** Collapse consecutive identical user messages (no assistant between). */
export function dedupeConsecutiveUserMessages<
  T extends { role: string; content: string },
>(messages: T[]): T[] {
  const out: T[] = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (
      msg.role === "user" &&
      prev?.role === "user" &&
      normalizeUserMessageText(prev.content) === normalizeUserMessageText(msg.content)
    ) {
      continue;
    }
    out.push(msg);
  }
  return out;
}

export function isConsecutiveDuplicateUserTurn(params: {
  priorRole: string | null | undefined;
  priorContent: string | null | undefined;
  newContent: string;
}): boolean {
  if (params.priorRole !== "user") return false;
  return (
    normalizeUserMessageText(params.priorContent ?? "") ===
    normalizeUserMessageText(params.newContent)
  );
}
