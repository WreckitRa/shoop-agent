import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages";
import { z } from "zod";
import type {
  ClarificationAnswer,
  ClarificationQuestion,
  MessageClarificationV1,
} from "./types";
import { CLARIFICATION_OTHER_OPTION_ID } from "./types";

export const CLARIFICATION_OTHER_OPTION_LABEL = "Other";

export const PRODUCT_SEARCH_CLARIFICATION_TOOL_NAME =
  "emit_product_search_clarification";

const DEFAULT_BUDGET_SLIDER = {
  min: 0,
  max: 500,
  step: 25,
  currency: "USD",
} as const;

const optionSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  preview_query: z.string().min(1).max(300).optional(),
});

const budgetModeSchema = z.enum(["up_to", "range", "at_least", "any"]);

const budgetSliderSchema = z
  .object({
    min: z.number().min(0).optional(),
    max: z.number().positive(),
    step: z.number().positive().optional(),
    currency: z.string().min(1).max(8).optional(),
    default_value: z.number().optional(),
    default_min: z.number().optional(),
    default_max: z.number().optional(),
    default_mode: budgetModeSchema.optional(),
  })
  .superRefine((slider, ctx) => {
    if (slider.max <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "budget_slider.max must be greater than 0",
        path: ["max"],
      });
    }
  });

const questionSchema = z
  .object({
    id: z.string().min(1).max(80),
    prompt: z.string().min(1).max(500),
    optional: z.boolean(),
    allow_custom: z.boolean().optional(),
    allow_other: z.boolean().optional(),
    allow_multiple: z.boolean().optional(),
    input_type: z.enum(["options", "budget_slider"]).optional(),
    budget_slider: budgetSliderSchema.optional(),
    options: z.array(optionSchema).max(12).optional(),
  })
  .superRefine((question, ctx) => {
    const inputType = question.input_type ?? "options";
    if (inputType === "budget_slider") {
      if (!question.budget_slider) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "budget_slider is required when input_type is budget_slider",
          path: ["budget_slider"],
        });
      }
      return;
    }
    if (!question.options?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "options are required when input_type is options",
        path: ["options"],
      });
    }
  });

const toolInputSchema = z.object({
  questions: z.array(questionSchema).min(1).max(8),
});

export const productSearchClarificationTool: Tool = {
  name: PRODUCT_SEARCH_CLARIFICATION_TOOL_NAME,
  description: `Emit structured shopping questions when the user wants product help but key details are still missing. Use chip options for most attributes; use a budget slider (not chips) for budget.

Only call this when:
- The user wants product suggestions, shopping help, or to buy something, AND
- Important attributes are missing or ambiguous (recipient, use case, budget, sizing, color, brand, timeline, …).

Do NOT call this for general knowledge, non-shopping chat, or when the user already gave enough detail.

In the same turn, write a short friendly user-visible message (plain text) that explains why you are asking and that they can answer below or keep chatting.`,
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        description:
          "Each question should cover one concise shopping attribute.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Stable machine id (snake_case), e.g. recipient, budget, size.",
            },
            prompt: { type: "string" },
            optional: { type: "boolean" },
            input_type: {
              type: "string",
              enum: ["options", "budget_slider"],
              description:
                "Use budget_slider for budget (slider UI). Omit or options for chip questions.",
            },
            budget_slider: {
              type: "object",
              description:
                "Required when input_type is budget_slider. Slider track runs from $0 to max (open-ended max when user slides to the end).",
              properties: {
                min: {
                  type: "number",
                  description:
                    "Deprecated — slider floor is always 0. Omit this field.",
                },
                max: {
                  type: "number",
                  description:
                    "Slider ceiling (highest amount on the track, e.g. 300 for shoes).",
                },
                step: {
                  type: "number",
                  description: "Slider increment, e.g. 25 or 50.",
                },
                currency: {
                  type: "string",
                  description: "ISO currency code, e.g. USD, EUR, GBP, AED.",
                },
                default_mode: {
                  type: "string",
                  enum: ["up_to", "range", "at_least", "any"],
                  description: "Suggested starting mode. Usually up_to.",
                },
                default_min: {
                  type: "number",
                  description:
                    "Starting minimum when mode is range or at_least.",
                },
                default_max: {
                  type: "number",
                  description: "Starting maximum when mode is up_to or range.",
                },
                default_value: {
                  type: "number",
                  description: "Legacy alias for default_max.",
                },
              },
              required: ["max"],
            },
            allow_custom: {
              type: "boolean",
              description:
                "Deprecated — use allow_other instead. If true, treated the same as allow_other.",
            },
            allow_other: {
              type: "boolean",
              description:
                "Defaults to true. The UI adds an Other chip that reveals a free-text field when selected. Set false only for truly closed sets (yes/no, gender, one standard clothing/shoe size). Do not add a manual Other option in options — the UI injects it.",
            },
            allow_multiple: {
              type: "boolean",
              description:
                "If true, the user may select multiple options (colors, styles, materials). Omit or false for mutually exclusive choices.",
            },
            options: {
              type: "array",
              description: "Chip options. Omit for budget_slider questions.",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                  preview_query: {
                    type: "string",
                    description:
                      "Optional catalog search phrase for visual preview collages. Use for shoppable directions (style, gift category, product-type forks). Concrete product-noun phrase only — no gift/occasion/recipient words. Omit for budgets, yes/no, sizes, logistics.",
                  },
                },
                required: ["id", "label"],
              },
            },
          },
          required: ["id", "prompt", "optional"],
        },
      },
    },
    required: ["questions"],
  },
};

export function productSearchClarificationSystemAddendum(): string {
  return `## Product search clarification
Before running a Shopify catalog search, if 1–3 key attributes are still missing (recipient, budget, size, occasion, style, brand, …), call the tool \`${PRODUCT_SEARCH_CLARIFICATION_TOOL_NAME}\` with 2–6 focused questions instead of guessing. Each question must use short, distinct \`id\` values.

Use chip \`options\` for most attributes. For **budget**, always use \`input_type: "budget_slider"\` with \`budget_slider: { max, step?, currency?, default_mode?, default_min?, default_max? }\` — never budget pills. The slider always starts at $0; set \`max\` to a sensible ceiling for the product (e.g. sneakers 400 USD). Omit \`options\` on budget questions.

### Brand preference (when relevant)
For **brand-sensitive** shopping — shoes, apparel, bags, beauty, tech, watches, fitness gear, supplements, and similar — include an **optional** brand question (\`id: "brands"\`) when the user has **not** already named brands and you do not have stored brand loves for them. Ask which brands they prefer, want to try, or want to avoid. Use \`allow_multiple: true\` with 4–6 well-known category-relevant brand chips plus **Other** for free text (do not add a manual Other option). Set \`optional: true\` so they can skip. **Skip** the brand question when the user already mentioned a brand, when they said "any brand" / "no preference", or for categories where brand barely matters (generic home decor, one-off gifts with no brand dimension).

When the user submits brand answers, embed loved brands into the catalog \`query\` and treat "avoid" / disliked brands as exclusions — never recommend brands they said to skip.

When the user submits, budget answers include \`budgetMin\` and/or \`budgetMax\` (each a number or \`null\`). \`null\` min = no floor; \`null\` max = no ceiling / open-ended. Both null = any budget. Use these bounds in your catalog query. If their summary says "hard cap budget", set \`budget_type: "hard"\` on \`search_shopify_catalog\`; otherwise default \`budget_type: "soft"\` when a max is given.

Set \`allow_multiple: true\` when several chip answers can all apply (colors, styles, materials, occasions, features). Leave it false or omit for mutually exclusive chip choices (who it's for, one clothing size, one shoe size).

Chip questions include an **Other** free-text option by default. Set \`allow_other: false\` only for closed sets where free text would not help: yes/no, gender, a single standard clothing/shoe size. Never add a manual "Other" chip in \`options\`; the UI injects it. Budget sliders never use Other.

### Visual option previews (shoppable directions)
For options that represent a **shoppable direction** — clothing style (minimal, streetwear, old money), gift direction (coffee gear, desk upgrades, gaming), or any product-category fork — include a \`preview_query\` on each such option. The server fetches real product images for collages; omit \`preview_query\` for non-shoppable options (budgets, yes/no, sizes, logistics) — those stay plain chips.

Rules for \`preview_query\`:
- Must be a concrete, self-contained **product-noun** phrase that would return visually representative products from a search engine.
- Include audience/gender when known (e.g. "Minimal" for a man → \`minimalist neutral men's essentials clothing\`; "Streetwear" → \`men's streetwear hoodie cargo pants sneakers\`; "Coffee gear" → \`specialty coffee brewing equipment\`).
- **Never** put gift/occasion/recipient words in \`preview_query\` (no "gift", "present", "birthday", "for him") — intent words stay out of query text, same as the main search pipeline.

Do NOT call clarification if you already have enough context — go straight to \`search_shopify_catalog\`.

If the user can continue the conversation without choosing (they type a normal message instead), their new message still counts as context; do not insist on the form.`;
}

function snapBudgetValue(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  const clamped = Math.min(max, Math.max(min, value));
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

function normalizeBudgetSlider(
  raw: z.infer<typeof budgetSliderSchema> | undefined,
): NonNullable<ClarificationQuestion["budgetSlider"]> {
  const floor = 0;
  const ceiling = raw?.max ?? DEFAULT_BUDGET_SLIDER.max;
  const step = raw?.step ?? DEFAULT_BUDGET_SLIDER.step;
  const currency =
    raw?.currency?.trim().toUpperCase() || DEFAULT_BUDGET_SLIDER.currency;
  const midpoint = snapBudgetValue((floor + ceiling) / 2, floor, ceiling, step);
  const defaultMax = snapBudgetValue(
    raw?.default_max ?? raw?.default_value ?? midpoint,
    floor,
    ceiling,
    step,
  );
  const defaultMin = snapBudgetValue(
    raw?.default_min ?? floor,
    floor,
    ceiling,
    step,
  );
  const defaultMode = raw?.default_mode ?? "up_to";

  return {
    floor,
    ceiling,
    step,
    currency,
    defaultMode,
    defaultMin,
    defaultMax,
  };
}

export function formatBudgetRangeLabel(
  a: ClarificationAnswer,
  currency: string = DEFAULT_BUDGET_SLIDER.currency,
): string | null {
  const hasMin = a.budgetMin != null && Number.isFinite(a.budgetMin);
  const hasMax = a.budgetMax != null && Number.isFinite(a.budgetMax);

  if (
    a.budgetAmount != null &&
    Number.isFinite(a.budgetAmount) &&
    !hasMin &&
    !hasMax
  ) {
    return `up to ${formatBudgetAmount(a.budgetAmount, currency)}`;
  }
  if (!hasMin && !hasMax) return "No budget in mind";
  if (hasMin && hasMax) {
    const lo = Math.min(a.budgetMin!, a.budgetMax!);
    const hi = Math.max(a.budgetMin!, a.budgetMax!);
    return `${formatBudgetAmount(lo, currency)} – ${formatBudgetAmount(hi, currency)}`;
  }
  if (hasMax) return `up to ${formatBudgetAmount(a.budgetMax!, currency)}`;
  if (hasMin) return `${formatBudgetAmount(a.budgetMin!, currency)}+`;
  return null;
}

export function formatBudgetAmount(
  amount: number,
  currency: string = "USD",
): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function isBudgetSliderQuestion(q: ClarificationQuestion): boolean {
  return q.inputType === "budget_slider";
}

export function questionAllowsOther(q: ClarificationQuestion): boolean {
  if (isBudgetSliderQuestion(q)) return false;
  if (q.allowOther === false || q.allowCustom === false) return false;
  return true;
}

function withOtherOption(
  options: ClarificationQuestion["options"],
): ClarificationQuestion["options"] {
  if (options.some((o) => o.id === CLARIFICATION_OTHER_OPTION_ID)) {
    return options;
  }
  return [
    ...options,
    {
      id: CLARIFICATION_OTHER_OPTION_ID,
      label: CLARIFICATION_OTHER_OPTION_LABEL,
    },
  ];
}

/** Normalize persisted options (backward compat for messages without preview fields). */
export function normalizeClarificationOption(
  raw: { id: string; label: string; previewQuery?: string; previewImages?: ClarificationQuestion["options"][number]["previewImages"] },
): ClarificationQuestion["options"][number] {
  return {
    id: raw.id,
    label: raw.label,
    ...(raw.previewQuery?.trim() ? { previewQuery: raw.previewQuery.trim() } : {}),
    ...(raw.previewImages?.length ? { previewImages: raw.previewImages } : {}),
  };
}

export function clarificationExpectsOptionPreviews(
  clarification: Pick<MessageClarificationV1, "questions">,
): boolean {
  return clarification.questions.some((q) =>
    q.options.some(
      (o) =>
        o.id !== CLARIFICATION_OTHER_OPTION_ID &&
        Boolean(o.previewQuery?.trim()) &&
        !o.previewImages?.length,
    ),
  );
}

export function collectPreviewRequests(
  clarification: Pick<MessageClarificationV1, "questions">,
): Array<{ id: string; previewQuery: string }> {
  const out: Array<{ id: string; previewQuery: string }> = [];
  for (const q of clarification.questions) {
    for (const o of q.options) {
      if (o.id === CLARIFICATION_OTHER_OPTION_ID) continue;
      const query = o.previewQuery?.trim();
      if (query) out.push({ id: o.id, previewQuery: query });
    }
  }
  return out;
}

export function mergeOptionPreviewsIntoClarification(
  clarification: MessageClarificationV1,
  previews: Record<string, ClarificationQuestion["options"][number]["previewImages"]>,
): MessageClarificationV1 {
  if (!Object.keys(previews).length) return clarification;
  const questions = clarification.questions.map((q) => ({
    ...q,
    options: q.options.map((o) => {
      const images = previews[o.id];
      if (!images?.length) return o;
      return { ...o, previewImages: images };
    }),
  }));
  return {
    ...clarification,
    questions,
    expectsOptionPreviews: clarificationExpectsOptionPreviews({ questions }),
  };
}

export function ensureClarificationQuestions(
  questions: ClarificationQuestion[],
): ClarificationQuestion[] {
  return questions.map((q) => {
    if (isBudgetSliderQuestion(q) || !questionAllowsOther(q)) return q;
    if (q.options.some((o) => o.id === CLARIFICATION_OTHER_OPTION_ID)) {
      return { ...q, allowOther: true };
    }
    return {
      ...q,
      allowOther: true,
      options: withOtherOption(q.options),
    };
  });
}

export function normalizeQuestionsFromTool(
  raw: z.infer<typeof questionSchema>[],
): ClarificationQuestion[] {
  return raw.map((q) => {
    const inputType = q.input_type ?? "options";
    if (inputType === "budget_slider") {
      return {
        id: q.id,
        prompt: q.prompt,
        optional: q.optional,
        allowCustom: false,
        allowOther: false,
        allowMultiple: false,
        inputType: "budget_slider",
        budgetSlider: normalizeBudgetSlider(q.budget_slider),
        options: [],
      };
    }

    const allowOther = q.allow_other ?? q.allow_custom ?? true;
    const baseOptions = (q.options ?? []).map((o) =>
      normalizeClarificationOption({
        id: o.id,
        label: o.label,
        previewQuery: o.preview_query,
      }),
    );
    const options = allowOther ? withOtherOption(baseOptions) : baseOptions;

    return {
      id: q.id,
      prompt: q.prompt,
      optional: q.optional,
      allowCustom: allowOther,
      allowOther,
      allowMultiple: q.allow_multiple ?? false,
      inputType: "options",
      options,
    };
  });
}

export function parseClarificationToolInput(
  input: unknown,
): MessageClarificationV1 | null {
  const parsed = toolInputSchema.safeParse(input);
  if (!parsed.success) return null;
  const questions = normalizeQuestionsFromTool(parsed.data.questions);
  return {
    version: 1,
    questions,
    status: "pending",
    expectsOptionPreviews: clarificationExpectsOptionPreviews({ questions }),
  };
}

export function formatClarificationAnswerLine(
  q: ClarificationQuestion,
  a: ClarificationAnswer,
): string | null {
  const currency =
    a.currency?.trim() ||
    q.budgetSlider?.currency ||
    DEFAULT_BUDGET_SLIDER.currency;

  if (isBudgetSliderQuestion(q) && hasBudgetAnswer(a)) {
    const label = formatBudgetRangeLabel(a, currency);
    if (label) {
      const strictness = a.budgetType === "hard" ? " — hard cap budget" : "";
      return `${q.prompt}: ${label}${strictness}`;
    }
  }

  const parts: string[] = [];
  const otherSelected = a.optionIds?.includes(CLARIFICATION_OTHER_OPTION_ID);
  const allowsOther = questionAllowsOther(q);

  if (a.optionIds?.length) {
    for (const oid of a.optionIds) {
      if (oid === CLARIFICATION_OTHER_OPTION_ID) continue;
      const label = q.options.find((o) => o.id === oid)?.label ?? oid;
      parts.push(label);
    }
  }
  if (
    a.customText?.trim() &&
    (otherSelected || (allowsOther && !a.optionIds?.length))
  ) {
    parts.push(a.customText.trim());
  }
  if (parts.length) return `${q.prompt}: ${parts.join(", ")}`;
  return null;
}

export function formatClarificationUserSummary(
  questions: ClarificationQuestion[],
  answers: Record<string, ClarificationAnswer>,
): string {
  const normalized = ensureClarificationQuestions(questions);
  const lines: string[] = ["Search preferences (from my selections):"];
  for (const q of normalized) {
    const a = answers[q.id];
    if (!a) continue;
    const line = formatClarificationAnswerLine(q, a);
    if (line) lines.push(`- ${line}`);
  }
  if (lines.length === 1) {
    lines.push(
      "- (No extra attributes selected; please use what I already shared in the thread.)",
    );
  }
  return lines.join("\n");
}

type RawAnswer = {
  optionIds?: string[];
  customText?: string;
  budgetAmount?: number;
  budgetMin?: number | null;
  budgetMax?: number | null;
  currency?: string;
  budgetType?: "hard" | "soft";
};

function hasBudgetAnswer(a: ClarificationAnswer): boolean {
  if (a.budgetMin === null && a.budgetMax === null && a.currency) return true;
  if (a.budgetMin != null && Number.isFinite(a.budgetMin)) return true;
  if (a.budgetMax != null && Number.isFinite(a.budgetMax)) return true;
  if (a.budgetAmount != null && Number.isFinite(a.budgetAmount)) return true;
  return false;
}

export function normalizePatchAnswers(
  raw: Record<string, RawAnswer>,
): Record<string, ClarificationAnswer> {
  const out: Record<string, ClarificationAnswer> = {};
  for (const [k, v] of Object.entries(raw)) {
    const ids = Array.isArray(v.optionIds)
      ? v.optionIds.filter((x) => typeof x === "string" && x.length > 0)
      : [];
    const custom = typeof v.customText === "string" ? v.customText.trim() : "";
    const entry: ClarificationAnswer = {};
    if (ids.length) entry.optionIds = ids;
    if (custom) entry.customText = custom;
    if (typeof v.budgetAmount === "number" && Number.isFinite(v.budgetAmount)) {
      entry.budgetAmount = v.budgetAmount;
    }
    if (v.budgetMin === null) entry.budgetMin = null;
    else if (typeof v.budgetMin === "number" && Number.isFinite(v.budgetMin)) {
      entry.budgetMin = v.budgetMin;
    }
    if (v.budgetMax === null) entry.budgetMax = null;
    else if (typeof v.budgetMax === "number" && Number.isFinite(v.budgetMax)) {
      entry.budgetMax = v.budgetMax;
    }
    if (typeof v.currency === "string" && v.currency.trim()) {
      entry.currency = v.currency.trim().toUpperCase();
    }
    if (v.budgetType === "hard" || v.budgetType === "soft") {
      entry.budgetType = v.budgetType;
    }
    if (entry.optionIds?.length || entry.customText || hasBudgetAnswer(entry)) {
      out[k] = entry;
    }
  }
  return out;
}

function answerIsEmpty(a: ClarificationAnswer | undefined): boolean {
  if (!a) return true;
  const otherOnly =
    a.optionIds?.includes(CLARIFICATION_OTHER_OPTION_ID) &&
    !a.customText?.trim() &&
    (a.optionIds.length === 1 ||
      a.optionIds.every((id) => id === CLARIFICATION_OTHER_OPTION_ID));
  if (otherOnly) return true;
  return !a.customText?.trim() && !a.optionIds?.length && !hasBudgetAnswer(a);
}

export function validateClarificationSubmission(params: {
  questions: ClarificationQuestion[];
  answers: Record<string, ClarificationAnswer>;
}): { ok: true } | { ok: false; error: string } {
  const questions = ensureClarificationQuestions(params.questions);
  for (const q of questions) {
    const a = params.answers[q.id];
    if (q.optional && answerIsEmpty(a)) continue;
    if (!q.optional && answerIsEmpty(a)) {
      return { ok: false, error: `Answer required: ${q.prompt}` };
    }
    if (answerIsEmpty(a)) continue;
    const ans = a;

    if (isBudgetSliderQuestion(q)) {
      if (!hasBudgetAnswer(ans)) {
        return { ok: false, error: `Budget required: ${q.prompt}` };
      }
      const slider = q.budgetSlider ?? normalizeBudgetSlider(undefined);
      const check = (n: number, label: string) => {
        if (n < slider.floor || n > slider.ceiling) {
          return {
            ok: false as const,
            error: `${label} must be between ${formatBudgetAmount(slider.floor, slider.currency)} and ${formatBudgetAmount(slider.ceiling, slider.currency)}`,
          };
        }
        return { ok: true as const };
      };
      if (ans.budgetMin != null && Number.isFinite(ans.budgetMin)) {
        const r = check(ans.budgetMin, "Minimum budget");
        if (!r.ok) return r;
      }
      if (ans.budgetMax != null && Number.isFinite(ans.budgetMax)) {
        const r = check(ans.budgetMax, "Maximum budget");
        if (!r.ok) return r;
      }
      if (
        ans.budgetMin != null &&
        ans.budgetMax != null &&
        ans.budgetMin > ans.budgetMax
      ) {
        return {
          ok: false,
          error: `Minimum budget cannot exceed maximum for: ${q.prompt}`,
        };
      }
      continue;
    }

    const hasText = Boolean(ans.customText?.trim());
    const hasOpts = Boolean(ans.optionIds?.length);
    const otherSelected = ans.optionIds?.includes(
      CLARIFICATION_OTHER_OPTION_ID,
    );
    const allowsOther = questionAllowsOther(q);

    if (ans.optionIds?.length) {
      if (!q.allowMultiple && ans.optionIds.length > 1) {
        return {
          ok: false,
          error: `Only one option allowed for: ${q.prompt}`,
        };
      }
      const valid = new Set(q.options.map((o) => o.id));
      for (const oid of ans.optionIds) {
        if (!valid.has(oid)) {
          return { ok: false, error: `Invalid option for: ${q.prompt}` };
        }
      }
    }

    if (otherSelected && !hasText) {
      return {
        ok: false,
        error: `Please describe your answer for: ${q.prompt}`,
      };
    }

    if (hasText && allowsOther && !otherSelected && !hasOpts) {
      return {
        ok: false,
        error: `Select "Other" to enter a custom answer for: ${q.prompt}`,
      };
    }

    if (!allowsOther && hasText && !hasOpts) {
      return { ok: false, error: `Free text not allowed for: ${q.prompt}` };
    }
  }
  return { ok: true };
}
