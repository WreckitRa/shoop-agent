/**
 * Resolve hex palettes for mid-session color quiz chips.
 * LLM-generated from the quiz question + labels (adapts to the ask);
 * KV-cached per question+label for cost. Heuristic fallback only if LLM fails.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { createLightweightMessage } from "@/lib/ai-chat/anthropic";
import { logAiChat } from "@/lib/ai-chat/observability";
import { stripJsonFence, stripNullFields } from "@/lib/ai-chat/llm-json";
import { kvGet, kvSetex } from "@/lib/cache/kv-store";
import {
  paletteFallbackForLabel,
  palettePlausibleForLabel,
} from "@/lib/ai-chat/clarification-palette-fallback";

export {
  paletteFallbackForLabel,
  palettePlausibleForLabel,
} from "@/lib/ai-chat/clarification-palette-fallback";

const HEX_COLOR = /^#[0-9a-f]{6}$/;
const PALETTE_SIZE = 4;
const PALETTE_CACHE_TTL_SEC = 30 * 24 * 60 * 60;
/** Bump when prompt/validation rules change — kills poisoned LLM cache. */
const PALETTE_CACHE_VERSION = "v3";

export type ClarificationPaletteRequest = {
  id: string;
  label: string;
  /** Clarification / ride-along text so swatches adapt to the ask. */
  questionText?: string;
};

export type ClarificationPaletteResult = {
  optionId: string;
  paletteColors: string[];
  /** False when heuristic was used — do not persist/cache as authoritative. */
  fromModel: boolean;
};

const PALETTE_SYSTEM = `You generate fashion color palettes for quiz option chips in a shopping chat.

Given a clarification question and palette labels, return one JSON object mapping each exact label to an array of exactly 4 lowercase #RRGGBB hex colors.

Rules:
- Adapt hues to the question and shopping context (e.g. tailored pants with a blazer vs a casual hoodie).
- Each palette must clearly visualize that label (e.g. "Dark colors" → near-blacks/charcoal; "Neutral tones" → ivory/stone/taupe — NOT the same as dark).
- Different labels must look visually distinct from each other.
- Prefer wearable fashion colors, not neon UI colors.
- Return JSON only.`;

function parseHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  const withHash = normalized.startsWith("#") ? normalized : `#${normalized}`;
  return HEX_COLOR.test(withHash) ? withHash : null;
}

function normalizePalette(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const colors: string[] = [];
  for (const item of raw) {
    const hex = parseHex(item);
    if (hex && !colors.includes(hex)) colors.push(hex);
    if (colors.length >= PALETTE_SIZE) break;
  }
  return colors.length >= 3 ? colors.slice(0, PALETTE_SIZE) : null;
}

function normalizeQuestion(text: string | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function paletteCacheKey(questionText: string | undefined, label: string): string {
  const hash = createHash("sha256")
    .update(`${normalizeQuestion(questionText)}\0${label.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
  return `clarification-palette:${PALETTE_CACHE_VERSION}:${hash}`;
}

function requestKey(option: {
  label: string;
  questionText?: string;
}): string {
  return `${normalizeQuestion(option.questionText)}\0${option.label.trim().toLowerCase()}`;
}

async function readCachedPalette(
  questionText: string | undefined,
  label: string,
): Promise<string[] | null> {
  try {
    const cached = await kvGet(paletteCacheKey(questionText, label));
    if (!cached) return null;
    const colors = normalizePalette(JSON.parse(cached));
    if (!colors || !palettePlausibleForLabel(label, colors)) return null;
    return colors;
  } catch {
    return null;
  }
}

async function writeCachedPalette(
  questionText: string | undefined,
  label: string,
  colors: string[],
): Promise<void> {
  try {
    await kvSetex(
      paletteCacheKey(questionText, label),
      PALETTE_CACHE_TTL_SEC,
      JSON.stringify(colors),
    );
  } catch {
    /* best-effort */
  }
}

async function callPaletteModel(
  questionText: string | undefined,
  labels: string[],
  audit?: { userId: string; conversationId?: string | null },
  signal?: AbortSignal,
): Promise<Record<string, string[]>> {
  const msg = await createLightweightMessage(
    {
      max_tokens: Math.min(512, labels.length * 48 + 96),
      temperature: 0,
      system: PALETTE_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            question: questionText?.trim() || null,
            labels,
          }),
        },
      ],
    },
    {
      signal,
      audit: audit
        ? {
            userId: audit.userId,
            conversationId: audit.conversationId,
            kind: "swatch_color",
            sequence: 0,
            metadata: {
              source: "clarification_palette",
              labelCount: labels.length,
              labels: labels.slice(0, 16),
              question: questionText?.slice(0, 160) ?? null,
            },
          }
        : undefined,
    },
  );

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(block.text));
  } catch {
    return {};
  }

  parsed = stripNullFields(parsed);
  const schema = z.record(z.string(), z.array(z.string()));
  const out = schema.safeParse(parsed);
  if (!out.success) return {};

  const colors: Record<string, string[]> = {};
  for (const label of labels) {
    const palette = normalizePalette(out.data[label]);
    if (palette) colors[label] = palette;
  }
  return colors;
}

/**
 * Resolve 4-swatch palettes for color clarification options.
 * Never throws — always returns a palette per request (model or fallback).
 * Only LLM (plausible) results are written to KV cache.
 */
export async function resolveClarificationPalettes(params: {
  options: ClarificationPaletteRequest[];
  userId?: string;
  conversationId?: string | null;
  signal?: AbortSignal;
}): Promise<ClarificationPaletteResult[]> {
  const uniqueByKey = new Map<string, ClarificationPaletteRequest[]>();
  for (const option of params.options) {
    const label = option.label.trim();
    if (!label) continue;
    const key = requestKey(option);
    const bucket = uniqueByKey.get(key) ?? [];
    bucket.push(option);
    uniqueByKey.set(key, bucket);
  }

  if (!uniqueByKey.size) return [];

  const resultByKey = new Map<string, { colors: string[]; fromModel: boolean }>();

  // Batch LLM by question so sibling chips stay distinct and context-aware.
  const byQuestion = new Map<string, ClarificationPaletteRequest[]>();
  for (const [, options] of uniqueByKey) {
    const sample = options[0]!;
    const qKey = normalizeQuestion(sample.questionText);
    const bucket = byQuestion.get(qKey) ?? [];
    bucket.push(sample);
    byQuestion.set(qKey, bucket);
  }

  for (const [, samples] of byQuestion) {
    const questionText = samples[0]!.questionText;
    const labels = samples.map((s) => s.label);

    const cached = await Promise.all(
      labels.map(async (label) => ({
        label,
        colors: await readCachedPalette(questionText, label),
      })),
    );

    const missing: string[] = [];
    for (const row of cached) {
      if (row.colors?.length) {
        resultByKey.set(requestKey({ label: row.label, questionText }), {
          colors: row.colors,
          fromModel: true,
        });
      } else {
        missing.push(row.label);
      }
    }

    if (!missing.length) continue;

    let modelPalettes: Record<string, string[]> = {};
    try {
      modelPalettes = await callPaletteModel(
        questionText,
        missing,
        params.userId
          ? {
              userId: params.userId,
              conversationId: params.conversationId,
            }
          : undefined,
        params.signal,
      );
    } catch (error) {
      logAiChat("warn", "clarification_palette_model_failed", {
        labelCount: missing.length,
        error: String(error).slice(0, 160),
      });
    }

    await Promise.all(
      missing.map(async (label) => {
        const modelColors = modelPalettes[label];
        const fromModel =
          modelColors && palettePlausibleForLabel(label, modelColors)
            ? modelColors
            : null;
        resultByKey.set(requestKey({ label, questionText }), {
          colors: fromModel ?? paletteFallbackForLabel(label),
          fromModel: Boolean(fromModel),
        });
        if (fromModel) {
          await writeCachedPalette(questionText, label, fromModel);
        }
      }),
    );
  }

  const out: ClarificationPaletteResult[] = [];
  for (const [key, options] of uniqueByKey) {
    const label = options[0]!.label;
    const resolved = resultByKey.get(key);
    const raw = resolved?.colors ?? paletteFallbackForLabel(label);
    const colors = palettePlausibleForLabel(label, raw)
      ? raw
      : paletteFallbackForLabel(label);
    const fromModel =
      Boolean(resolved?.fromModel) && palettePlausibleForLabel(label, colors);
    for (const option of options) {
      out.push({ optionId: option.id, paletteColors: colors, fromModel });
    }
  }
  return out;
}
