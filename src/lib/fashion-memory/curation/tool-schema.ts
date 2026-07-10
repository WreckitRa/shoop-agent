import { z } from "zod";
import { logAiChat } from "@/lib/ai-chat/observability";
import { CURATION_TOOL_NAME } from "./config";
import type { DeliverCurationInput } from "./types";

const pickRoleSchema = z.enum([
  "safe",
  "stretch",
  "value",
  "reach",
  "anchor",
  "support",
]);

const vetoReasonSchema = z.enum([
  "wrong_item_type",
  "wrong_department_visual",
  "color_mismatch_visual",
  "visibly_off_brief",
  "quality_visual",
  "duplicate_of_pick",
  "exclusion_violation",
]);

export const deliverCurationPickSchema = z.object({
  ref: z.string().min(1).max(40),
  role: pickRoleSchema,
  stylist_line: z.string().min(8).max(400),
  corrected_color: z.string().min(1).max(80).optional(),
});

export const deliverCurationSlotSchema = z.object({
  slot_id: z.string().min(1).max(80),
  picks: z.array(deliverCurationPickSchema).max(8),
});

export const deliverCurationLookSchema = z.object({
  name: z.string().min(1).max(120),
  item_refs: z.array(z.string().min(1).max(40)).min(1),
  total: z.number().finite(),
  note: z.string().max(300).optional(),
});

export const deliverCurationVetoSchema = z.object({
  ref: z.string().min(1).max(40),
  reason: vetoReasonSchema,
  evidence: z.string().min(4).max(400),
});

export const deliverCurationNarrationSchema = z.object({
  opening: z.string().min(8).max(800),
  brand_note: z.string().min(4).max(400).optional(),
  budget_note: z.string().min(4).max(400).optional(),
  thin_note: z.string().min(4).max(400).optional(),
});

export const deliverCurationInputSchema = z.object({
  slots: z.array(deliverCurationSlotSchema).min(1),
  looks: z.array(deliverCurationLookSchema).optional(),
  capsule_outfits: z
    .array(
      z.object({
        item_refs: z.array(z.string().min(1).max(40)).min(1),
        label: z.string().max(120).optional(),
      }),
    )
    .optional(),
  vetoes: z.array(deliverCurationVetoSchema),
  narration: deliverCurationNarrationSchema,
});

export const DELIVER_CURATION_TOOL = {
  name: CURATION_TOOL_NAME,
  description:
    "Deliver the curated presentation: picks per slot, optional looks, vetoes, narration.",
  input_schema: {
    type: "object" as const,
    properties: {
      slots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slot_id: { type: "string" },
            picks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  ref: { type: "string" },
                  role: {
                    type: "string",
                    enum: [
                      "safe",
                      "stretch",
                      "value",
                      "reach",
                      "anchor",
                      "support",
                    ],
                  },
                  stylist_line: { type: "string" },
                  corrected_color: { type: "string" },
                },
                required: ["ref", "role", "stylist_line"],
              },
            },
          },
          required: ["slot_id", "picks"],
        },
      },
      looks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            item_refs: { type: "array", items: { type: "string" } },
            total: { type: "number" },
            note: { type: "string" },
          },
          required: ["name", "item_refs", "total"],
        },
      },
      capsule_outfits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item_refs: { type: "array", items: { type: "string" } },
            label: { type: "string" },
          },
          required: ["item_refs"],
        },
      },
      vetoes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string" },
            reason: {
              type: "string",
              enum: [
                "wrong_item_type",
                "wrong_department_visual",
                "color_mismatch_visual",
                "visibly_off_brief",
                "quality_visual",
                "duplicate_of_pick",
                "exclusion_violation",
              ],
            },
            evidence: { type: "string" },
          },
          required: ["ref", "reason", "evidence"],
        },
      },
      narration: {
        type: "object",
        properties: {
          opening: { type: "string" },
          brand_note: { type: "string" },
          budget_note: { type: "string" },
          thin_note: { type: "string" },
        },
        required: ["opening"],
      },
    },
    required: ["slots", "vetoes", "narration"],
  },
};

const ROLE_ALIASES: Record<string, z.infer<typeof pickRoleSchema>> = {
  safe: "safe",
  stretch: "stretch",
  value: "value",
  reach: "reach",
  anchor: "anchor",
  support: "support",
  hero: "anchor",
  primary: "anchor",
  premium: "stretch",
  budget: "value",
};

const VETO_ALIASES: Record<string, z.infer<typeof vetoReasonSchema>> = {
  wrong_item_type: "wrong_item_type",
  wrong_type: "wrong_item_type",
  wrong_department_visual: "wrong_department_visual",
  wrong_department: "wrong_department_visual",
  color_mismatch_visual: "color_mismatch_visual",
  color_mismatch: "color_mismatch_visual",
  visibly_off_brief: "visibly_off_brief",
  off_brief: "visibly_off_brief",
  quality_visual: "quality_visual",
  quality: "quality_visual",
  duplicate_of_pick: "duplicate_of_pick",
  duplicate: "duplicate_of_pick",
  exclusion_violation: "exclusion_violation",
};

function clampLen(
  text: string,
  min: number,
  max: number,
  fallback: string,
): string {
  let t = String(text ?? "").trim();
  if (!t) t = fallback;
  if (t.length > max) t = t.slice(0, max).trimEnd();
  if (t.length < min) t = `${t}${".".repeat(Math.max(0, min - t.length))}`;
  return t;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Soften common Opus schema drift so a near-valid tool call still parses. */
export function coerceDeliverCurationInput(raw: unknown): unknown {
  const root = asRecord(raw);
  if (!root) return raw;

  const out: Record<string, unknown> = { ...root };

  if (!Array.isArray(out.vetoes)) out.vetoes = [];
  if (Array.isArray(out.vetoes)) {
    out.vetoes = out.vetoes
      .map((v) => {
        const row = asRecord(v);
        if (!row) return null;
        const reasonRaw = String(row.reason ?? "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "_");
        const aliased = VETO_ALIASES[reasonRaw];
        const reason = aliased ?? "visibly_off_brief";
        if (!aliased && reasonRaw) {
          logAiChat("warn", "fashion_curation_veto_reason_coerced", {
            original: reasonRaw,
            coerced: reason,
          });
        }
        return {
          ...row,
          ref: String(row.ref ?? "").trim(),
          reason,
          original_reason: reasonRaw || undefined,
          evidence: clampLen(
            String(row.evidence ?? ""),
            4,
            400,
            "Off brief visually.",
          ),
        };
      })
      .filter(Boolean);
  }

  const narration = asRecord(out.narration) ?? {};
  out.narration = {
    ...narration,
    opening: clampLen(
      String(narration.opening ?? ""),
      8,
      800,
      "Here is the curated edit.",
    ),
    ...(narration.brand_note != null
      ? { brand_note: clampLen(String(narration.brand_note), 4, 400, "Brand note.") }
      : {}),
    ...(narration.budget_note != null
      ? {
          budget_note: clampLen(
            String(narration.budget_note),
            4,
            400,
            "Budget note.",
          ),
        }
      : {}),
    ...(narration.thin_note != null
      ? { thin_note: clampLen(String(narration.thin_note), 4, 400, "Thin note.") }
      : {}),
  };

  if (Array.isArray(out.slots)) {
    out.slots = out.slots
      .map((slot) => {
        const s = asRecord(slot);
        if (!s) return null;
        const picks = Array.isArray(s.picks)
          ? s.picks
              .map((p) => {
                const pick = asRecord(p);
                if (!pick) return null;
                const roleRaw = String(pick.role ?? "")
                  .trim()
                  .toLowerCase();
                const role = ROLE_ALIASES[roleRaw] ?? "support";
                return {
                  ...pick,
                  ref: String(pick.ref ?? "").trim(),
                  role,
                  stylist_line: clampLen(
                    String(pick.stylist_line ?? ""),
                    8,
                    400,
                    "Solid on-brief pick.",
                  ),
                  ...(pick.corrected_color != null
                    ? {
                        corrected_color: clampLen(
                          String(pick.corrected_color),
                          1,
                          80,
                          "unknown",
                        ),
                      }
                    : {}),
                };
              })
              .filter(Boolean)
          : [];
        return {
          ...s,
          slot_id: String(s.slot_id ?? "").trim(),
          picks,
        };
      })
      .filter(Boolean);
  }

  if (Array.isArray(out.looks)) {
    out.looks = out.looks
      .map((look) => {
        const l = asRecord(look);
        if (!l) return null;
        const total =
          typeof l.total === "number"
            ? l.total
            : Number(String(l.total ?? "").replace(/[^0-9.]/g, ""));
        return {
          ...l,
          name: clampLen(String(l.name ?? ""), 1, 120, "Look"),
          item_refs: Array.isArray(l.item_refs)
            ? l.item_refs.map((r) => String(r))
            : [],
          total: Number.isFinite(total) ? total : 0,
          ...(l.note != null
            ? { note: clampLen(String(l.note), 0, 300, "") }
            : {}),
        };
      })
      .filter(Boolean);
  }

  return out;
}

export function parseDeliverCurationInput(
  raw: unknown,
): DeliverCurationInput | null {
  const coerced = coerceDeliverCurationInput(raw);
  const parsed = deliverCurationInputSchema.safeParse(coerced);
  return parsed.success ? parsed.data : null;
}

export type ExtractDeliverCurationResult = {
  output: DeliverCurationInput | null;
  toolName: string | null;
  parseError: string | null;
  hadToolUse: boolean;
};

export function extractDeliverCurationBlockDetailed(
  content: import("@anthropic-ai/sdk/resources/messages/messages").ContentBlock[],
): ExtractDeliverCurationResult {
  const toolBlocks = content.filter((b) => b.type === "tool_use");
  const hadToolUse = toolBlocks.length > 0;
  const match = toolBlocks.find(
    (b) => b.type === "tool_use" && b.name === CURATION_TOOL_NAME,
  );

  if (!match || match.type !== "tool_use") {
    return {
      output: null,
      toolName:
        toolBlocks[0] && toolBlocks[0].type === "tool_use"
          ? toolBlocks[0].name
          : null,
      parseError: hadToolUse
        ? `tool_use present but name was not ${CURATION_TOOL_NAME}`
        : "no tool_use block",
      hadToolUse,
    };
  }

  const coerced = coerceDeliverCurationInput(match.input);
  const parsed = deliverCurationInputSchema.safeParse(coerced);
  if (parsed.success) {
    return {
      output: parsed.data,
      toolName: match.name,
      parseError: null,
      hadToolUse: true,
    };
  }

  return {
    output: null,
    toolName: match.name,
    parseError: parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ")
      .slice(0, 600),
    hadToolUse: true,
  };
}

/**
 * Harvest vetoes even when the surrounding deliver_curation payload fails
 * schema validation. A veto with evidence is a product fact.
 */
export function harvestVetoesFromToolContent(
  content: import("@anthropic-ai/sdk/resources/messages/messages").ContentBlock[],
): DeliverCurationInput["vetoes"] {
  const match = content.find(
    (b) => b.type === "tool_use" && b.name === CURATION_TOOL_NAME,
  );
  if (!match || match.type !== "tool_use") return [];

  const coerced = coerceDeliverCurationInput(match.input);
  const root =
    coerced && typeof coerced === "object" && !Array.isArray(coerced)
      ? (coerced as Record<string, unknown>)
      : null;
  if (!root || !Array.isArray(root.vetoes)) return [];

  const out: DeliverCurationInput["vetoes"] = [];
  for (const row of root.vetoes) {
    const parsed = deliverCurationVetoSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function extractDeliverCurationBlock(
  content: import("@anthropic-ai/sdk/resources/messages/messages").ContentBlock[],
): DeliverCurationInput | null {
  return extractDeliverCurationBlockDetailed(content).output;
}
