import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import {
  formatAnthropicMessageResult,
  formatPromptBundle,
  systemPromptText,
} from "../prompt-run/format";
import type { LightweightPromptAudit } from "../prompt-run/lightweight-audit";
import { recordLightweightPromptRun } from "../prompt-run/lightweight-audit";
import type { InputJsonValue } from "../prisma-types";

export type QueryPlannerStep =
  | "budget_angles"
  | "portfolio"
  | "gift_portfolio"
  | "gift_portfolio_retry"
  | "gift_direction_focus";

export type QueryPlannerRunDebug = {
  step: QueryPlannerStep;
  model: string;
  promptText: string;
  resultText: string;
  ts: number;
};

export type QueryPlannerDebugHooks = {
  audit?: Omit<LightweightPromptAudit, "kind">;
  sequence?: number;
  /** Called before each persisted planner run to allocate prompt sequence. */
  nextSequence?: () => number;
  onRun?: (run: QueryPlannerRunDebug) => void;
  /** Merged into PromptRun.metadata (e.g. searchKey). */
  extraMetadata?: Record<string, unknown>;
};

function userMessageText(
  messages: MessageCreateParamsNonStreaming["messages"],
): string {
  if (!messages?.length) return "";
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return "";
  if (typeof last.content === "string") return last.content;
  return last.content
    .map((block) => {
      if (block.type === "text") return block.text;
      return JSON.stringify(block, null, 2);
    })
    .join("\n");
}

/** Full prompt bundle for terminal debugging (system + user). */
export function formatQueryPlannerPrompt(
  params: MessageCreateParamsNonStreaming,
): string {
  const system = systemPromptText(params.system);
  const user = userMessageText(params.messages);
  return formatPromptBundle(system, [{ role: "user", content: user }]);
}

const SHOPIFY_QUERY_PLANNER_STEPS: QueryPlannerStep[] = [
  "portfolio",
  "gift_portfolio",
  "gift_portfolio_retry",
  "gift_direction_focus",
];

export function logShopifyQueryPlannerPrompt(
  step: QueryPlannerStep,
  promptText: string,
): void {
  if (process.env.QUERY_PLANNER_DEBUG !== "1") return;
  if (!SHOPIFY_QUERY_PLANNER_STEPS.includes(step)) return;
  console.log(
    "=== Shopify search query planner — PROMPT ===\n" + promptText,
  );
}

export function logShopifyQueryPlannerResult(
  step: QueryPlannerStep,
  resultText: string,
): void {
  if (process.env.QUERY_PLANNER_DEBUG !== "1") return;
  if (!SHOPIFY_QUERY_PLANNER_STEPS.includes(step)) return;
  console.log(
    "=== Shopify search query planner — RESULT ===\n" + resultText,
  );
}

/** Persist + surface a completed query-planner LLM call. */
export function recordQueryPlannerRun(
  params: MessageCreateParamsNonStreaming,
  msg: Message,
  step: QueryPlannerStep,
  hooks?: QueryPlannerDebugHooks,
): QueryPlannerRunDebug {
  const promptText = formatQueryPlannerPrompt(params);
  const resultText = formatAnthropicMessageResult(msg);
  const run: QueryPlannerRunDebug = {
    step,
    model: msg.model,
    promptText,
    resultText,
    ts: Date.now(),
  };

  if (hooks?.audit) {
    recordLightweightPromptRun(params, msg, {
      ...hooks.audit,
      kind: "search_query_planner",
      sequence:
        hooks.nextSequence?.() ??
        hooks.sequence ??
        hooks.audit.sequence ??
        0,
      metadata: {
        step,
        ...(hooks.extraMetadata ?? {}),
      } as InputJsonValue,
    });
  }

  hooks?.onRun?.(run);

  logShopifyQueryPlannerResult(step, resultText);

  return run;
}
