import { z } from "zod";
import { logAiChat } from "@/lib/ai-chat/observability";
import { ensureQuestionsHaveQuickOptions } from "./clarification-defaults";
import type { FashionSearchBrief } from "./types";

export const RESPOND_OFF_TOPIC_TOOL_NAME = "respond_off_topic";
export const ASK_CLARIFICATION_TOOL_NAME = "ask_clarification";
export const READY_TO_SEARCH_TOOL_NAME = "ready_to_search";

export const ROUTER_STYLE_DIRECTION_MAX = 500;
export const ROUTER_OCCASION_MAX = 200;
export const ROUTER_REPLY_MAX = 2000;
export const ROUTER_MUST_HAVE_MAX = 120;

export const FASHION_ROUTER_TOOL_NAMES = [
  RESPOND_OFF_TOPIC_TOOL_NAME,
  ASK_CLARIFICATION_TOOL_NAME,
  READY_TO_SEARCH_TOOL_NAME,
] as const;

const budgetContextSchema = z.object({
  max: z.number().optional(),
  min: z.number().optional(),
  currency: z.string().max(8).optional(),
  stated: z.boolean().default(false),
  /** Stated scope from "each" / "per item" / "a piece" language. */
  scope: z.enum(["per_item", "total"]).optional(),
});

const colorDirectionSchema = z.object({
  source: z.enum(["stated", "profile", "none"]),
  stated_colors: z.array(z.string().min(1).max(40)).max(8).optional(),
});

const brandDirectionSchema = z.object({
  source: z.enum(["stated", "profile", "none"]),
  brands: z.array(z.string().min(1).max(80)).max(8).optional(),
});

export const statedFactsSchema = z
  .object({
    person_ref: z.union([z.literal("new"), z.string().min(1).max(80)]),
    new_person: z
      .object({
        name: z.string().min(1).max(80).optional(),
        relation: z.string().min(1).max(40).optional(),
      })
      .optional(),
    department: z
      .enum(["mens", "womens", "boys", "girls", "baby", "mixed"])
      .optional(),
    sizes: z
      .object({
        tops: z.string().min(1).max(40).optional(),
        bottoms: z.string().min(1).max(40).optional(),
        shoes: z.string().min(1).max(40).optional(),
        dresses: z.string().min(1).max(40).optional(),
      })
      .optional(),
    budget: z
      .object({
        max: z.number().optional(),
        currency: z.string().max(8).optional(),
      })
      .optional(),
  })
  .optional();

const statedFactsJsonSchema = {
  type: "object" as const,
  properties: {
    person_ref: { type: "string" },
    new_person: {
      type: "object",
      properties: {
        name: { type: "string" },
        relation: { type: "string" },
      },
    },
    department: {
      type: "string",
      enum: ["mens", "womens", "boys", "girls", "baby", "mixed"],
    },
    sizes: {
      type: "object",
      properties: {
        tops: { type: "string" },
        bottoms: { type: "string" },
        shoes: { type: "string" },
        dresses: { type: "string" },
      },
    },
    budget: {
      type: "object",
      properties: {
        max: { type: "number" },
        currency: { type: "string" },
      },
    },
  },
  required: ["person_ref"],
};

export const fashionSearchBriefSchema = z.object({
  recipient_person_id: z.string().min(1).max(80),
  request_type: z.enum(["single_item", "outfit", "capsule", "multi_item"]),
  garments: z.array(z.string().min(1).max(80)).min(1).max(12),
  occasion_context: z.string().min(1).max(ROUTER_OCCASION_MAX),
  quantity_hint: z.string().max(ROUTER_OCCASION_MAX).default("one"),
  must_haves: z.array(z.string().max(ROUTER_MUST_HAVE_MAX)).max(16).default([]),
  nice_to_haves: z
    .array(z.string().max(ROUTER_MUST_HAVE_MAX))
    .max(16)
    .default([]),
  budget_context: budgetContextSchema.default({ stated: false }),
  style_direction: z
    .string()
    .max(ROUTER_STYLE_DIRECTION_MAX)
    .transform((value) => value.trim() || "general"),
  department_scope: z
    .enum(["mens", "womens", "boys", "girls", "baby", "mixed"])
    .optional(),
  color_direction: colorDirectionSchema.optional(),
  brand_direction: brandDirectionSchema.optional(),
  stated_facts: statedFactsSchema,
});

export const respondOffTopicInputSchema = z.object({
  reply: z.string().min(1).max(ROUTER_REPLY_MAX),
});

export const clarificationGapSchema = z.enum([
  "garment",
  "recipient",
  "person_name",
  "department",
  "size",
  "occasion",
  "budget",
]);

export const clarificationQuestionSchema = z.object({
  text: z.string().min(1).max(500),
  gap: clarificationGapSchema,
  garment_type: z.string().min(1).max(80).optional(),
  // Preferred; if omitted the server fills defaults + Other.
  quick_options: z.array(z.string().min(1).max(120)).min(2).max(6).optional(),
});

export const askClarificationInputSchema = z.object({
  reply: z.string().min(1).max(ROUTER_REPLY_MAX),
  questions: z.array(clarificationQuestionSchema).min(1).max(4),
  ride_along: z
    .object({
      text: z.string().min(1).max(500),
      quick_options: z.array(z.string().min(1).max(120)).min(2).max(6),
    })
    .optional(),
  stated_facts: statedFactsSchema,
});

export const readyToSearchInputSchema = z.object({
  brief: fashionSearchBriefSchema,
});

export type FashionSearchBriefParsed = z.infer<typeof fashionSearchBriefSchema>;

export const RESPOND_OFF_TOPIC_TOOL = {
  name: RESPOND_OFF_TOPIC_TOOL_NAME,
  description: "Redirect when nothing shoppable is happening; include 2–3 suggestions when conversation allows.",
  input_schema: {
    type: "object" as const,
    properties: {
      reply: { type: "string", description: "Warm redirect to show the user." },
    },
    required: ["reply"],
  },
};

export const ASK_CLARIFICATION_TOOL = {
  name: ASK_CLARIFICATION_TOOL_NAME,
  description:
    "Ask 1–4 blocking clarifications in one turn. Bundle all currently-blocking gaps. Every question MUST include 2–5 short quick_options plus the user can always type Other. Optional ride_along for one nice-to-have with an opt-out. Copy any conversation-stated essentials into stated_facts even when still clarifying.",
  input_schema: {
    type: "object" as const,
    properties: {
      reply: {
        type: "string",
        description:
          "Intro line (value-framing when essentials are asked).",
      },
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            gap: {
              type: "string",
              enum: [
                "garment",
                "recipient",
                "person_name",
                "department",
                "size",
                "occasion",
                "budget",
              ],
            },
            garment_type: { type: "string" },
            quick_options: {
              type: "array",
              items: { type: "string" },
              description:
                "2–5 short tappable answers. Always include discrete sizes/sections when asking size or department.",
            },
          },
          required: ["text", "gap", "quick_options"],
        },
      },
      ride_along: {
        type: "object",
        properties: {
          text: { type: "string" },
          quick_options: { type: "array", items: { type: "string" } },
        },
        required: ["text", "quick_options"],
      },
      stated_facts: statedFactsJsonSchema,
    },
    required: ["reply", "questions"],
  },
};

export const READY_TO_SEARCH_TOOL = {
  name: READY_TO_SEARCH_TOOL_NAME,
  description:
    "Proceed to catalog search with a structured brief. Always copy conversation-stated essentials into brief.stated_facts.",
  input_schema: {
    type: "object" as const,
    properties: {
      brief: {
        type: "object",
        properties: {
          recipient_person_id: { type: "string" },
          request_type: {
            type: "string",
            enum: ["single_item", "outfit", "capsule", "multi_item"],
          },
          garments: { type: "array", items: { type: "string" } },
          occasion_context: { type: "string" },
          quantity_hint: { type: "string" },
          must_haves: { type: "array", items: { type: "string" } },
          nice_to_haves: { type: "array", items: { type: "string" } },
          budget_context: {
            type: "object",
            properties: {
              max: { type: "number" },
              min: { type: "number" },
              currency: { type: "string" },
              stated: { type: "boolean" },
              scope: {
                type: "string",
                enum: ["per_item", "total"],
                description:
                  'Use "per_item" for "under $50 each" / "$50 per item" / "max $50 a piece". Use "total" only when the user clearly states a set/outfit total.',
              },
            },
            required: ["stated"],
          },
          style_direction: { type: "string" },
          department_scope: {
            type: "string",
            enum: ["mens", "womens", "boys", "girls", "baby", "mixed"],
          },
          color_direction: {
            type: "object",
            properties: {
              source: {
                type: "string",
                enum: ["stated", "profile", "none"],
              },
              stated_colors: { type: "array", items: { type: "string" } },
            },
            required: ["source"],
          },
          brand_direction: {
            type: "object",
            properties: {
              source: {
                type: "string",
                enum: ["stated", "profile", "none"],
              },
              brands: { type: "array", items: { type: "string" } },
            },
            required: ["source"],
          },
          stated_facts: statedFactsJsonSchema,
        },
        required: [
          "recipient_person_id",
          "request_type",
          "garments",
          "occasion_context",
          "quantity_hint",
          "must_haves",
          "nice_to_haves",
          "budget_context",
          "style_direction",
        ],
      },
    },
    required: ["brief"],
  },
};

export const FASHION_ROUTER_TOOLS = [
  RESPOND_OFF_TOPIC_TOOL,
  ASK_CLARIFICATION_TOOL,
  READY_TO_SEARCH_TOOL,
];

export function formatFashionRouterParseError(
  toolName: string,
  raw: unknown,
): string | null {
  const schemas: Record<string, z.ZodTypeAny> = {
    [RESPOND_OFF_TOPIC_TOOL_NAME]: respondOffTopicInputSchema,
    [ASK_CLARIFICATION_TOOL_NAME]: askClarificationInputSchema,
    [READY_TO_SEARCH_TOOL_NAME]: readyToSearchInputSchema,
  };
  const schema = schemas[toolName];
  if (!schema) return `unknown tool: ${toolName}`;
  const parsed = schema.safeParse(raw);
  if (parsed.success) return null;
  return parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function clampStr(value: unknown, max: number): unknown {
  if (typeof value !== "string") return value;
  return value.length > max ? value.slice(0, max) : value;
}

function coerceRouterToolRaw(toolName: string, raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = { ...(raw as Record<string, unknown>) };

  if (toolName === RESPOND_OFF_TOPIC_TOOL_NAME) {
    obj.reply = clampStr(obj.reply, ROUTER_REPLY_MAX);
    return obj;
  }

  if (toolName === ASK_CLARIFICATION_TOOL_NAME) {
    obj.reply = clampStr(obj.reply, ROUTER_REPLY_MAX);
    if (Array.isArray(obj.questions)) {
      obj.questions = obj.questions.map((q) => {
        if (!q || typeof q !== "object") return q;
        const question = { ...(q as Record<string, unknown>) };
        question.text = clampStr(question.text, 500);
        question.garment_type = clampStr(question.garment_type, 80);
        if (Array.isArray(question.quick_options)) {
          question.quick_options = question.quick_options.map((o) =>
            clampStr(o, 120),
          );
        }
        return question;
      });
    }
    return obj;
  }

  if (toolName === READY_TO_SEARCH_TOOL_NAME) {
    const briefRaw = obj.brief;
    if (briefRaw && typeof briefRaw === "object") {
      const brief = { ...(briefRaw as Record<string, unknown>) };
      brief.occasion_context = clampStr(brief.occasion_context, ROUTER_OCCASION_MAX);
      brief.quantity_hint = clampStr(brief.quantity_hint, ROUTER_OCCASION_MAX);
      brief.style_direction = clampStr(
        brief.style_direction,
        ROUTER_STYLE_DIRECTION_MAX,
      );
      brief.recipient_person_id = clampStr(brief.recipient_person_id, 80);
      if (Array.isArray(brief.garments)) {
        brief.garments = brief.garments.map((g) => clampStr(g, 80));
      }
      if (Array.isArray(brief.must_haves)) {
        brief.must_haves = brief.must_haves.map((m) =>
          clampStr(m, ROUTER_MUST_HAVE_MAX),
        );
      }
      if (Array.isArray(brief.nice_to_haves)) {
        brief.nice_to_haves = brief.nice_to_haves.map((m) =>
          clampStr(m, ROUTER_MUST_HAVE_MAX),
        );
      }
      obj.brief = brief;
    }
    return obj;
  }

  return obj;
}

export function parseFashionRouterToolInput(
  toolName: string,
  raw: unknown,
): import("./types").FashionRouterResult | null {
  if (toolName === RESPOND_OFF_TOPIC_TOOL_NAME) {
    let parsed = respondOffTopicInputSchema.safeParse(raw);
    if (!parsed.success) {
      const coerced = respondOffTopicInputSchema.safeParse(
        coerceRouterToolRaw(toolName, raw),
      );
      if (coerced.success) {
        logAiChat("warn", "fashion_router_coerced", {
          tool: toolName,
          issues: parsed.error.issues.map((i) => i.message),
        });
        parsed = coerced;
      }
    }
    if (!parsed.success) return null;
    return { move: "respond_off_topic", reply: parsed.data.reply };
  }
  if (toolName === ASK_CLARIFICATION_TOOL_NAME) {
    let parsed = askClarificationInputSchema.safeParse(raw);
    if (!parsed.success) {
      const coerced = askClarificationInputSchema.safeParse(
        coerceRouterToolRaw(toolName, raw),
      );
      if (coerced.success) {
        logAiChat("warn", "fashion_router_coerced", {
          tool: toolName,
          issues: parsed.error.issues.map((i) => i.message),
        });
        parsed = coerced;
      }
    }
    if (!parsed.success) return null;
    return {
      move: "ask_clarification",
      reply: parsed.data.reply,
      questions: ensureQuestionsHaveQuickOptions(parsed.data.questions),
      ride_along: parsed.data.ride_along,
      stated_facts: parsed.data.stated_facts,
    };
  }
  if (toolName === READY_TO_SEARCH_TOOL_NAME) {
    let parsed = readyToSearchInputSchema.safeParse(raw);
    if (!parsed.success) {
      const coerced = readyToSearchInputSchema.safeParse(
        coerceRouterToolRaw(toolName, raw),
      );
      if (coerced.success) {
        logAiChat("warn", "fashion_router_coerced", {
          tool: toolName,
          issues: parsed.error.issues.map((i) => i.message),
        });
        parsed = coerced;
      }
    }
    if (!parsed.success) return null;
    return {
      move: "ready_to_search",
      brief: parsed.data.brief as FashionSearchBrief,
    };
  }
  return null;
}
