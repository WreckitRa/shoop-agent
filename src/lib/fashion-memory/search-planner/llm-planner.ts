import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { logAiChat } from "@/lib/ai-chat/observability";
import { tracedLLMCall } from "../observability/traced-llm-call";
import { safeTrim } from "../safe-trim";
import {
  buildSearchPlannerPrompt,
  buildSearchPlannerUserMessage,
} from "./prompt";
import {
  PLAN_SEARCH_TOOL,
  PLAN_SEARCH_TOOL_NAME,
  parsePlanSearchInput,
  type PlanSearchInput,
} from "./tool-schema";
import { FASHION_SEARCH_PLANNER_MODEL } from "../models";
import { PLANNER_HARD_MS } from "../pipeline-cutoffs";
import type { FashionSearchBrief } from "../router/types";

const SEARCH_PLANNER_TEMPERATURE = Number(
  process.env.FASHION_SEARCH_PLANNER_TEMPERATURE ?? "0.2",
);

export function messageHasPlanSearchToolUse(message: Message): boolean {
  return message.content.some(
    (block) => block.type === "tool_use" && block.name === PLAN_SEARCH_TOOL_NAME,
  );
}

export function messageHasTextWithoutPlanTool(message: Message): boolean {
  const hasText = message.content.some(
    (block) =>
      block.type === "text" && safeTrim(block.text).length > 0,
  );
  return hasText && !messageHasPlanSearchToolUse(message);
}

export function parsePlanSearchMessage(message: Message): PlanSearchInput | null {
  const toolBlock = message.content.find(
    (block) => block.type === "tool_use" && block.name === PLAN_SEARCH_TOOL_NAME,
  );
  if (!toolBlock || toolBlock.type !== "tool_use") return null;
  return parsePlanSearchInput(toolBlock.input);
}

export type RunSearchPlannerDeps = {
  createMessage?: typeof tracedLLMCall;
};

export async function runSearchPlanner(
  params: {
    brief: FashionSearchBrief;
    recipientProfile: string;
    currentDate: string;
    signal?: AbortSignal;
    traceId?: string | null;
  },
  deps: RunSearchPlannerDeps = {},
): Promise<PlanSearchInput | null> {
  const createMessage = deps.createMessage ?? tracedLLMCall;
  const system = buildSearchPlannerPrompt();
  const userContent = buildSearchPlannerUserMessage({
    brief: params.brief,
    recipientProfile: params.recipientProfile,
    currentDate: params.currentDate,
  });

  const call = (stage: string) => {
    const hard = AbortSignal.timeout(PLANNER_HARD_MS);
    const signal =
      params.signal && typeof AbortSignal.any === "function"
        ? AbortSignal.any([params.signal, hard])
        : params.signal ?? hard;
    return createMessage({
      traceId: params.traceId,
      stage,
      model: FASHION_SEARCH_PLANNER_MODEL,
      maxTokens: 4096,
      temperature: Number.isFinite(SEARCH_PLANNER_TEMPERATURE)
        ? SEARCH_PLANNER_TEMPERATURE
        : 0.2,
      systemPrompt: system,
      inputMessages: [{ role: "user", content: userContent }],
      tools: [PLAN_SEARCH_TOOL],
      toolChoice: { type: "tool", name: PLAN_SEARCH_TOOL_NAME },
      signal,
    });
  };

  let response = await call("planner");
  if (messageHasTextWithoutPlanTool(response)) {
    // v1.1: ONE live planner call — do not burn a second LLM on tool repair.
    // Deterministic fallback plan is applied upstream when parse fails.
    logAiChat("warn", "fashion_search_planner_text_without_tool_no_retry", {
      stopReason: response.stop_reason,
    });
  }

  const parsed = parsePlanSearchMessage(response);
  if (!parsed) {
    logAiChat("warn", "fashion_search_planner_invalid_tool_output", {
      stopReason: response.stop_reason,
    });
  }
  return parsed;
}
