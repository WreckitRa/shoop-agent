import type { E2eScenario } from "../types";
import { baseMensCatalog } from "../../test/fake-ucp/catalogs/base-mens";
import { curationRecording, plannerQueryVariants } from "./_helpers";
import { READY_TO_SEARCH_TOOL_NAME } from "@/lib/fashion-memory/router/tool-schema";
import { PLAN_SEARCH_TOOL_NAME } from "@/lib/fashion-memory/search-planner/tool-schema";

const shirtBrief = {
  recipient_person_id: "self",
  request_type: "single_item",
  garments: ["shirt"],
  occasion_context: "office",
  quantity_hint: "one",
  must_haves: [] as string[],
  nice_to_haves: [] as string[],
  budget_context: { stated: false },
  style_direction: "Office shirt.",
  department_scope: "mens",
  stated_facts: {
    person_ref: "self",
    department: "mens",
    sizes: { tops: "M" },
  },
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shirt"],
    sizes_unconfirmed: [] as string[],
  },
};


export const e2eCurationFallbackRecurate: E2eScenario = {
  name: "e2e_curation_fallback_recurate",
  description: "Curation timeout → fallback → recurate replaces picks.",
  seed: { profile_state: { genderPresentation: "mens" } },
  catalog: baseMensCatalog,
  llm_recordings: {
    router: [
      { stage: "router", toolName: READY_TO_SEARCH_TOOL_NAME, input: { brief: shirtBrief } },
    ],
    planner: [
      {
        stage: "planner",
        toolName: PLAN_SEARCH_TOOL_NAME,
        input: {
          mode: "single_item",
          reasoning: "Office shirt",
          slots: [
            {
              slot_id: "shirt",
              garment: "shirt",
              role: "anchor",
              style_direction: "Office shirt",
              palette_constraint: null,
              palette_source: "spread",
              options_wanted: 3,
              query_variants: plannerQueryVariants("mens", "shirt"),
            },
          ],
        },
      },
    ],
    curation: [curationRecording(["shirt"])],
  },
  steps: [
    {
      user: "mens office shirt",
      expect: {
        route: { move: "ready_to_search" },
        curation: { picksMin: 1 },
      },
    },
  ],
};
