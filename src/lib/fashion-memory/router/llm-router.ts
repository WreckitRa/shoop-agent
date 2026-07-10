import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { logAiChat } from "@/lib/ai-chat/observability";
import { tracedLLMCall } from "../observability/traced-llm-call";
import { extractMentionedRelations } from "../people-from-mentions";
import { safeTrim } from "../safe-trim";
import { buildFashionRouterPrompt } from "./prompt";
import {
  FASHION_ROUTER_TOOLS,
  FASHION_ROUTER_TOOL_NAMES,
  formatFashionRouterParseError,
  parseFashionRouterToolInput,
} from "./tool-schema";
import { FASHION_ROUTER_MODEL } from "../models";
import type { FashionRouterContext, FashionRouterResult } from "./types";

const FASHION_ROUTER_TEMPERATURE = Number(
  process.env.FASHION_ROUTER_TEMPERATURE ?? "0.2",
);

export const FALLBACK_CLARIFICATION: FashionRouterResult = {
  move: "ask_clarification",
  reply: "What are you looking for — a single piece, or a full look?",
  questions: [
    {
      text: "What are you looking for — a single piece, or a full look?",
      gap: "garment",
      quick_options: [
        "One piece",
        "Full outfit",
        "A few options to rotate",
        "Other",
      ],
    },
  ],
};

export function messageHasRouterToolUse(message: Message): boolean {
  return message.content.some(
    (block) =>
      block.type === "tool_use" &&
      FASHION_ROUTER_TOOL_NAMES.includes(
        block.name as (typeof FASHION_ROUTER_TOOL_NAMES)[number],
      ),
  );
}

export function messageHasTextWithoutTool(message: Message): boolean {
  const hasText = message.content.some(
    (block) =>
      block.type === "text" && safeTrim(block.text).length > 0,
  );
  return hasText && !messageHasRouterToolUse(message);
}

export function parseRouterMessage(message: Message): FashionRouterResult | null {
  const toolBlock = message.content.find(
    (block) =>
      block.type === "tool_use" &&
      FASHION_ROUTER_TOOL_NAMES.includes(
        block.name as (typeof FASHION_ROUTER_TOOL_NAMES)[number],
      ),
  );
  if (!toolBlock || toolBlock.type !== "tool_use") return null;
  return parseFashionRouterToolInput(toolBlock.name, toolBlock.input);
}

function buildAnthropicMessages(
  context: FashionRouterContext,
): Array<{ role: "user" | "assistant"; content: string }> {
  return context.conversationMessages.map((m) => ({
    role: m.role,
    content: safeTrim(m.content) || "(empty)",
  }));
}

export type RunFashionRouterDeps = {
  createMessage?: typeof tracedLLMCall;
};

function summarizeRouterContent(message: Message): unknown[] {
  return message.content.map((block) => {
    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        name: block.name,
        input: block.input,
      };
    }
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }
    return { type: block.type };
  });
}

export async function runFashionRouter(
  params: {
    context: FashionRouterContext;
    signal?: AbortSignal;
    systemOverride?: string;
    traceId?: string | null;
    stage?: string;
  },
  deps: RunFashionRouterDeps = {},
): Promise<FashionRouterResult> {
  const createMessage = deps.createMessage ?? tracedLLMCall;
  const system = params.systemOverride ?? buildFashionRouterPrompt(params.context);
  const messages = buildAnthropicMessages(params.context);
  const stage = params.stage ?? "router";

  logAiChat("info", "fashion_router_prompt", {
    traceId: params.traceId,
    stage,
    model: FASHION_ROUTER_MODEL,
    temperature: Number.isFinite(FASHION_ROUTER_TEMPERATURE)
      ? FASHION_ROUTER_TEMPERATURE
      : 0.2,
    system_prompt: system,
    input_messages: messages,
    tool_names: FASHION_ROUTER_TOOL_NAMES,
    tool_choice: { type: "any" },
  });

  const call = (callStage: string) =>
    createMessage({
      traceId: params.traceId,
      stage: callStage,
      model: FASHION_ROUTER_MODEL,
      maxTokens: 2048,
      temperature: Number.isFinite(FASHION_ROUTER_TEMPERATURE)
        ? FASHION_ROUTER_TEMPERATURE
        : 0.2,
      systemPrompt: system,
      inputMessages: messages,
      tools: FASHION_ROUTER_TOOLS,
      toolChoice: { type: "any" },
      signal: params.signal,
    });

  let response = await call(stage);
  if (messageHasTextWithoutTool(response)) {
    logAiChat("warn", "fashion_router_text_without_tool_retry", {
      stopReason: response.stop_reason,
      raw_content: summarizeRouterContent(response),
    });
    response = await call(stage === "router" ? "router_retry" : `${stage}_retry`);
    if (messageHasTextWithoutTool(response)) {
      logAiChat("warn", "fashion_router_text_without_tool_fallback", {
        stopReason: response.stop_reason,
        raw_content: summarizeRouterContent(response),
        fallback: FALLBACK_CLARIFICATION,
      });
      return FALLBACK_CLARIFICATION;
    }
  }

  const toolBlock = response.content.find(
    (block) =>
      block.type === "tool_use" &&
      FASHION_ROUTER_TOOL_NAMES.includes(
        block.name as (typeof FASHION_ROUTER_TOOL_NAMES)[number],
      ),
  );
  const parsed = toolBlock && toolBlock.type === "tool_use"
    ? parseFashionRouterToolInput(toolBlock.name, toolBlock.input)
    : null;

  logAiChat("info", "fashion_router_output", {
    traceId: params.traceId,
    stage,
    stop_reason: response.stop_reason,
    raw_content: summarizeRouterContent(response),
    parsed_result: parsed,
    parse_error:
      !parsed && toolBlock && toolBlock.type === "tool_use"
        ? formatFashionRouterParseError(toolBlock.name, toolBlock.input)
        : parsed
          ? null
          : "no router tool block",
  });

  if (parsed) return parsed;

  logAiChat("warn", "fashion_router_invalid_tool_output", {
    stopReason: response.stop_reason,
    toolName: toolBlock?.type === "tool_use" ? toolBlock.name : null,
    parseError:
      toolBlock?.type === "tool_use"
        ? formatFashionRouterParseError(toolBlock.name, toolBlock.input)
        : "no router tool block",
  });

  // If the thread already has shoppable signal, prefer a deterministic brief
  // over a generic clarification that drops the ask.
  try {
    const { buildFallbackBriefFromContext } = await import(
      "../observability/fallback-brief"
    );
    const fallback = buildFallbackBriefFromContext({
      context: params.context,
      reason: "router_parse_failed",
    });
    if (fallback.brief.garments.length > 0) {
      logAiChat("info", "fashion_router_fallback_brief", {
        traceId: params.traceId,
        garments: fallback.brief.garments,
        request_type: fallback.brief.request_type,
      });
      return { move: "ready_to_search", brief: fallback.brief };
    }
  } catch (error) {
    logAiChat("warn", "fashion_router_fallback_brief_failed", {
      error: String(error).slice(0, 160),
    });
  }

  return FALLBACK_CLARIFICATION;
}

export function resolveBriefRecipientPersonId(params: {
  brief: import("./types").FashionSearchBrief;
  personShortIds: Record<string, string>;
  people: import("../types").PersonRow[];
  /** Recent user text — when it clearly names a gift relation, prefer that person over self. */
  userMessage?: string | null;
}): string | null {
  const peopleIds = new Set(params.people.map((p) => p.id));
  const self = params.people.find((p) => p.relation === "self");

  const mentionedRelations = params.userMessage
    ? extractMentionedRelations(params.userMessage)
    : [];
  const mentionedPeople = mentionedRelations
    .map((rel) => params.people.find((p) => p.relation === rel))
    .filter((p): p is import("../types").PersonRow => Boolean(p));

  const ref = safeTrim(params.brief.recipient_person_id).replace(/^#/, "");
  let resolved: string | null = null;
  if (peopleIds.has(ref)) {
    resolved = ref;
  } else {
    const fromShort = params.personShortIds[ref.toLowerCase()];
    if (fromShort && peopleIds.has(fromShort)) resolved = fromShort;
    else {
      for (const [short, id] of Object.entries(params.personShortIds)) {
        if (short === ref.toLowerCase() && peopleIds.has(id)) {
          resolved = id;
          break;
        }
      }
    }
  }

  // Gift cue in the message beats a self (or unknown) brief recipient.
  if (mentionedPeople.length === 1) {
    const giftId = mentionedPeople[0]!.id;
    if (!resolved || resolved === self?.id) return giftId;
  }

  if (resolved) return resolved;
  if (mentionedPeople[0]) return mentionedPeople[0].id;
  return self?.id ?? null;
}
