import type { LlmRecording } from "../types";
import { READY_TO_SEARCH_TOOL_NAME } from "@/lib/fashion-memory/router/tool-schema";
import { PLAN_SEARCH_TOOL_NAME } from "@/lib/fashion-memory/search-planner/tool-schema";
import { CURATION_TOOL_NAME } from "@/lib/fashion-memory/curation/config";
import { ASK_CLARIFICATION_TOOL_NAME } from "@/lib/fashion-memory/router/tool-schema";

export function joeBrief() {
  return {
    recipient_person_id: "new",
    request_type: "outfit",
    garments: ["shirt", "trousers", "shoes"],
    occasion_context: "business event",
    quantity_hint: "one outfit",
    must_haves: [] as string[],
    nice_to_haves: [] as string[],
    budget_context: { stated: true, max: 100, currency: "USD" },
    style_direction: "Full formal outfit for Joe under $100 for a business event.",
    department_scope: "mens",
    stated_facts: {
      person_ref: "new",
      new_person: { name: "Joe", relation: "friend" },
      department: "mens",
      sizes: { tops: "M", bottoms: "33", shoes: "10" },
      budget: { max: 100, currency: "USD" },
    },
    knowledge_state: {
      department: "mens",
      sizes_confirmed: ["shirt", "trousers", "shoes"],
      sizes_unconfirmed: [] as string[],
    },
  };
}

export function joeRouterRecording(): LlmRecording {
  return {
    stage: "router",
    toolName: READY_TO_SEARCH_TOOL_NAME,
    input: { brief: joeBrief() },
  };
}

export function outfitPlannerRecording(garments: string[], mode = "outfit") {
  return {
    stage: "planner",
    toolName: PLAN_SEARCH_TOOL_NAME,
    input: {
      mode,
      reasoning: "E2E outfit plan",
      slots: garments.map((g, i) => ({
        slot_id: g,
        garment: g,
        role: i === 0 ? "anchor" : "support",
        style_direction: `Smart ${g} for the brief.`,
        palette_constraint: null,
        palette_source: "spread",
        options_wanted: 3,
        query_variants: plannerQueryVariants("mens", g),
      })),
    },
  };
}

export function capsulePlannerRecording() {
  return {
    stage: "planner",
    toolName: PLAN_SEARCH_TOOL_NAME,
    input: {
      mode: "capsule",
      reasoning: "Three work rotations under $300 total.",
      slots: ["shirt", "trousers", "shoes"].map((g, i) => ({
        slot_id: g,
        garment: g,
        role: i === 0 ? "anchor" : "support",
        style_direction: `Work ${g}.`,
        palette_constraint: null,
        palette_source: "spread",
        options_wanted: 3,
        query_variants: plannerQueryVariants("mens", g),
      })),
      budget_assembly: {
        set_total: 300,
        currency: "USD",
        outfit_count: 3,
      },
    },
  };
}

export function curationRecording(slotIds: string[]) {
  return {
    stage: "curation",
    toolName: CURATION_TOOL_NAME,
    input: {
      slots: slotIds.map((id) => ({
        slot_id: id,
        picks: [{ ref: "p1", role: "safe", stylist_line: `Strong verified ${id}.` }],
      })),
      vetoes: [],
      narration: {
        opening: "Verified shortlist from survivors.",
        brand_note: "Aldo does not carry dresses — similar womens day dresses instead.",
      },
    },
  };
}

export function garmentClarificationRecording(): LlmRecording {
  return {
    stage: "router",
    toolName: ASK_CLARIFICATION_TOOL_NAME,
    input: {
      reply: "Quick one — what garment are we starting with?",
      questions: [
        {
          text: "What piece should I anchor on first?",
          gap: "garment",
          quick_options: ["Shirt", "Trousers", "Full outfit"],
        },
      ],
    },
  };
}

export const mensDepartmentFirst = (q: string) => /^(mens|men's)\b/i.test(q.trim());

export const noWomensLeak = (q: string) => !/\bwomens\b/i.test(q);

/** Four diverse query variants (schema min 4) for e2e planner mocks. */
export function plannerQueryVariants(department: string, garment: string): string[] {
  const d = department.trim().toLowerCase();
  const g = garment.trim().toLowerCase();
  return [
    `${d} ${g} business formal`,
    `${d} ${g} office smart`,
    `${d} premium ${g} tailored`,
    `${d} classic ${g} refined`,
  ];
}
