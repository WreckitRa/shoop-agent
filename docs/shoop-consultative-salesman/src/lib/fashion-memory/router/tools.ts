/**
 * Router tool definitions (Anthropic tool schemas).
 *
 * Full replacement. Three tools, same names as before, so the orchestrator's
 * dispatch does not change. What changed:
 *   - ask_clarification: question.kind, question.why, known_summary,
 *     escape_chip, extended gap enum.
 *   - ready_to_search: brief.depth, brief.preference_anchor,
 *     brief.consultation, brief.assumptions, budget_context.no_cap,
 *     stated_facts.depth.
 *
 * Doctrine: the LLM fills every one of these. Code never derives them from
 * chip text. See docs/fashion/router.md.
 */

export const CLARIFICATION_GAPS = [
  // blocking
  "garment",
  "recipient",
  "person_name",
  "department",
  "size",
  "occasion",
  // consultative
  "depth",
  "preference_anchor",
  "budget",
  "style_lane",
  "color",
  "brand",
  "fit",
  "formality",
  "material",
  "direction",
] as const;
export type ClarificationGap = (typeof CLARIFICATION_GAPS)[number];

export const BLOCKING_GAPS: ReadonlySet<ClarificationGap> = new Set([
  "garment",
  "recipient",
  "person_name",
  "department",
  "size",
  "occasion",
]);

export const QUESTION_KINDS = ["blocking", "consult"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const PREFERENCE_ANCHORS = ["keep", "push", "explore", "unspecified"] as const;
export const DEPTH_SOURCES = ["stated", "you_decide", "assumed"] as const;
export const REQUEST_TYPES = ["single_item", "outfit", "capsule", "multi_item"] as const;

const quickOption = {
  oneOf: [
    { type: "string", minLength: 1, maxLength: 40 },
    {
      type: "object",
      properties: {
        label: { type: "string", minLength: 1, maxLength: 40 },
        preview_query: {
          type: "string",
          description:
            "Concrete product-noun catalog phrase with audience/gender when known. Only for shoppable directions.",
        },
      },
      required: ["label", "preview_query"],
      additionalProperties: false,
    },
  ],
};

const statedFactsSchema = {
  type: "object",
  description:
    "Everything the user stated in THIS conversation about the recipient. Code applies these before search.",
  properties: {
    person_ref: {
      type: "string",
      description: 'Roster id, "self", or "new" (then fill new_person).',
    },
    new_person: {
      type: "object",
      properties: {
        name: { type: "string" },
        relation: { type: "string" },
      },
      required: ["relation"],
      additionalProperties: false,
    },
    department: { type: "string", enum: ["mens", "womens", "boys", "girls", "baby", "mixed"] },
    sizes: {
      type: "object",
      description: "garment family → size as stated (tops, bottoms, shoes, dresses, ...)",
      additionalProperties: { type: "string" },
    },
    budget: {
      type: "object",
      properties: {
        max: { type: "number" },
        currency: { type: "string" },
        scope: { type: "string", enum: ["per_item", "total"] },
      },
      additionalProperties: false,
    },
    depth: {
      type: "object",
      description:
        "Only when the user stated a lasting depth preference in words ('always show me 5').",
      properties: {
        value: { type: "integer", minimum: 1, maximum: 8 },
        unit: { type: "string", enum: ["looks", "options"] },
      },
      required: ["value", "unit"],
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const depthSchema = {
  type: "object",
  properties: {
    looks_wanted: { type: "integer", minimum: 1, maximum: 8 },
    options_per_item: { type: "integer", minimum: 1, maximum: 8 },
    source: { type: "string", enum: [...DEPTH_SOURCES] },
  },
  required: ["source"],
  additionalProperties: false,
};

export const briefSchema = {
  type: "object",
  properties: {
    recipient_person_id: { type: "string" },
    request_type: { type: "string", enum: [...REQUEST_TYPES] },
    garments: { type: "array", items: { type: "string" }, minItems: 1 },
    occasion_context: { type: "string" },
    quantity_hint: { type: "string" },
    must_haves: { type: "array", items: { type: "string" } },
    nice_to_haves: { type: "array", items: { type: "string" } },
    budget_context: {
      type: "object",
      properties: {
        stated: { type: "boolean" },
        max: { type: "number" },
        currency: { type: "string" },
        scope: { type: "string", enum: ["per_item", "total"] },
        no_cap: { type: "boolean", description: 'True when the client said "No cap".' },
      },
      required: ["stated"],
      additionalProperties: false,
    },
    style_direction: { type: "string" },
    department_scope: { type: "string" },
    color_direction: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["stated", "profile", "none"] },
        stated_colors: { type: "array", items: { type: "string" } },
      },
      required: ["source"],
      additionalProperties: false,
    },
    brand_direction: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["stated", "profile", "none"] },
        brands: { type: "array", items: { type: "string" } },
      },
      required: ["source"],
      additionalProperties: false,
    },
    depth: depthSchema,
    preference_anchor: { type: "string", enum: [...PREFERENCE_ANCHORS] },
    consultation: {
      type: "object",
      properties: {
        confirmed: {
          type: "array",
          items: { type: "string" },
          description: "The client's consultative choices, in their own words.",
        },
        rounds_used: { type: "integer", minimum: 0, maximum: 2 },
      },
      required: ["confirmed", "rounds_used"],
      additionalProperties: false,
    },
    assumptions: {
      type: "array",
      items: { type: "string", maxLength: 120 },
      description:
        "Every call made without asking, one line each, phrased to be said to the client. Voiced in results.",
    },
    stated_facts: statedFactsSchema,
  },
  required: [
    "recipient_person_id",
    "request_type",
    "garments",
    "occasion_context",
    "budget_context",
    "style_direction",
    "color_direction",
    "brand_direction",
    "depth",
    "preference_anchor",
    "consultation",
    "assumptions",
  ],
  additionalProperties: false,
};

export const ROUTER_TOOLS = [
  {
    name: "respond_off_topic",
    description:
      "Nothing wearable or carryable in the conversation, now or soon. Warm redirect with up to 3 suggestions tied to what they said. Never for greetings or vague shopping intent.",
    input_schema: {
      type: "object",
      properties: {
        reply: { type: "string" },
        suggestions: { type: "array", items: { type: "string" }, maxItems: 3 },
      },
      required: ["reply"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_clarification",
    description:
      "The consultation. Ask blocking gaps and the 1–3 consultative questions whose answers change what gets pulled. Open with known_summary. Every consult question ends with a 'You decide' chip; every turn with a consult question sets escape_chip.",
    input_schema: {
      type: "object",
      properties: {
        reply: { type: "string", description: "≤ 3 sentences, salesman voice. Does not repeat known_summary." },
        known_summary: {
          type: "string",
          maxLength: 220,
          description:
            "One sentence: what I am already going on about this recipient. Required whenever PROFILES or the conversation gives anything.",
        },
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              gap: { type: "string", enum: [...CLARIFICATION_GAPS] },
              kind: { type: "string", enum: [...QUESTION_KINDS] },
              text: { type: "string" },
              why: { type: "string", maxLength: 48, description: "≤ 8 words. Consult questions only." },
              quick_options: { type: "array", items: quickOption, minItems: 1, maxItems: 5 },
              allow_multiple: { type: "boolean" },
            },
            required: ["gap", "kind", "text", "quick_options"],
            additionalProperties: false,
          },
        },
        escape_chip: {
          type: "string",
          maxLength: 30,
          description: 'e.g. "Just show me". Only when at least one question is kind:"consult".',
        },
        brief: briefSchema,
      },
      required: ["reply", "questions"],
      additionalProperties: false,
    },
  },
  {
    name: "ready_to_search",
    description:
      "The brief is complete and the depth is known (stated, decided-for-them, or assumed-and-declared). Every silent call is in assumptions.",
    input_schema: {
      type: "object",
      properties: {
        brief: briefSchema,
        known_summary: {
          type: "string",
          maxLength: 220,
          description: "Same as on ask_clarification; shown as the first line of progress copy.",
        },
      },
      required: ["brief"],
      additionalProperties: false,
    },
  },
] as const;
