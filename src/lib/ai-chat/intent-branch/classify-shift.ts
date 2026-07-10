import { z } from "zod";
import { createLightweightMessage } from "../anthropic";
import { AI_CHAT_LIGHTWEIGHT_MODEL } from "../constants";
import type { LightweightPromptAudit } from "../prompt-run/lightweight-audit";
import { parseLlmJsonObject, stripNullFields } from "../shopping-memory/llm-json";
import { logIntentBranch } from "./debug-log";
import {
  formatMissionForPrompt,
  type SearchMissionSnapshot,
} from "./search-mission";

const CLASSIFIER_SYSTEM = `You compare two Shoop catalog SEARCH MISSIONS and decide if the CURRENT one starts a NEW shopping branch in the sidebar.

Return one JSON object only, no markdown, no prose after the JSON:
- isNewIntent: true when the buyer pivoted to a genuinely different shopping goal
- confidence: 0.0–1.0 (use ≥ 0.85 when product domains clearly differ)
- suggestedTitle: short sidebar label (3–6 words) when isNewIntent is true; otherwise ""

DIFFERENT missions (isNewIntent: true):
- Gift t-shirt for sister-in-law → utility knife for camping
- Gift for someone → shopping for self ("for me", own pants/sneakers)
- Running shoes → living room sofa
- iPhone charger search → black relaxed pants (unrelated apparel)
- Wedding gift direction → protein powder for self

SAME mission (isNewIntent: false):
- iPhone 17 charger → iPhone 17 Pro Max case (same phone accessory thread)
- Running shoes → cheaper running shoes / different brand sneakers
- Gift direction "Retro Minimalist" → another query within that same direction
- Refinements: color, size, budget, "show me more like this"

When domains clearly differ, prefer isNewIntent: true with confidence ≥ 0.85.`;

export const intentShiftClassificationSchema = z.object({
  isNewIntent: z.boolean(),
  confidence: z.number().min(0).max(1),
  suggestedTitle: z.string().default(""),
});

export type IntentShiftClassification = z.infer<
  typeof intentShiftClassificationSchema
>;

export async function classifySearchMissionShift(params: {
  previous: SearchMissionSnapshot;
  current: SearchMissionSnapshot;
  signal?: AbortSignal;
  audit?: LightweightPromptAudit;
}): Promise<IntentShiftClassification | null> {
  let msg;
  try {
    msg = await createLightweightMessage(
      {
        model: AI_CHAT_LIGHTWEIGHT_MODEL,
        max_tokens: 180,
        temperature: 0,
        system: CLASSIFIER_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              "PREVIOUS search mission:",
              formatMissionForPrompt(params.previous),
              "",
              "CURRENT search mission:",
              formatMissionForPrompt(params.current),
            ].join("\n"),
          },
        ],
      },
      params.audit
        ? { signal: params.signal, audit: params.audit }
        : params.signal
          ? { signal: params.signal }
          : undefined,
    );
  } catch (error) {
    logIntentBranch("classifier_api_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    logIntentBranch("classifier_no_text_block", {
      stopReason: msg.stop_reason ?? null,
      contentTypes: msg.content.map((b) => b.type),
    });
    return null;
  }

  const jsonText = block.text.split(/\n\s*\*\*Reasoning/i)[0] ?? block.text;
  const parsedJson = parseLlmJsonObject(jsonText);
  if (!parsedJson) {
    logIntentBranch("classifier_parse_failed", {
      rawPreview: block.text.slice(0, 500),
      stopReason: msg.stop_reason ?? null,
    });
    return null;
  }

  const parsed = stripNullFields(parsedJson.value);
  const out = intentShiftClassificationSchema.safeParse(parsed);
  if (!out.success) {
    logIntentBranch("classifier_schema_mismatch", {
      issues: out.error.flatten(),
      rawPreview: block.text.slice(0, 400),
      salvaged: parsedJson.salvaged,
    });
    return null;
  }

  logIntentBranch("classifier_raw_ok", {
    result: out.data,
    salvaged: parsedJson.salvaged,
  });
  return out.data;
}
