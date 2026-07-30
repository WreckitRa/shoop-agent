/**
 * Phase 1 Stage B — voice only (no images). Fills stylist_lines + opening
 * onto already-chosen picks so heroes can mount before prose lands.
 */
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { logAiChat } from "@/lib/ai-chat/observability";
import { getAnthropicClient } from "@/lib/ai-chat/anthropic";
import { FASHION_CURATION_VOICE_MODEL } from "../models";
import { stripJsonFence } from "@/lib/ai-chat/shopping-memory/llm-json";
import {
  CURATION_VOICE_TOOL_NAME,
  FASHION_CURATION_VOICE_MAX_TOKENS,
} from "./config";
import { CURATION_STAGE_B_HARD_MS } from "../pipeline-cutoffs";
import type { DeliverCurationInput } from "./types";
import type { CurationRefRegistry } from "./types";

const VOICE_SYSTEM = `You write stylist voice for Shoop fashion picks that are ALREADY chosen.
You receive the picks (refs, titles, roles, prices, colors) and client context.
Return ONLY JSON via the ${CURATION_VOICE_TOOL_NAME} tool:
{"opening":"...","budget_note":optional,"thin_note":optional,"brand_note":optional,"lines":[{"ref":"...","stylist_line":"one specific sentence"}]}
Rules: one sentence per pick, specific to THIS item and THIS client, user's language, no generic praise. Cap opening at 2 short sentences. No images — describe from attributes.`;

const VOICE_TOOL = {
  name: CURATION_VOICE_TOOL_NAME,
  description: "Fill stylist lines and opening for already-chosen picks.",
  input_schema: {
    type: "object" as const,
    properties: {
      opening: { type: "string" },
      budget_note: { type: "string" },
      thin_note: { type: "string" },
      brand_note: { type: "string" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string" },
            stylist_line: { type: "string" },
          },
          required: ["ref", "stylist_line"],
        },
      },
    },
    required: ["opening", "lines"],
  },
};

function extractVoiceJson(content: Message["content"]): {
  opening?: string;
  budget_note?: string;
  thin_note?: string;
  brand_note?: string;
  lines?: Array<{ ref: string; stylist_line: string }>;
} | null {
  for (const block of content) {
    if (block.type === "tool_use" && block.name === CURATION_VOICE_TOOL_NAME) {
      return block.input as {
        opening?: string;
        budget_note?: string;
        thin_note?: string;
        brand_note?: string;
        lines?: Array<{ ref: string; stylist_line: string }>;
      };
    }
    if (block.type === "text") {
      try {
        return JSON.parse(stripJsonFence(block.text)) as {
          opening?: string;
          lines?: Array<{ ref: string; stylist_line: string }>;
        };
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

export async function fillCurationVoice(params: {
  output: DeliverCurationInput;
  registry: CurationRefRegistry;
  recipientProfile?: string;
  occasion?: string;
  styleDirection?: string;
  signal?: AbortSignal;
  traceId?: string | null;
}): Promise<DeliverCurationInput> {
  const pickRows: string[] = [];
  for (const slot of params.output.slots) {
    for (const pick of slot.picks) {
      const entry = params.registry.get(pick.ref);
      const c = entry?.candidate;
      pickRows.push(
        `- ${pick.ref} role=${pick.role} title=${c?.title ?? "?"} price=${c?.final_price?.amount ?? c?.price?.amount ?? "?"} color=${c?.normalized?.colors?.buckets?.join(",") ?? "?"}`,
      );
    }
  }

  const userText = [
    `Occasion: ${params.occasion ?? ""}`,
    `Style: ${params.styleDirection ?? ""}`,
    params.recipientProfile?.trim()
      ? `Profile:\n${params.recipientProfile.trim()}`
      : "",
    "Picks:",
    ...pickRows,
    params.output.narration.thin_note
      ? `Existing thin_note hint: ${params.output.narration.thin_note}`
      : "",
    params.output.narration.budget_note
      ? `Existing budget_note hint: ${params.output.narration.budget_note}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const client = getAnthropicClient();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    CURATION_STAGE_B_HARD_MS,
  );
  const onParentAbort = () => controller.abort();
  params.signal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const msg = await client.messages.create(
      {
        model: FASHION_CURATION_VOICE_MODEL,
        max_tokens: FASHION_CURATION_VOICE_MAX_TOKENS,
        system: [
          {
            type: "text",
            text: VOICE_SYSTEM,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userText }],
        tools: [VOICE_TOOL],
        tool_choice: { type: "tool", name: CURATION_VOICE_TOOL_NAME },
      },
      { signal: controller.signal },
    );

    const voice = extractVoiceJson(msg.content);
    if (!voice?.opening || !voice.lines?.length) {
      logAiChat("warn", "fashion_curation_voice_empty", {
        traceId: params.traceId,
      });
      return params.output;
    }

    const lineByRef = new Map(
      voice.lines.map((l) => [l.ref, l.stylist_line.trim()]),
    );

    return {
      ...params.output,
      slots: params.output.slots.map((slot) => ({
        ...slot,
        picks: slot.picks.map((p) => ({
          ...p,
          stylist_line:
            lineByRef.get(p.ref) && (lineByRef.get(p.ref)?.length ?? 0) >= 8
              ? lineByRef.get(p.ref)!
              : p.stylist_line,
        })),
      })),
      narration: {
        opening: voice.opening.trim().slice(0, 800) || params.output.narration.opening,
        budget_note:
          voice.budget_note?.trim() || params.output.narration.budget_note,
        thin_note: voice.thin_note?.trim() || params.output.narration.thin_note,
        brand_note:
          voice.brand_note?.trim() || params.output.narration.brand_note,
      },
    };
  } catch (error) {
    if (params.signal?.aborted) throw error;
    logAiChat("warn", "fashion_curation_voice_failed", {
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return params.output;
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener("abort", onParentAbort);
  }
}
