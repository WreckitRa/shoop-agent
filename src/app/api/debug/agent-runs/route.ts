import { prisma } from "@/lib/ai-chat/db";
import {
  isAgentDebugEnabled,
  QUERY_PLANNER_PROMPT_KIND,
  SEARCH_PIPELINE_PROMPT_KIND,
  type AgentDebugRunsResponse,
} from "@/lib/ai-chat/agent-debug";
import { getAuthContext } from "@/lib/auth/session";
import type { PromptRunKind } from "@prisma/client";

const PROMPT_RUN_SELECT = {
  id: true,
  kind: true,
  model: true,
  sequence: true,
  iteration: true,
  promptText: true,
  resultText: true,
  metadata: true,
  createdAt: true,
  userMessageId: true,
  assistantMessageId: true,
} as const;

export async function GET(req: Request) {
  if (!isAgentDebugEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId")?.trim();
  const userMessageId = url.searchParams.get("userMessageId")?.trim() || undefined;
  const assistantMessageId =
    url.searchParams.get("assistantMessageId")?.trim() || undefined;
  const kindParam = url.searchParams.get("kind")?.trim() as PromptRunKind | undefined;

  if (!conversationId) {
    return Response.json({ error: "conversationId is required." }, { status: 400 });
  }

  const owned = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: auth.userId },
    select: { id: true },
  });
  if (!owned) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const messageFilter = userMessageId
    ? { userMessageId }
    : assistantMessageId
      ? { assistantMessageId }
      : {};

  const baseWhere = {
    conversationId,
    userId: auth.userId,
    ...messageFilter,
  };

  const fetchPlanner =
    !kindParam || kindParam === QUERY_PLANNER_PROMPT_KIND;
  const fetchPipeline =
    !kindParam || kindParam === SEARCH_PIPELINE_PROMPT_KIND;

  const [promptRuns, pipelineRuns] = await Promise.all([
    fetchPlanner
      ? prisma.promptRun.findMany({
          where: {
            ...baseWhere,
            kind: QUERY_PLANNER_PROMPT_KIND,
          },
          orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
          select: PROMPT_RUN_SELECT,
        })
      : Promise.resolve([]),
    fetchPipeline
      ? prisma.promptRun.findMany({
          where: {
            ...baseWhere,
            kind: SEARCH_PIPELINE_PROMPT_KIND,
          },
          orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
          select: PROMPT_RUN_SELECT,
        })
      : Promise.resolve([]),
  ]);

  const body: AgentDebugRunsResponse = {
    promptRuns: promptRuns.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    pipelineRuns: pipelineRuns.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  };

  return Response.json(body);
}
