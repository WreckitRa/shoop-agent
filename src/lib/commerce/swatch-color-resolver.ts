import { z } from "zod";
import { createLightweightMessage } from "@/lib/ai-chat/anthropic";
import { logAiChat } from "@/lib/ai-chat/observability";
import { stripJsonFence, stripNullFields } from "@/lib/ai-chat/shopping-memory/llm-json";
import { swatchColorFallbackFromLabel } from "@/lib/commerce/swatch-color-fallback";

const SWATCH_SYSTEM = `Map e-commerce color variant labels to realistic #RRGGBB hex swatch colors.

Return one JSON object only. Keys must be the exact input labels. Values must be lowercase #RRGGBB (6 hex digits).
When a label lists multiple colors (e.g. "Linen / Lilac"), pick the dominant garment color shoppers expect.`;

const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** Process-wide cache: each distinct label hits the model at most once. */
const labelCache = new Map<string, string>();

export function normalizeSwatchLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

function parseHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  const withHash = normalized.startsWith("#") ? normalized : `#${normalized}`;
  return HEX_COLOR.test(withHash) ? withHash : null;
}

async function callSwatchColorModel(
  labels: string[],
  audit: {
    userId: string;
    productId?: string | null;
  },
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const msg = await createLightweightMessage(
    {
      max_tokens: Math.min(256, labels.length * 12 + 24),
      temperature: 0,
      system: SWATCH_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify(labels),
        },
      ],
    },
    {
      signal,
      audit: {
        userId: audit.userId,
        kind: "swatch_color",
        sequence: 0,
        metadata: {
          labelCount: labels.length,
          labels: labels.slice(0, 24),
          productId: audit.productId ?? null,
          source: "product_page",
        },
      },
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
  const schema = z.record(z.string(), z.string());
  const out = schema.safeParse(parsed);
  if (!out.success) return {};

  const colors: Record<string, string> = {};
  for (const label of labels) {
    const hex = parseHex(out.data[label]);
    if (hex) colors[label] = hex;
  }
  return colors;
}

/**
 * Resolve swatch hex colors for variant labels. Cached labels are free;
 * uncached labels are batched into a single Haiku call.
 */
export async function resolveSwatchColors(
  labels: string[],
  options: {
    userId: string;
    signal?: AbortSignal;
    productId?: string | null;
  },
): Promise<Record<string, string>> {
  const { userId, signal, productId } = options;
  const unique = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  const result: Record<string, string> = {};
  const missing: string[] = [];

  for (const label of unique) {
    const cached = labelCache.get(normalizeSwatchLabelKey(label));
    if (cached) {
      result[label] = cached;
    } else {
      missing.push(label);
    }
  }

  if (!missing.length) return result;

  let modelColors: Record<string, string> = {};
  try {
    modelColors = await callSwatchColorModel(
      missing,
      { userId, productId },
      signal,
    );
  } catch (error) {
    logAiChat("warn", "swatch_color_model_failed", {
      labelCount: missing.length,
      error,
    });
  }

  for (const label of missing) {
    const hex =
      modelColors[label] ?? swatchColorFallbackFromLabel(label);
    labelCache.set(normalizeSwatchLabelKey(label), hex);
    result[label] = hex;
  }

  return result;
}
