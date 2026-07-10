import { prisma } from "../db";

export type TopicGuardHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

/** Recent turns for topic-guard context (excludes the in-flight user message). */
export const TOPIC_GUARD_HISTORY_LIMIT = 12;

function rowToTurn(row: {
  role: string;
  content: string | null;
}): TopicGuardHistoryTurn | null {
  if (row.role !== "user" && row.role !== "assistant") return null;
  const content = (row.content ?? "").trim();
  if (!content) return null;
  return { role: row.role, content };
}

export async function loadTopicGuardHistory(
  conversationId: string,
  excludeMessageIds: string[] = [],
): Promise<TopicGuardHistoryTurn[]> {
  const exclude = new Set(excludeMessageIds);
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      id: exclude.size ? { notIn: [...exclude] } : undefined,
      role: { in: ["user", "assistant"] },
      OR: [
        { status: "completed" },
        { status: "stopped", NOT: { content: "" } },
      ],
      NOT: { status: "failed" },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TOPIC_GUARD_HISTORY_LIMIT,
    select: {
      role: true,
      content: true,
    },
  });

  const turns: TopicGuardHistoryTurn[] = [];
  for (const row of [...rows].reverse()) {
    const turn = rowToTurn(row);
    if (turn) turns.push(turn);
  }
  return turns;
}

export function formatTopicGuardHistoryBlock(
  history: TopicGuardHistoryTurn[],
): string {
  if (!history.length) return "";
  const lines = history.map(
    (t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`,
  );
  return `<conversation_history>\n${lines.join("\n\n")}\n</conversation_history>`;
}
