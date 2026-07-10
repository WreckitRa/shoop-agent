import { z } from "zod";
import { createLightweightMessage } from "../anthropic";
import type { LightweightPromptAudit } from "../prompt-run/lightweight-audit";
import { logAiChat } from "../observability";
import { stripJsonFence, stripNullFields } from "./llm-json";
import { normalizeForMemoryGate } from "./memory-gate";

const CLASSIFIER_SYSTEM = `You classify a single user chat message for shopping-related memory extraction.
Return one JSON object only, no markdown.

All fields are booleans:
- isShoppingRelevant: message is mainly about shopping/products/gifts/logistics
- containsPreference: likes, dislikes, wants, avoids, style opinions
- containsSize: clothing/shoe/body sizing
- containsBudget: prices, budget, deals
- containsBrand: brand names or retailer loyalty
- containsProductFeedback: reviews of items shown, clicked, bought, returned
- containsGiftContext: gifts, recipients, occasions
- containsIntent: active shopping mission ("looking for", "need a")
- shouldRunDeepExtraction: true if ANY signal above should trigger a structured memory extractor`;

export const shoppingMemoryClassificationSchema = z.object({
  isShoppingRelevant: z.boolean(),
  containsPreference: z.boolean(),
  containsSize: z.boolean(),
  containsBudget: z.boolean(),
  containsBrand: z.boolean(),
  containsProductFeedback: z.boolean(),
  containsGiftContext: z.boolean(),
  containsIntent: z.boolean(),
  shouldRunDeepExtraction: z.boolean(),
});

export type ShoppingMemoryClassification = z.infer<
  typeof shoppingMemoryClassificationSchema
>;

/** True if any classifier flag says we should run deep extraction. */
export function classifierAllowsDeepExtraction(
  r: ShoppingMemoryClassification,
): boolean {
  return (
    r.isShoppingRelevant ||
    r.containsPreference ||
    r.containsSize ||
    r.containsBudget ||
    r.containsBrand ||
    r.containsProductFeedback ||
    r.containsGiftContext ||
    r.containsIntent ||
    r.shouldRunDeepExtraction
  );
}

/**
 * Cheap second-stage gate when deterministic rules miss (e.g. “love sneakers” without “I”).
 */
export async function classifyForShoppingMemory(
  userMessage: string,
  signal?: AbortSignal,
  audit?: LightweightPromptAudit,
): Promise<ShoppingMemoryClassification | null> {
  const normalized = normalizeForMemoryGate(userMessage);
  const msg = await createLightweightMessage(
    {
      max_tokens: 256,
      temperature: 0,
      system: CLASSIFIER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Message:\n"""${normalized.slice(0, 8000)}"""`,
        },
      ],
    },
    audit ? { signal, audit } : signal ? { signal } : undefined,
  );

  const block = msg.content.find((b) => b.type === "text");
  if (!block) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(block.text));
  } catch {
    return null;
  }

  parsed = stripNullFields(parsed);
  const out = shoppingMemoryClassificationSchema.safeParse(parsed);
  if (!out.success) {
    logAiChat("warn", "shopping_memory_classifier_schema_mismatch", {
      issues: out.error.flatten(),
    });
    return null;
  }
  return out.data;
}
