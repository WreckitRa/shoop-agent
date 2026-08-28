import { z } from "zod";
import { logAiChat } from "@/lib/ai-chat/observability";
import { canonicalGarmentFamily } from "../eval/garment-family";
import { FASHION_NORMALIZE_MODEL } from "../models";
import { tracedLLMCall } from "../observability/traced-llm-call";
import type { StyleSignalType } from "../types";
import { COLOR_MODIFIERS } from "./color-aliases";
import { resolveColorDeterministic } from "./color";
import { preNormalize } from "./pre-normalize";
import { COLOR_BUCKETS, type ColorBucket } from "./types";

export const STYLE_VOCAB = [
  "minimal",
  "classic",
  "edgy",
  "preppy",
  "boho",
  "streetwear",
  "tailored",
  "casual",
  "sporty",
  "romantic",
  "utilitarian",
  "vintage",
  "logos",
  "flashy",
] as const;

/** Spellings of the same style vocab entry — not a meaning table. */
const STYLE_SPELLINGS: Record<string, (typeof STYLE_VOCAB)[number]> = {
  "big logos": "logos",
  "logo-heavy": "logos",
  "logo heavy": "logos",
};

export const AESTHETIC_VOCAB = [
  "quiet luxury",
  "quality first",
  "value conscious",
  "design led",
  "minimal",
  "maximal",
] as const;

export const MATERIAL_VOCAB = [
  "leather",
  "wool",
  "fur",
  "silk",
  "linen",
  "cotton",
  "polyester",
  "cashmere",
  "denim",
  "suede",
  "viscose",
  "nylon",
] as const;

export const SILHOUETTE_VOCAB = [
  "slim",
  "relaxed",
  "oversized",
  "tailored",
  "boxy",
  "fitted",
  "straight",
  "wide",
  "cropped",
  "longline",
] as const;

export const PATTERN_VOCAB = [
  "solid",
  "stripe",
  "floral",
  "check",
  "plaid",
  "animal",
  "graphic",
  "logo",
  "abstract",
  "dot",
] as const;

const COLOR_SET = new Set<string>(COLOR_BUCKETS);
const SHOPPING_STYLE = new Set(["quick", "guided"]);

const CLASSIFY_VOCAB_TOOL = "classify_vocab";

const classifyVocabSchema = z.object({
  label: z.string(),
});

export type CanonicalizeDeps = {
  classifyInto?: (
    vocab: readonly string[],
    raw: string,
  ) => Promise<string | null>;
};

function exactVocab(vocab: readonly string[], raw: string): string | null {
  const n = preNormalize(raw);
  const spelled = STYLE_SPELLINGS[n];
  if (spelled && vocab.includes(spelled)) return spelled;
  return vocab.find((v) => v === n) ?? null;
}

function colorHasModifier(raw: string): boolean {
  return preNormalize(raw)
    .split(/\s+/)
    .some((t) => COLOR_MODIFIERS.has(t));
}

/** Brands: short all-caps stay all-caps; otherwise title case. */
export function canonicalBrandCase(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (t.length <= 4 && t === t.toUpperCase() && /[A-Z]/.test(t)) {
    return t.toUpperCase();
  }
  return t
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function signalCanonicalKey(row: {
  value: string;
  value_canonical?: string | null;
}): string {
  return (row.value_canonical ?? row.value).trim().toLowerCase();
}

/**
 * Deterministic only. Exact vocab / bucket / garment family / brand case.
 * Does not invent navy from "dark blue" — that is the LLM classifier.
 */
export function canonicalizeSignalValueSync(
  signalType: StyleSignalType | string,
  raw: string,
): string {
  const value = raw.trim().toLowerCase();
  if (!value) return value;

  if (signalType === "shopping_style") {
    return SHOPPING_STYLE.has(value) ? value : value;
  }
  if (signalType === "brand") return canonicalBrandCase(raw);
  if (signalType === "garment") {
    return canonicalGarmentFamily(value) ?? value;
  }
  if (signalType === "color") {
    if (COLOR_SET.has(value) && value !== "unknown") return value;
    if (colorHasModifier(raw)) return value;
    const det = resolveColorDeterministic(raw);
    const bucket = det.resolved ? det.buckets[0] : null;
    if (bucket && bucket !== "unknown") return bucket;
    return value;
  }
  const vocab = vocabFor(signalType);
  if (vocab) return exactVocab(vocab, raw) ?? value;
  return value;
}

function vocabFor(signalType: string): readonly string[] | null {
  if (signalType === "style") return STYLE_VOCAB;
  if (signalType === "aesthetic") return AESTHETIC_VOCAB;
  if (signalType === "material") return MATERIAL_VOCAB;
  if (signalType === "silhouette") return SILHOUETTE_VOCAB;
  if (signalType === "pattern") return PATTERN_VOCAB;
  if (signalType === "color") return COLOR_BUCKETS;
  return null;
}

function needsLlm(signalType: string, raw: string): boolean {
  const value = raw.trim().toLowerCase();
  if (signalType === "brand" || signalType === "shopping_style") return false;
  if (signalType === "garment") return false;
  if (signalType === "style" && canonicalGarmentFamily(raw.trim().toLowerCase())) {
    return false;
  }
  if (signalType === "color") {
    return !(COLOR_SET.has(value) && value !== "unknown");
  }
  const vocab = vocabFor(signalType);
  if (!vocab) return false;
  return exactVocab(vocab, raw) == null;
}

async function classifyIntoVocab(
  vocab: readonly string[],
  raw: string,
): Promise<string | null> {
  try {
    const response = await tracedLLMCall({
      stage: "normalize_llm",
      model: FASHION_NORMALIZE_MODEL,
      maxTokens: 256,
      temperature: 0,
      systemPrompt: `You map a fashion taste phrase onto a closed vocab. Call the tool with exactly one label from the list. If the phrase is a garment, item, or does not mean one of these labels, return the lowercased input (it may not be in the list). Vocab:\n${vocab.join(", ")}`,
      inputMessages: [{ role: "user", content: raw.trim() }],
      tools: [
        {
          name: CLASSIFY_VOCAB_TOOL,
          description: "Map the phrase to one vocab label.",
          input_schema: {
            type: "object" as const,
            properties: { label: { type: "string" } },
            required: ["label"],
          },
        },
      ],
      toolChoice: { type: "tool", name: CLASSIFY_VOCAB_TOOL },
    });
    const toolBlock = response.content.find(
      (block) =>
        block.type === "tool_use" && block.name === CLASSIFY_VOCAB_TOOL,
    );
    if (!toolBlock || toolBlock.type !== "tool_use") return null;
    const parsed = classifyVocabSchema.safeParse(toolBlock.input);
    if (!parsed.success) return null;
    const label = parsed.data.label.trim().toLowerCase();
    if (vocab.some((v) => v === label)) return label;
    return null;
  } catch (error) {
    logAiChat("warn", "fashion_signal_canonical_llm_failed", {
      error: String(error).slice(0, 240),
    });
    return null;
  }
}

/**
 * Write-time canonical for style_signals. Matching, dedup, corroboration,
 * and PROFILES key on this. Raw stays in `value`.
 */
export async function canonicalizeSignalValue(
  signalType: StyleSignalType | string,
  raw: string,
  deps?: CanonicalizeDeps,
): Promise<string> {
  const sync = canonicalizeSignalValueSync(signalType, raw);
  if (!needsLlm(signalType, raw)) return sync;
  if (!deps?.classifyInto && process.env.NODE_ENV === "test") return sync;

  const vocab = vocabFor(signalType);
  if (!vocab) return sync;

  const classify = deps?.classifyInto ?? classifyIntoVocab;
  const hit = await classify(vocab, raw);
  if (hit && hit !== "unknown") return hit;
  return sync;
}
