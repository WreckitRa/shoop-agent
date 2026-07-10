import type {
  ConversationBranchSummary,
  ConversationSummary,
  SidebarConversationNode,
} from "@/lib/ai-chat/types";

export function parseSidebarNodes(data: unknown): SidebarConversationNode[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item): SidebarConversationNode[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (row.conversation && typeof row.conversation === "object") {
      const conversation = row.conversation as ConversationSummary;
      const branches = Array.isArray(row.branches)
        ? (row.branches as ConversationBranchSummary[])
        : [];
      return [{ conversation, branches }];
    }
    return [{ conversation: item as ConversationSummary, branches: [] }];
  });
}

export function sidebarNodesToConversations(
  nodes: SidebarConversationNode[],
): ConversationSummary[] {
  return nodes.map((n) => n.conversation);
}
