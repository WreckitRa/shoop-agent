import { z } from "zod";
import { logAiChat } from "@/lib/ai-chat/observability";
import { safeTrim } from "../safe-trim";
import type { FashionSearchPlan, SearchPlanMode } from "./types";

export const PLAN_SEARCH_TOOL_NAME = "plan_search";

export const PLAN_REASONING_MAX = 1200;
export const PLAN_STYLE_DIRECTION_MAX = 500;
export const PLAN_PALETTE_CONSTRAINT_MAX = 200;
export const PLAN_QUERY_VARIANT_MAX = 120;

const searchPlanModeSchema = z.enum([
  "single_item",
  "outfit",
  "capsule",
  "multi_item",
]);

const slotRoleSchema = z.enum(["anchor", "support"]);

export const searchPlanSlotSchema = z.object({
  slot_id: z.string().min(1).max(80),
  garment: z.string().min(1).max(80),
  role: slotRoleSchema,
  style_direction: z.string().min(1).max(PLAN_STYLE_DIRECTION_MAX),
  palette_constraint: z
    .string()
    .min(1)
    .max(PLAN_PALETTE_CONSTRAINT_MAX)
    .nullable(),
  palette_source: z.enum(["stated", "profile", "occasion_default", "spread"]),
  options_wanted: z.number().int().min(1).max(8),
  query_variants: z
    .array(z.string().min(2).max(PLAN_QUERY_VARIANT_MAX))
    .min(1)
    .max(3),
  budget_fraction: z.number().min(0).max(1).optional(),
});

export const planSearchInputSchema = z.object({
  mode: searchPlanModeSchema,
  slots: z.array(searchPlanSlotSchema).min(1).max(5),
  reasoning: z.string().min(1).max(PLAN_REASONING_MAX),
});

export type PlanSearchInput = z.infer<typeof planSearchInputSchema>;
export type SearchPlanSlotInput = z.infer<typeof searchPlanSlotSchema>;

export const PLAN_SEARCH_TOOL = {
  name: PLAN_SEARCH_TOOL_NAME,
  description:
    "Emit the catalog retrieval plan: slots, options_wanted, and query variants.",
  input_schema: {
    type: "object" as const,
    properties: {
      mode: {
        type: "string",
        enum: ["single_item", "outfit", "capsule", "multi_item"],
      },
      slots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slot_id: { type: "string" },
            garment: { type: "string" },
            role: { type: "string", enum: ["anchor", "support"] },
            style_direction: { type: "string" },
            palette_constraint: { type: ["string", "null"] },
            palette_source: {
              type: "string",
              enum: ["stated", "profile", "occasion_default", "spread"],
            },
            options_wanted: { type: "integer" },
            query_variants: { type: "array", items: { type: "string" } },
            budget_fraction: { type: "number" },
          },
          required: [
            "slot_id",
            "garment",
            "role",
            "style_direction",
            "palette_constraint",
            "palette_source",
            "options_wanted",
            "query_variants",
          ],
        },
      },
      reasoning: { type: "string" },
    },
    required: ["mode", "slots", "reasoning"],
  },
};

function clampStr(value: unknown, max: number): string | unknown {
  if (typeof value !== "string") return value;
  return value.length > max ? value.slice(0, max) : value;
}

function coercePlanSearchRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  obj.reasoning = clampStr(obj.reasoning, PLAN_REASONING_MAX);
  if (Array.isArray(obj.slots)) {
    obj.slots = obj.slots.map((slot) => {
      if (!slot || typeof slot !== "object") return slot;
      const s = { ...(slot as Record<string, unknown>) };
      s.slot_id = clampStr(s.slot_id, 80);
      s.garment = clampStr(s.garment, 80);
      s.style_direction = clampStr(s.style_direction, PLAN_STYLE_DIRECTION_MAX);
      if (s.palette_constraint != null) {
        s.palette_constraint = clampStr(
          s.palette_constraint,
          PLAN_PALETTE_CONSTRAINT_MAX,
        );
      }
      if (Array.isArray(s.query_variants)) {
        s.query_variants = s.query_variants.map((q) =>
          clampStr(q, PLAN_QUERY_VARIANT_MAX),
        );
      }
      return s;
    });
  }
  return obj;
}

export function parsePlanSearchInput(raw: unknown): PlanSearchInput | null {
  const parsed = planSearchInputSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const coerced = planSearchInputSchema.safeParse(coercePlanSearchRaw(raw));
  if (coerced.success) {
    logAiChat("warn", "fashion_search_planner_coerced", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
        message: i.message,
      })),
    });
    return coerced.data;
  }

  logAiChat("warn", "fashion_search_planner_parse_failed", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      code: i.code,
      message: i.message,
    })),
  });
  return null;
}

export function toFashionSearchPlan(params: {
  input: PlanSearchInput;
  brief: import("../router/types").FashionSearchBrief;
  currentDate: string;
}): FashionSearchPlan {
  return {
    version: 1,
    mode: params.input.mode as SearchPlanMode,
    slots: params.input.slots.map((s) => ({
      slot_id: safeTrim(s.slot_id),
      garment: safeTrim(s.garment),
      role: s.role,
      style_direction: safeTrim(s.style_direction),
      palette_constraint:
        s.palette_constraint == null ? null : safeTrim(s.palette_constraint),
      palette_source: s.palette_source,
      options_wanted: s.options_wanted,
      query_variants: s.query_variants.map((q) => safeTrim(q)).filter(Boolean),
      ...(s.budget_fraction != null && Number.isFinite(s.budget_fraction)
        ? { budget_fraction: s.budget_fraction }
        : {}),
    })),
    reasoning: safeTrim(params.input.reasoning),
    brief: params.brief,
    currentDate: params.currentDate,
  };
}
