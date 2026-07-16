/**
 * Regression fixture: trace de4048b3-0620-4e19-8027-df5c4fee3a36
 *
 * Root cause: plan_search reasoning was 501 chars; zod max(500) rejected
 * an otherwise-valid 5-slot outfit plan → single-slot fallback.
 */
export const PLANNER_INVALIDITY_TRACE_ID =
  "de4048b3-0620-4e19-8027-df5c4fee3a36";

/** Verbatim tool input from llm_calls stage=planner for the trace above. */
export const PLANNER_RAW_DE4048B3 = {
  mode: "outfit" as const,
  slots: [
    {
      role: "anchor" as const,
      garment: "blazer",
      slot_id: "blazer",
      options_wanted: 3,
      palette_source: "occasion_default" as const,
      query_variants: [
        "mens formal blazer tailored fit",
        "mens business suit jacket premium wool",
        "mens structured dress blazer refined",
        "mens classic navy blazer professional",
      ],
      budget_fraction: 0.35,
      style_direction:
        "mens formal business blazer, refined tailoring, structured fit, premium fabric",
      palette_constraint: "navy, charcoal, black, white",
    },
    {
      role: "support" as const,
      garment: "dress shirt",
      slot_id: "dress_shirt",
      options_wanted: 3,
      palette_source: "occasion_default" as const,
      query_variants: [
        "mens formal dress shirt cotton crisp",
        "mens business oxford shirt slim fit",
        "mens premium poplin dress shirt white",
        "mens classic cotton dress shirt refined",
      ],
      budget_fraction: 0.2,
      style_direction:
        "mens formal dress shirt, crisp cotton or cotton blend, classic collar, refined finish",
      palette_constraint: "white, light blue, navy",
    },
    {
      role: "support" as const,
      garment: "dress pants",
      slot_id: "dress_pants",
      options_wanted: 3,
      palette_source: "occasion_default" as const,
      query_variants: [
        "mens formal dress pants tailored fit",
        "mens business trousers wool blend",
        "mens premium flat-front dress pants",
        "mens classic tailored dress trousers",
      ],
      budget_fraction: 0.25,
      style_direction:
        "mens formal dress pants, tailored fit, high-quality fabric, professional crease",
      palette_constraint: "navy, charcoal, black, grey",
    },
    {
      role: "support" as const,
      garment: "tie",
      slot_id: "tie",
      options_wanted: 3,
      palette_source: "occasion_default" as const,
      query_variants: [
        "mens formal silk tie classic",
        "mens business dress tie solid",
        "mens premium necktie refined pattern",
        "mens classic silk necktie professional",
      ],
      budget_fraction: 0.08,
      style_direction:
        "mens formal tie, silk or silk blend, classic pattern or solid, refined finish",
      palette_constraint: "navy, charcoal, black, burgundy, grey",
    },
    {
      role: "support" as const,
      garment: "dress shoes",
      slot_id: "dress_shoes",
      options_wanted: 3,
      palette_source: "occasion_default" as const,
      query_variants: [
        "mens formal leather dress shoes oxford",
        "mens business dress shoes polished",
        "mens premium leather formal footwear",
        "mens classic oxford dress shoes black",
      ],
      budget_fraction: 0.12,
      style_direction:
        "mens formal dress shoes, leather, oxford or derby, polished finish, professional",
      palette_constraint: "black, dark brown, navy",
    },
  ],
  reasoning:
    "Formal business event requires a complete head-to-toe outfit: blazer (anchor, defines formality), dress shirt (support), dress pants (support), tie (support), and dress shoes (support). Budget $100 across 5 pieces demands careful allocation: blazer 35%, shirt 20%, pants 25%, tie 8%, shoes 12%. No stated color direction; occasion default for formal business is dark neutrals (navy, charcoal, black, white, light blue). Profile signals refined and high-quality fabrics, which inform style descriptors.",
};
