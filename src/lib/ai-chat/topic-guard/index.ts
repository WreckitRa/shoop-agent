import { logAiChat } from "../observability";
import {
  classifyTopicGuard,
  resolveBlockCategory,
  TOPIC_GUARD_CLASSIFIER_SYSTEM,
  topicGuardClassifierUserPrompt,
  type TopicGuardClassification,
} from "./classifier";
import { formatPromptBundle } from "../prompt-run/format";
import { greetingResponse, refusalForCategory } from "./messages";
import { loadTopicGuardHistory, type TopicGuardHistoryTurn } from "./history";
import { normalizeTopicGuardInput } from "./normalize";
import type { TopicGuardBlockCategory, TopicGuardDecision } from "./types";

export type { TopicGuardDecision, TopicGuardMetaV1 } from "./types";
export type { TopicGuardHistoryTurn } from "./history";
export { topicGuardSystemAddendum } from "./prompt";

function isTopicGuardDisabled(): boolean {
  return process.env.AI_CHAT_TOPIC_GUARD_DISABLED === "1";
}

function blockDecision(
  category: TopicGuardBlockCategory,
  reason: string,
): TopicGuardDecision {
  return {
    allowed: false,
    category,
    source: "classifier",
    reason,
    userMessage: refusalForCategory(category),
  };
}

function decisionFromClassification(
  classified: TopicGuardClassification,
): TopicGuardDecision {
  if (classified.isPromptInjection) {
    return blockDecision("jailbreak", "classifier_prompt_injection");
  }

  if (
    classified.isGreetingOnly &&
    !classified.isOffTopic &&
    !classified.isPromptInjection
  ) {
    return {
      allowed: true,
      category: "greeting",
      source: "classifier",
      reason: "classifier_greeting_only",
      cannedResponse: greetingResponse(),
    };
  }

  if (classified.shouldAllow && classified.isShoppingRelated) {
    return {
      allowed: true,
      category: "shopping",
      source: "classifier",
      reason: "classifier_allowed",
    };
  }

  const category = resolveBlockCategory(classified);
  return blockDecision(category, "classifier_blocked");
}

/**
 * Decide whether a user turn may proceed to the main shopping model.
 * Uses a cheap LLM classifier with recent conversation history for context.
 */
export type TopicGuardEvaluation = {
  decision: TopicGuardDecision;
  classifier: TopicGuardClassification | null;
  history: TopicGuardHistoryTurn[];
};

export async function evaluateTopicGuard(
  userMessage: string,
  options?: {
    signal?: AbortSignal;
    conversationId?: string;
    excludeMessageIds?: string[];
  },
): Promise<TopicGuardEvaluation> {
  if (isTopicGuardDisabled()) {
    return {
      decision: {
        allowed: true,
        category: "shopping",
        source: "disabled",
        reason: "topic_guard_disabled",
      },
      classifier: null,
      history: [],
    };
  }

  const text = normalizeTopicGuardInput(userMessage);
  if (!text) {
    return {
      decision: {
        allowed: true,
        category: "shopping",
        source: "classifier",
        reason: "empty_message",
      },
      classifier: null,
      history: [],
    };
  }

  let history: TopicGuardHistoryTurn[] = [];
  if (options?.conversationId) {
    try {
      history = await loadTopicGuardHistory(
        options.conversationId,
        options.excludeMessageIds ?? [],
      );
    } catch (error) {
      logAiChat("warn", "topic_guard_history_load_failed", {
        conversationId: options.conversationId,
        error,
      });
    }
  }

  try {
    const classified = await classifyTopicGuard(text, {
      signal: options?.signal,
      history,
    });
    if (classified) {
      return {
        decision: decisionFromClassification(classified),
        classifier: classified,
        history,
      };
    }
  } catch (error) {
    logAiChat("warn", "topic_guard_classifier_failed", { error: String(error) });
  }

  logAiChat("warn", "topic_guard_classifier_unavailable_fail_open", {
    conversationId: options?.conversationId,
    historyTurnCount: history.length,
  });

  return {
    decision: {
      allowed: true,
      category: "shopping",
      source: "classifier",
      reason: "classifier_failed_fail_open",
    },
    classifier: null,
    history,
  };
}

/** Exact classifier prompt text (for admin audit). */
export function formatTopicGuardClassifierPrompt(
  userMessage: string,
  history: TopicGuardHistoryTurn[] = [],
): string {
  const text = normalizeTopicGuardInput(userMessage);
  if (!text) return "";
  return formatPromptBundle(TOPIC_GUARD_CLASSIFIER_SYSTEM, [
    {
      role: "user",
      content: topicGuardClassifierUserPrompt({
        latestMessage: text,
        history,
      }),
    },
  ]);
}

export function toTopicGuardMetadata(
  decision: TopicGuardDecision,
): import("./types").TopicGuardMetaV1 {
  if (decision.allowed) {
    return {
      version: 1,
      blocked: false,
      category: decision.category,
      source: decision.source,
      reason: decision.reason,
    };
  }
  return {
    version: 1,
    blocked: true,
    category: decision.category,
    source: decision.source,
    reason: decision.reason,
  };
}
