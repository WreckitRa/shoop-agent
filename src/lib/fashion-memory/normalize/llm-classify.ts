import { z } from "zod";
import { logAiChat } from "@/lib/ai-chat/observability";
import { tracedLLMCall } from "../observability/traced-llm-call";
import { COLOR_BUCKETS } from "./types";
import { FASHION_NORMALIZE_MODEL } from "../models";
import type { NormalizedSize, SizeCategory } from "./types";

export const CLASSIFY_LABELS_TOOL_NAME = "classify_labels";

const normalizedSizeSchema = z.object({
  alpha: z.enum(["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"]).optional(),
  numeric: z.number().optional(),
  numeric_system: z
    .enum(["eu", "us", "uk", "waist", "ambiguous"])
    .optional(),
  inseam: z.number().optional(),
  fit_modifier: z
    .enum(["slim", "regular", "relaxed", "oversized", "petite", "tall"])
    .optional(),
  one_size: z.boolean().optional(),
});

export const classifyLabelsResultSchema = z.object({
  colors: z.array(
    z.object({
      raw: z.string(),
      buckets: z.array(z.enum(COLOR_BUCKETS)).min(1),
    }),
  ),
  sizes: z.array(
    z.object({
      raw: z.string(),
      category: z.string(),
      size: normalizedSizeSchema.nullable(),
    }),
  ),
});

export type ClassifyLabelsResult = z.infer<typeof classifyLabelsResultSchema>;

const ALPHA_SET = new Set([
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "XXXL",
]);

function coerceNormalizedSize(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return raw;
  const size = { ...(raw as Record<string, unknown>) };
  if (size.alpha != null) {
    const alpha = String(size.alpha).trim().toUpperCase();
    if (ALPHA_SET.has(alpha)) {
      size.alpha = alpha;
    } else {
      // Model often puts waist/shoe numbers in alpha — move to numeric.
      const asNum = Number(String(size.alpha).replace(/[^0-9.]/g, ""));
      if (Number.isFinite(asNum) && size.numeric == null) {
        size.numeric = asNum;
        if (size.numeric_system == null) size.numeric_system = "ambiguous";
      }
      delete size.alpha;
    }
  }
  return size;
}

/** Recover per-label when the model puts numbers in alpha or drifts enums. */
export function coerceClassifyLabelsInput(raw: unknown): unknown {
  const root =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  if (!root) return raw;

  const colors = Array.isArray(root.colors)
    ? root.colors.map((c) => {
        if (!c || typeof c !== "object") return c;
        const row = c as Record<string, unknown>;
        const buckets = Array.isArray(row.buckets)
          ? row.buckets
              .map((b) => String(b).trim().toLowerCase())
              .filter((b) =>
                (COLOR_BUCKETS as readonly string[]).includes(b),
              )
          : [];
        return {
          ...row,
          raw: String(row.raw ?? ""),
          buckets: buckets.length ? buckets : ["unknown"],
        };
      })
    : [];

  const sizes = Array.isArray(root.sizes)
    ? root.sizes.map((s) => {
        if (!s || typeof s !== "object") return s;
        const row = s as Record<string, unknown>;
        return {
          ...row,
          raw: String(row.raw ?? ""),
          category: String(row.category ?? "general"),
          size: coerceNormalizedSize(row.size),
        };
      })
    : [];

  return { ...root, colors, sizes };
}

export const CLASSIFY_LABELS_TOOL = {
  name: CLASSIFY_LABELS_TOOL_NAME,
  description: "Classify unresolved merchant color and size labels.",
  input_schema: {
    type: "object" as const,
    properties: {
      colors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            raw: { type: "string" },
            buckets: { type: "array", items: { type: "string" } },
          },
          required: ["raw", "buckets"],
        },
      },
      sizes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            raw: { type: "string" },
            category: { type: "string" },
            size: { type: ["object", "null"] },
          },
          required: ["raw", "category", "size"],
        },
      },
    },
    required: ["colors", "sizes"],
  },
};

const CLASSIFY_LABELS_SYSTEM_PROMPT = `You classify messy merchant clothing labels into canonical form. You are
given color labels and size labels (with the garment category each size
belongs to). Labels may contain typos, any language, or merchant noise —
classify by meaning, not spelling.

Colors: map each label to one or more buckets from exactly this list:
black, white, grey, beige, brown, navy, blue, green, olive, red,
burgundy, pink, purple, orange, yellow, gold, silver, denim, multi,
print, unknown.
Rules: descriptive modifiers (washed, dark, vintage...) are not colors.
Two-tone labels get both buckets. Marketing names map to their visual
color ("champagne"→beige, "graphite"→grey). If no color meaning can be
recovered, use ["unknown"].

Sizes: extract structured fields {alpha, numeric, numeric_system,
inseam, fit_modifier, one_size}. alpha is ONLY letter sizes
(XXS/XS/S/M/L/XL/XXL/XXXL) — never put waist, shoe, or dress numbers
in alpha; those go in numeric (+ numeric_system). numeric_system is
'eu','us','uk','waist' ONLY when the label or category makes it certain
(e.g. "EU 40", "W32", shoe sizes 35-50 are eu); otherwise 'ambiguous'.
Use the garment category to interpret bare numbers where certain. If
the label carries no size information at all, return null for that label.

Never skip a label. Never invent fields the label does not support.
Call classify_labels exactly once.`;

export type LlmLabelBatch = {
  colors: string[];
  sizes: Array<{ raw: string; category: SizeCategory }>;
};

function buildUserMessage(batch: LlmLabelBatch): string {
  return JSON.stringify(
    {
      color_labels: batch.colors,
      size_labels: batch.sizes.map((s) => ({
        raw: s.raw,
        category: s.category,
      })),
    },
    null,
    2,
  );
}

export async function classifyLabelsWithLlm(params: {
  batch: LlmLabelBatch;
  traceId?: string | null;
  signal?: AbortSignal;
  createMessage?: typeof tracedLLMCall;
}): Promise<ClassifyLabelsResult | null> {
  if (!params.batch.colors.length && !params.batch.sizes.length) {
    return { colors: [], sizes: [] };
  }

  const createMessage = params.createMessage ?? tracedLLMCall;

  try {
    const response = await createMessage({
      traceId: params.traceId,
      stage: "normalize_llm",
      model: FASHION_NORMALIZE_MODEL,
      maxTokens: 2048,
      temperature: 0,
      systemPrompt: CLASSIFY_LABELS_SYSTEM_PROMPT,
      inputMessages: [
        { role: "user", content: buildUserMessage(params.batch) },
      ],
      tools: [CLASSIFY_LABELS_TOOL],
      toolChoice: { type: "tool", name: CLASSIFY_LABELS_TOOL_NAME },
      signal: params.signal,
    });

    const toolBlock = response.content.find(
      (block) =>
        block.type === "tool_use" && block.name === CLASSIFY_LABELS_TOOL_NAME,
    );
    if (!toolBlock || toolBlock.type !== "tool_use") {
      logAiChat("warn", "fashion_normalize_missing_tool_use", {
        stopReason: response.stop_reason,
      });
      return null;
    }

    const coerced = coerceClassifyLabelsInput({
      colors: (toolBlock.input as { colors?: unknown }).colors ?? [],
      sizes: (toolBlock.input as { sizes?: unknown }).sizes ?? [],
    });
    const parsed = classifyLabelsResultSchema.safeParse(coerced);
    if (!parsed.success) {
      logAiChat("warn", "fashion_normalize_tool_schema_mismatch", {
        issues: parsed.error.issues.map(
          (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
        ),
      });
      return null;
    }
    return parsed.data;
  } catch (error) {
    logAiChat("warn", "fashion_normalize_llm_failed", {
      error: String(error).slice(0, 240),
    });
    return null;
  }
}
