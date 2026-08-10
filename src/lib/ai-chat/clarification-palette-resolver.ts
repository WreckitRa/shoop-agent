/**
 * Resolve distinct hex palettes for mid-session color quiz chips.
 * One cheap Haiku call for all uncached labels; heuristic fallbacks otherwise.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { createLightweightMessage } from "@/lib/ai-chat/anthropic";
import { logAiChat } from "@/lib/ai-chat/observability";
import { stripJsonFence, stripNullFields } from "@/lib/ai-chat/llm-json";
import { kvGet, kvSetex } from "@/lib/cache/kv-store";
import { paletteFallbackForLabel } from "@/lib/ai-chat/clarification-palette-fallback";

export { paletteFallbackForLabel } from "@/lib/ai-chat/clarification-palette-fallback";

const HEX_COLOR = /^#[0-9a-f]{6}$/;
const PALETTE_SIZE = 4;
const PALETTE_CACHE_TTL_SEC = 30 * 24 * 60 * 60;

export type ClarificationPaletteRequest = {
  id: string;
  label: string;
};

export type ClarificationPaletteResult = {
  optionId: string;
  paletteColors: string[];
};

const PALETTE_SYSTEM = `You generate fashion color palettes for quiz option chips.

Given palette labels, return one JSON object mapping each exact label to an array of exactly 4 lowercase #RRGGBB hex colors.

Rules:
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

function paletteCacheKey(label: string): string {
  const hash = createHash("sha256")
    .update(label.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
  return `clarification-palette:v1:${hash}`;
}

async function readCachedPalette(label: string): Promise<string[] | null> {
  try {
    const cached = await kvGet(paletteCacheKey(label));
    if (!cached) return null;
    return normalizePalette(JSON.parse(cached));
  } catch {
    return null;
  }
}

async function writeCachedPalette(
  label: string,
  colors: string[],
): Promise<void> {
  try {
    await kvSetex(
      paletteCacheKey(label),
      PALETTE_CACHE_TTL_SEC,
      JSON.stringify(colors),
    );
  } catch {
    /* best-effort */
  }
}

async function callPaletteModel(
  labels: string[],
  audit?: { userId: string; conversationId?: string | null },
  signal?: AbortSignal,
): Promise<Record<string, string[]>> {
  const msg = await createLightweightMessage(
    {
      max_tokens: Math.min(512, labels.length * 48 + 64),
      temperature: 0,
      system: PALETTE_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({ labels }),
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
 */
export async function resolveClarificationPalettes(params: {
  options: ClarificationPaletteRequest[];
  userId?: string;
  conversationId?: string | null;
  signal?: AbortSignal;
}): Promise<ClarificationPaletteResult[]> {
  const uniqueByLabel = new Map<string, ClarificationPaletteRequest[]>();
  for (const option of params.options) {
    const label = option.label.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const bucket = uniqueByLabel.get(key) ?? [];
    bucket.push(option);
    uniqueByLabel.set(key, bucket);
  }

  if (!uniqueByLabel.size) return [];

  const labels = [...uniqueByLabel.keys()].map(
    (key) => uniqueByLabel.get(key)![0]!.label,
  );

  const cached = await Promise.all(
    labels.map(async (label) => ({
      label,
      colors: await readCachedPalette(label),
    })),
  );

  const resultByLabel = new Map<string, string[]>();
  const missing: string[] = [];
  for (const row of cached) {
    if (row.colors?.length) {
      resultByLabel.set(row.label.toLowerCase(), row.colors);
    } else {
      missing.push(row.label);
    }
  }

  if (missing.length) {
    let modelPalettes: Record<string, string[]> = {};
    try {
      modelPalettes = await callPaletteModel(
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
        const colors =
          modelPalettes[label] ?? paletteFallbackForLabel(label);
        resultByLabel.set(label.toLowerCase(), colors);
        if (modelPalettes[label]) {
          await writeCachedPalette(label, colors);
        }
      }),
    );
  }

  const out: ClarificationPaletteResult[] = [];
  for (const [key, options] of uniqueByLabel) {
    const colors =
      resultByLabel.get(key) ?? paletteFallbackForLabel(options[0]!.label);
    for (const option of options) {
      out.push({ optionId: option.id, paletteColors: colors });
    }
  }
  return out;
}
