import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { logAiChat } from "@/lib/ai-chat/observability";
import { recordPipelineEvent } from "../observability/trace";
import { tracedLLMCall } from "../observability/traced-llm-call";
import { extractMentionedRelations } from "../people-from-mentions";
import { safeTrim } from "../safe-trim";
import { recordRouterEscalation } from "./escalation-metrics";
import {
  assessRouterEscalation,
  latestUserText,
  userMentionsAccessories,
} from "./garment-family";
import {
  buildFashionRouterPrompt,
  buildFashionRouterSystemParts,
} from "./prompt";
import {
  FASHION_ROUTER_TOOLS,
  FASHION_ROUTER_TOOL_NAMES,
  formatFashionRouterParseError,
  parseFashionRouterToolInput,
} from "./tool-schema";
import {
  FASHION_ROUTER_ESCALATION_ENABLED,
  FASHION_ROUTER_ESCALATION_MODEL,
  FASHION_ROUTER_MODEL,
} from "../models";
import type { FashionRouterContext, FashionRouterResult } from "./types";

const FASHION_ROUTER_TEMPERATURE = Number(
  process.env.FASHION_ROUTER_TEMPERATURE ?? "0.2",
);

export const FALLBACK_CLARIFICATION: FashionRouterResult = {
  move: "ask_clarification",
  reply: "What are you looking for?",
  questions: [
    {
      text: "What are you looking for?",
      gap: "garment",
      quick_options: [
        "Shirt or top",
        "Dress",
        "Shoes",
        "Accessories",
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
    /** Force Opus-class model for this call (escalation already decided). */
    modelOverride?: string;
  },
  deps: RunFashionRouterDeps = {},
): Promise<FashionRouterResult> {
  const createMessage = deps.createMessage ?? tracedLLMCall;
  const parts = params.systemOverride
    ? null
    : buildFashionRouterSystemParts(params.context);
  const system =
    params.systemOverride ?? parts?.full ?? buildFashionRouterPrompt(params.context);
  /** Gate/system overrides stay uncached (dynamic); happy path caches static rules. */
  const systemCachedPrefix = parts?.cachedPrefix;
  const systemUncachedSuffix = params.systemOverride
    ? params.systemOverride
    : parts?.uncachedSuffix;
  const messages = buildAnthropicMessages(params.context);
  const stage = params.stage ?? "router";
  const temperature = Number.isFinite(FASHION_ROUTER_TEMPERATURE)
    ? FASHION_ROUTER_TEMPERATURE
    : 0.2;

  const isValidationRetry =
    stage.includes("retry") || stage === "gate_retry";

  const runOnce = async (opts: {
    callStage: string;
    model: string;
  }): Promise<FashionRouterResult> => {
    logAiChat("info", "fashion_router_prompt", {
      traceId: params.traceId,
      stage: opts.callStage,
      model: opts.model,
      temperature,
      system_prompt: system,
      system_cached_prefix_chars: systemCachedPrefix?.length ?? 0,
      system_uncached_suffix_chars: systemUncachedSuffix?.length ?? 0,
      input_messages: messages,
      tool_names: FASHION_ROUTER_TOOL_NAMES,
      tool_choice: { type: "any" },
    });

    const call = (callStage: string) =>
      createMessage({
        traceId: params.traceId,
        stage: callStage,
        model: opts.model,
        maxTokens: 2048,
        temperature,
        systemPrompt: system,
        ...(params.systemOverride
          ? { disablePromptCache: true }
          : systemCachedPrefix
            ? {
                systemCachedPrefix,
                systemUncachedSuffix: systemUncachedSuffix ?? "",
              }
            : {}),
        inputMessages: messages,
        tools: FASHION_ROUTER_TOOLS,
        toolChoice: { type: "any" },
        signal: params.signal,
      });

    let response = await call(opts.callStage);
    if (messageHasTextWithoutTool(response)) {
      logAiChat("warn", "fashion_router_text_without_tool_retry", {
        stopReason: response.stop_reason,
        raw_content: summarizeRouterContent(response),
      });
      response = await call(
        opts.callStage === "router"
          ? "router_retry"
          : `${opts.callStage}_retry`,
      );
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
    const parsed =
      toolBlock && toolBlock.type === "tool_use"
        ? parseFashionRouterToolInput(toolBlock.name, toolBlock.input)
        : null;

    logAiChat("info", "fashion_router_output", {
      traceId: params.traceId,
      stage: opts.callStage,
      model: opts.model,
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

    try {
      const { buildFallbackBriefFromContext } = await import(
        "../observability/fallback-brief"
      );
      const fallback = buildFallbackBriefFromContext({
        context: params.context,
        reason: "router_parse_failed",
      });
      if (fallback?.brief.garments.length) {
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
  };

  const baseModel = params.modelOverride ?? FASHION_ROUTER_MODEL;
  let result = await runOnce({ callStage: stage, model: baseModel });

  // Escalation: weird ~5% of turns get one Opus-class re-run.
  if (
    FASHION_ROUTER_ESCALATION_ENABLED &&
    !params.modelOverride &&
    baseModel !== FASHION_ROUTER_ESCALATION_MODEL
  ) {
    const userText = latestUserText(params.context.conversationMessages);
    const garments =
      result.move === "ready_to_search" ? result.brief.garments : [];
    const askedClothingSizesForAccessories =
      result.move === "ask_clarification" &&
      userMentionsAccessories(userText) &&
      result.questions.some(
        (q) =>
          q.gap === "size" &&
          (q.garment_type === "tops" ||
            q.garment_type === "shoes" ||
            q.garment_type === "dresses" ||
            /top|shoe/i.test(q.text)),
      );
    const reasons = assessRouterEscalation({
      userText,
      garments,
      askedClothingSizesForAccessories,
      // gate_retry no longer uses LLM by default; keep validation_retry for
      // text-without-tool router_retry only.
      validationRetry: isValidationRetry && stage !== "gate_retry",
      reaskAfterAnswer:
        result.move === "ask_clarification" &&
        /\b(again|still need|already told)\b/i.test(userText),
    });
    if (reasons.length) {
      recordRouterEscalation(true);
      recordPipelineEvent({
        traceId: params.traceId,
        stage: "router_escalated",
        payload: {
          reasons,
          from_model: baseModel,
          to_model: FASHION_ROUTER_ESCALATION_MODEL,
          prior_move: result.move,
          prior_garments: garments,
        },
      });
      logAiChat("info", "fashion_router_escalated", {
        traceId: params.traceId,
        reasons,
        from_model: baseModel,
        to_model: FASHION_ROUTER_ESCALATION_MODEL,
      });
      result = await runOnce({
        callStage: "router_escalated",
        model: FASHION_ROUTER_ESCALATION_MODEL,
      });
    } else {
      recordRouterEscalation(false);
    }
  }

  return result;
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
