import { extractShoppingMemory } from "./extractor";
import {
  isTrivialMemoryMessage,
  shouldRunShoppingExtractor,
} from "./memory-gate";
import {
  classifyForShoppingMemory,
  classifierAllowsDeepExtraction,
  type ShoppingMemoryClassification,
} from "./classify-message";
import { logAiChat } from "../observability";
import { writeMemoryFromExtraction } from "./writer";
import { projectExtractionToTypedTables } from "./projector";
import { refreshShoppingProfileSummary } from "./summary";
import { isAbortLike, memoryPipelineAborted } from "./abort";

function classifierTelemetry(c: ShoppingMemoryClassification | null) {
  if (!c) return null;
  return {
    isShoppingRelevant: c.isShoppingRelevant,
    containsPreference: c.containsPreference,
    containsSize: c.containsSize,
    containsBudget: c.containsBudget,
    containsBrand: c.containsBrand,
    containsProductFeedback: c.containsProductFeedback,
    containsGiftContext: c.containsGiftContext,
    containsIntent: c.containsIntent,
    shouldRunDeepExtraction: c.shouldRunDeepExtraction,
  };
}

function logMemory(event: string, payload: Record<string, unknown>) {
  logAiChat("info", `shopping_memory_${event}`, payload);
}

/**
 * Persist extracted memory in the background (does not block the chat stream).
 * Pass `signal` (e.g. the chat request's AbortSignal) so work stops on stop/disconnect.
 */
export async function processUserMessageShoppingMemory(params: {
  userId: string;
  conversationId: string;
  messageId: string;
  text: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { userId, conversationId, messageId, text, signal } = params;
  const preview = text.slice(0, 100);
  const t = text.trim();

  let shouldExtract = false;
  let localGate = false;
  let forcedByEnv = false;
  let classifierResult: ShoppingMemoryClassification | null = null;

  if (process.env.AI_CHAT_MEMORY_ALWAYS_EXTRACT === "1") {
    if (t.length >= 2 && !isTrivialMemoryMessage(t)) {
      shouldExtract = true;
      forcedByEnv = true;
      localGate = true;
    } else {
      logMemory("skipped (ALWAYS_EXTRACT but trivial/empty)", { preview });
      return;
    }
  } else {
    if (t.length < 2 || isTrivialMemoryMessage(t)) {
      logMemory("skipped (trivial or empty)", { preview });
      return;
    }

    localGate = shouldRunShoppingExtractor(text);
    shouldExtract = localGate;

    if (!shouldExtract) {
      if (memoryPipelineAborted(signal)) {
        logMemory("skipped (aborted before classifier)", { preview });
        return;
      }
      try {
        classifierResult = await classifyForShoppingMemory(text, signal, {
          userId,
          kind: "memory_classify",
          conversationId,
          userMessageId: messageId,
          sequence: 0,
        });
      } catch (e) {
        if (isAbortLike(e)) {
          logMemory("classifier aborted", { preview });
          return;
        }
        logMemory("classifier request failed", { preview, error: String(e) });
      }
      shouldExtract =
        classifierResult !== null &&
        classifierAllowsDeepExtraction(classifierResult);
    }
  }

  if (memoryPipelineAborted(signal)) {
    logMemory("skipped (aborted after gate)", { preview });
    return;
  }

  if (!shouldExtract) {
    logMemory("skipped gate", {
      preview,
      localGate,
      forcedByEnv,
      classifier: classifierTelemetry(classifierResult),
    });
    return;
  }

  logMemory("gate passed", {
    preview,
    localGate,
    forcedByEnv,
    classifier: classifierTelemetry(classifierResult),
  });

  let extraction;
  try {
    extraction = await extractShoppingMemory(text, signal, {
      audit: {
        userId,
        kind: "memory_extract",
        conversationId,
        userMessageId: messageId,
        sequence: 1,
      },
    });
  } catch (e) {
    if (isAbortLike(e)) {
      logMemory("extractor aborted", { preview });
      return;
    }
    logMemory("extractor request failed", { preview, error: String(e) });
    return;
  }
  if (!extraction) {
    logMemory("extractor returned no structured payload", { preview });
    return;
  }

  const hasWork =
    extraction.observations.length > 0 ||
    extraction.activeIntent ||
    extraction.profileUpdates;
  if (!hasWork) {
    logMemory("extractor empty observations/intent/profileUpdates", {
      preview,
    });
    return;
  }

  if (memoryPipelineAborted(signal)) {
    logMemory("skipped (aborted before persist)", { preview });
    return;
  }

  try {
    await writeMemoryFromExtraction(userId, conversationId, messageId, extraction);

    if (memoryPipelineAborted(signal)) {
      logMemory("skipped projection (aborted after write)", { preview });
      return;
    }

    // Project the same extraction into the typed user-knowledge tables
    // (UserProfile, SizingProfile, CategoryPreference, BrandPreference,
    // Recipient, ShoppingIntent, TasteTag, HardNegative). These power the
    // structured context builder and the user-facing profile UI.
    try {
      await projectExtractionToTypedTables({
        userId,
        extraction,
        sourceMessageId: messageId,
      });
    } catch (e) {
      // Projection failures must NOT poison the canonical memory write —
      // the raw observations + ShoppingMemory rows are still safe.
      logMemory("projection failed", { preview, error: String(e) });
    }

    if (memoryPipelineAborted(signal)) {
      logMemory("skipped refresh (aborted after projection)", { preview });
      return;
    }

    await refreshShoppingProfileSummary(userId).catch(() => {});
    logMemory("saved", {
      preview,
      observations: extraction.observations.length,
      promotedApprox: extraction.observations.filter((o) => o.shouldPromoteToMemory)
        .length,
    });
  } catch (e) {
    logMemory("write failed", { preview, error: String(e) });
  }
}
