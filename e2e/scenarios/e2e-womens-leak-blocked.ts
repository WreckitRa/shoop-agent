import type { E2eScenario } from "../types";
import { baseMensCatalog, baseWomensNoise } from "../../test/fake-ucp/catalogs/base-mens";
import { curationRecording, mensDepartmentFirst, outfitPlannerRecording } from "./_helpers";
import { READY_TO_SEARCH_TOOL_NAME } from "@/lib/fashion-memory/router/tool-schema";

const mensBrief = {
  recipient_person_id: "self",
  request_type: "outfit",
  garments: ["shirt", "trousers"],
  occasion_context: "work",
  quantity_hint: "one outfit",
  must_haves: [] as string[],
  nice_to_haves: [] as string[],
  budget_context: { stated: false },
  style_direction: "Mens office outfit.",
  department_scope: "mens",
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shirt", "trousers"],
    sizes_unconfirmed: [] as string[],
  },
  depth: { looks_wanted: 1, source: "stated" as const },
};

export const e2eWomensLeakBlocked: E2eScenario = {
  name: "e2e_womens_leak_blocked",
  description: "Mens search with womens-shop noise → shop evidence drops.",
  seed: {
    profile_state: { genderPresentation: "mens" },
    shop_departments: { "Shein Boutique": "womens" },
  },
  catalog: {
    ...baseMensCatalog,
    noise: baseWomensNoise,
  },
  llm_recordings: {
    router: [
      { stage: "router", toolName: READY_TO_SEARCH_TOOL_NAME, input: { brief: mensBrief } },
    ],
    planner: [outfitPlannerRecording(["shirt", "trousers"])],
    curation: [curationRecording(["shirt", "trousers"])],
  },
  steps: [
    {
      user: "mens office shirt and trousers",
      expect: {
        queries: [mensDepartmentFirst],
        funnel: {
          survivorsMin: 1,
          dropRules: [{ rule: "department_mismatch", min: 1 }],
        },
      },
    },
  ],
};
