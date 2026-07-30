/**
 * Phase 1 Stage B — voice only (no images). Fills stylist_lines + opening
 * onto already-chosen picks so heroes can mount before prose lands.
 *
 * Failure contract: one corrective retry, then deterministic stylist
 * templates with degradation.kind = voice_fallback. Never ship Stage A
 * placeholders ("Fitting room ready." / "See card.").
 */
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { logAiChat } from "@/lib/ai-chat/observability";
import { FASHION_CURATION_VOICE_MODEL } from "../models";
import { stripJsonFence } from "@/lib/ai-chat/shopping-memory/llm-json";
import { tracedLLMCall } from "../observability/traced-llm-call";
import {
  CURATION_VOICE_TOOL_NAME,
  FASHION_CURATION_VOICE_MAX_TOKENS,
  STAGE_A_PLACEHOLDER_OPENING,
  STAGE_A_PLACEHOLDER_STYLIST_LINE,
} from "./config";
import { CURATION_STAGE_B_HARD_MS } from "../pipeline-cutoffs";
import type { DeliverCurationInput } from "./types";
import type { CurationRefRegistry } from "./types";
import { recordVoiceOutcome } from "../observability/voice-metrics";

const VOICE_SYSTEM = `You write stylist voice for Shoop fashion picks that are ALREADY chosen.
You receive the picks (refs, titles, roles, prices, colors) and client context.
Return ONLY JSON via the ${CURATION_VOICE_TOOL_NAME} tool:
{"opening":"...","budget_note":optional,"thin_note":optional,"brand_note":optional,"lines":[{"ref":"...","stylist_line":"one specific sentence"}]}
Rules: one sentence per pick, specific to THIS item and THIS client, user's language, no generic praise. Cap opening at 2 short sentences. No images — describe from attributes.
Keep every field short — the token budget is tight. Do not write preamble outside the tool.`;

export function voiceToneAppendix(voice?: {
  honesty?: "gentle" | "balanced" | "blunt";
  value_philosophy?: string;
}): string {
  if (!voice) return "";
  const bits: string[] = [];
  if (voice.honesty === "blunt") {
    bits.push(
      'Honesty mode BLUNT: call weaknesses plainly ("the value pick — fabric is thinner").',
    );
  } else if (voice.honesty === "gentle") {
    bits.push(
      "Honesty mode GENTLE: soft framing; cushion critiques; lead with what works.",
    );
  } else if (voice.honesty === "balanced") {
    bits.push(
      "Honesty mode BALANCED: like a good friend — say what doesn't work and show what does.",
    );
  }
  const vp = voice.value_philosophy?.toLowerCase() ?? "";
  if (/\bluxury\b/.test(vp)) {
    bits.push(
      "Spend philosophy quiet-luxury: lead with fabric/cut/finish, not price.",
    );
  } else if (/deal_hunter|best_value/.test(vp)) {
    bits.push(
      "Spend philosophy deal-hunter/value: lead with price-vs-market when useful.",
    );
  } else if (/premium/.test(vp)) {
    bits.push("Spend philosophy quality-first: emphasize lasting construction.");
  } else if (/design_first/.test(vp)) {
    bits.push("Spend philosophy design-led: lead with silhouette and aesthetic.");
  }
  return bits.length ? `\n${bits.join(" ")}` : "";
}

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

export type VoiceJson = {
  opening?: string;
  budget_note?: string;
  thin_note?: string;
  brand_note?: string;
  lines?: Array<{ ref: string; stylist_line: string }>;
};

export function extractVoiceJson(content: Message["content"]): VoiceJson | null {
  for (const block of content) {
    if (block.type === "tool_use" && block.name === CURATION_VOICE_TOOL_NAME) {
      return block.input as VoiceJson;
    }
    if (block.type === "text") {
      try {
        return JSON.parse(stripJsonFence(block.text)) as VoiceJson;
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

/** True when Stage B (or fallback) produced real stylist copy. */
export function isUsableVoice(voice: VoiceJson | null | undefined): boolean {
  if (!voice?.opening?.trim() || !voice.lines?.length) return false;
  const opening = voice.opening.trim();
  if (opening === STAGE_A_PLACEHOLDER_OPENING) return false;
  if (/^fitting room ready\.?$/i.test(opening)) return false;
  const usableLines = voice.lines.filter(
    (l) =>
      l.ref &&
      l.stylist_line?.trim() &&
      l.stylist_line.trim() !== STAGE_A_PLACEHOLDER_STYLIST_LINE &&
      (l.stylist_line.trim().length ?? 0) >= 8,
  );
  return usableLines.length > 0;
}

export type VoiceContext = {
  honesty?: "gentle" | "balanced" | "blunt";
  value_philosophy?: string;
};

/** Deterministic stylist templates — never machinery, never Stage A placeholders. */
export function buildDeterministicVoiceFallback(params: {
  output: DeliverCurationInput;
  occasion?: string;
  voiceContext?: VoiceContext;
}): VoiceJson {
  const occasion = (params.occasion ?? "").trim();
  const occasionLabel = occasion
    ? occasion.charAt(0).toUpperCase() + occasion.slice(1)
    : "These";
  const honesty = params.voiceContext?.honesty ?? "balanced";

  const opening =
    honesty === "blunt"
      ? `${occasionLabel} picks — sized and verified. Straight talk on each.`
      : honesty === "gentle"
        ? `${occasionLabel}-ready picks for you — sized and verified, with a soft read on each.`
        : `${occasionLabel}-ready picks for you — sized and verified.`;

  const lines: Array<{ ref: string; stylist_line: string }> = [];
  for (const slot of params.output.slots) {
    for (const pick of slot.picks) {
      const role = pick.role ?? "safe";
      let stylist_line: string;
      if (honesty === "blunt") {
        stylist_line =
          role === "value"
            ? "The value pick — check fabric hand in person if you can."
            : role === "stretch"
              ? "The stretch option — nicer make, worth it if the cut lands."
              : "Solid verified option for this brief — no drama.";
      } else if (honesty === "gentle") {
        stylist_line =
          role === "value"
            ? "A smart-value option that still reads polished for the ask."
            : role === "stretch"
              ? "A little more elevated — soft upgrade if you want the nicer finish."
              : "A clean, reliable pick that fits the brief well.";
      } else {
        stylist_line =
          role === "value"
            ? "Strong value for the brief — fabric is the only place to look twice."
            : role === "stretch"
              ? "The stretch pick — better make if the silhouette works on you."
              : "Verified and on-brief — a safe, work-ready choice.";
      }
      lines.push({ ref: pick.ref, stylist_line });
    }
  }

  return { opening, lines };
}

function applyVoiceToOutput(
  output: DeliverCurationInput,
  voice: VoiceJson,
): DeliverCurationInput {
  const lineByRef = new Map(
    (voice.lines ?? []).map((l) => [l.ref, l.stylist_line.trim()]),
  );

  return {
    ...output,
    slots: output.slots.map((slot) => ({
      ...slot,
      picks: slot.picks.map((p) => {
        const line = lineByRef.get(p.ref);
        const usable =
          line &&
          line.length >= 8 &&
          line !== STAGE_A_PLACEHOLDER_STYLIST_LINE;
        return {
          ...p,
          stylist_line: usable ? line! : p.stylist_line,
        };
      }),
    })),
    narration: {
      opening:
        voice.opening?.trim().slice(0, 800) || output.narration.opening,
      budget_note: voice.budget_note?.trim() || output.narration.budget_note,
      thin_note: voice.thin_note?.trim() || output.narration.thin_note,
      brand_note: voice.brand_note?.trim() || output.narration.brand_note,
    },
  };
}

function stillHasPlaceholders(output: DeliverCurationInput): boolean {
  const opening = output.narration.opening.trim();
  if (
    opening === STAGE_A_PLACEHOLDER_OPENING ||
    /^fitting room ready\.?$/i.test(opening)
  ) {
    return true;
  }
  return output.slots.some((s) =>
    s.picks.some(
      (p) => p.stylist_line.trim() === STAGE_A_PLACEHOLDER_STYLIST_LINE,
    ),
  );
}

export type FillCurationVoiceResult = {
  output: DeliverCurationInput;
  /** true when deterministic templates were used after empty LLM path. */
  voiceFallback: boolean;
  /** first attempt empty → retry recovered. */
  voiceRetried: boolean;
};

async function callVoiceModel(params: {
  systemPrompt: string;
  toneSuffix: string;
  userText: string;
  signal?: AbortSignal;
  traceId?: string | null;
  attempt: number;
  llmCall?: typeof tracedLLMCall;
}): Promise<{ voice: VoiceJson | null; msg: Message }> {
  const call = params.llmCall ?? tracedLLMCall;
  const msg = await call({
    traceId: params.traceId,
    stage: "curation_voice",
    model: FASHION_CURATION_VOICE_MODEL,
    systemPrompt: params.systemPrompt + params.toneSuffix,
    systemCachedPrefix: VOICE_SYSTEM,
    systemUncachedSuffix: params.toneSuffix.trim() || undefined,
    // Prefix is far under Haiku 4.5's 4096-token cache minimum — don't pretend.
    disablePromptCache: true,
    inputMessages: [{ role: "user", content: params.userText }],
    tools: [VOICE_TOOL],
    toolChoice: { type: "tool", name: CURATION_VOICE_TOOL_NAME },
    maxTokens: FASHION_CURATION_VOICE_MAX_TOKENS,
    signal: params.signal,
  });

  const voice = extractVoiceJson(msg.content);
  if (!isUsableVoice(voice)) {
    logAiChat("warn", "fashion_curation_voice_empty", {
      traceId: params.traceId,
      attempt: params.attempt,
      stop_reason: msg.stop_reason,
      output_tokens: msg.usage?.output_tokens,
      max_tokens: FASHION_CURATION_VOICE_MAX_TOKENS,
      has_opening: Boolean(voice?.opening?.trim()),
      lines_count: voice?.lines?.length ?? 0,
    });
  }
  return { voice, msg };
}

export async function fillCurationVoice(params: {
  output: DeliverCurationInput;
  registry: CurationRefRegistry;
  recipientProfile?: string;
  occasion?: string;
  styleDirection?: string;
  voiceContext?: VoiceContext;
  signal?: AbortSignal;
  traceId?: string | null;
  /** Test seam — defaults to tracedLLMCall. */
  llmCall?: typeof tracedLLMCall;
}): Promise<FillCurationVoiceResult> {
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
    `Return complete tool JSON: opening + one stylist_line per pick (${pickRows.length} picks). Stay under the token budget.`,
  ]
    .filter(Boolean)
    .join("\n");

  const toneSuffix = voiceToneAppendix(params.voiceContext);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    CURATION_STAGE_B_HARD_MS,
  );
  const onParentAbort = () => controller.abort();
  params.signal?.addEventListener("abort", onParentAbort, { once: true });

  const linkedSignal = controller.signal;

  const applyFallback = (): FillCurationVoiceResult => {
    const fallbackVoice = buildDeterministicVoiceFallback({
      output: params.output,
      occasion: params.occasion,
      voiceContext: params.voiceContext,
    });
    const output = applyVoiceToOutput(params.output, fallbackVoice);
    recordVoiceOutcome("fallback");
    logAiChat("warn", "fashion_curation_voice_fallback", {
      traceId: params.traceId,
      pick_count: pickRows.length,
    });
    return { output, voiceFallback: true, voiceRetried: false };
  };

  try {
    let voiceRetried = false;
    let { voice } = await callVoiceModel({
      systemPrompt: VOICE_SYSTEM,
      toneSuffix,
      userText,
      signal: linkedSignal,
      traceId: params.traceId,
      attempt: 1,
      llmCall: params.llmCall,
    });

    if (!isUsableVoice(voice)) {
      voiceRetried = true;
      // Corrective retry — same schema, explicit completeness nudge.
      const retryText = `${userText}\n\nPREVIOUS REPLY WAS EMPTY OR INCOMPLETE. Call ${CURATION_VOICE_TOOL_NAME} with a complete opening and one stylist_line for EVERY pick ref listed. Short sentences only.`;
      ({ voice } = await callVoiceModel({
        systemPrompt: VOICE_SYSTEM,
        toneSuffix,
        userText: retryText,
        signal: linkedSignal,
        traceId: params.traceId,
        attempt: 2,
        llmCall: params.llmCall,
      }));
    }

    if (!isUsableVoice(voice)) {
      const result = applyFallback();
      return { ...result, voiceRetried };
    }

    let output = applyVoiceToOutput(params.output, voice!);
    if (stillHasPlaceholders(output)) {
      // Partial apply left Stage A placeholders — finish with templates.
      const fallbackVoice = buildDeterministicVoiceFallback({
        output,
        occasion: params.occasion,
        voiceContext: params.voiceContext,
      });
      output = applyVoiceToOutput(output, fallbackVoice);
      recordVoiceOutcome("fallback");
      return { output, voiceFallback: true, voiceRetried };
    }

    recordVoiceOutcome(voiceRetried ? "retry_ok" : "ok");
    return { output, voiceFallback: false, voiceRetried };
  } catch (error) {
    // Parent abort cancels the whole turn — rethrow. Stage B timer alone → fallback.
    if (params.signal?.aborted) throw error;
    logAiChat("warn", "fashion_curation_voice_failed", {
      traceId: params.traceId,
      error: error instanceof Error ? error.message : String(error),
      stage_b_aborted: linkedSignal.aborted,
    });
    return applyFallback();
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener("abort", onParentAbort);
  }
}
