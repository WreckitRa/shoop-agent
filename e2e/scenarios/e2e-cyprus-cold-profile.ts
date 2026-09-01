import type { E2eScenario } from "../types";
import { baseMensCatalog } from "../../test/fake-ucp/catalogs/base-mens";
import {
  garmentClarificationRecording,
  outfitPlannerRecording,
  curationRecording,
  joeRouterRecording,
} from "./_helpers";
import { READY_TO_SEARCH_TOOL_NAME } from "@/lib/fashion-memory/router/tool-schema";

const essentialsBrief = {
  recipient_person_id: "self",
  request_type: "outfit",
  garments: ["shirt", "trousers", "shoes"],
  occasion_context: "wedding_guest",
  quantity_hint: "one outfit",
  must_haves: [] as string[],
  nice_to_haves: [] as string[],
  budget_context: { stated: false },
  style_direction: "Smart Cyprus wedding guest essentials.",
  department_scope: "mens",
  stated_facts: {
    person_ref: "self",
    department: "mens",
    sizes: { tops: "M", bottoms: "33", shoes: "10" },
  },
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shirt", "trousers", "shoes"],
    sizes_unconfirmed: [] as string[],
  },
  depth: { looks_wanted: 1, source: "stated" as const },
};

export const e2eCyprusColdProfile: E2eScenario = {
  name: "e2e_cyprus_cold_profile",
  description: "Life-context opener → garment clarification → essentials bundle outfit search.",
  seed: {
    profile_state: {
      genderPresentation: "mens",
      preferredName: "Raphael",
      sizeLines: ["tops M", "bottoms 33", "shoes 10"],
    },
  },
  catalog: baseMensCatalog,
  llm_recordings: {
    router: [
      garmentClarificationRecording(),
      {
        stage: "router",
        toolName: READY_TO_SEARCH_TOOL_NAME,
        input: { brief: essentialsBrief },
      },
    ],
    planner: [outfitPlannerRecording(["shirt", "trousers", "shoes"])],
    curation: [curationRecording(["shirt", "trousers", "shoes"])],
  },
  steps: [
    {
      user: "I've got my cousin's wedding in Cyprus next month",
      expect: {
        route: {
          move: "ask_clarification",
          questionsGapOrder: ["garment"],
        },
      },
    },
    {
      user: "Full outfit — shirt, trousers, and shoes",
      expect: {
        route: { move: "ready_to_search" },
        plan: { slotCountMin: 3 },
      },
    },
  ],
};
