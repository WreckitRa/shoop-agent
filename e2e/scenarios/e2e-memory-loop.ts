import type { E2eScenario } from "../types";
import { baseMensCatalog } from "../../test/fake-ucp/catalogs/base-mens";
import { curationRecording, outfitPlannerRecording } from "./_helpers";
import { READY_TO_SEARCH_TOOL_NAME } from "@/lib/fashion-memory/router/tool-schema";

const spreadBrief = {
  recipient_person_id: "self",
  request_type: "outfit",
  garments: ["shirt", "trousers"],
  occasion_context: "casual",
  quantity_hint: "one outfit",
  must_haves: [] as string[],
  nice_to_haves: [] as string[],
  budget_context: { stated: false },
  style_direction: "Casual weekend outfit.",
  department_scope: "mens",
  stated_facts: {
    person_ref: "self",
    department: "mens",
    sizes: { tops: "M", bottoms: "33" },
  },
  color_direction: { source: "none" },
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shirt", "trousers"],
    sizes_unconfirmed: [] as string[],
  },
  depth: { looks_wanted: 1, source: "stated" as const },
};

const profileBrief = {
  ...spreadBrief,
  color_direction: { source: "profile" },
  style_direction: "Casual outfit — lean olive based on what you liked.",
};

export const e2eMemoryLoop: E2eScenario = {
  name: "e2e_memory_loop",
  description: "Reject dark + promote olive → second search uses profile palette.",
  seed: { profile_state: { genderPresentation: "mens", preferredName: "Alex" } },
  catalog: baseMensCatalog,
  llm_recordings: {
    router: [
      { stage: "router", toolName: READY_TO_SEARCH_TOOL_NAME, input: { brief: spreadBrief } },
      { stage: "router", toolName: READY_TO_SEARCH_TOOL_NAME, input: { brief: profileBrief } },
    ],
    planner: [
      outfitPlannerRecording(["shirt", "trousers"]),
      {
        ...outfitPlannerRecording(["shirt", "trousers"]),
        input: {
          ...outfitPlannerRecording(["shirt", "trousers"]).input,
          slots: outfitPlannerRecording(["shirt", "trousers"]).input.slots.map((s) => ({
            ...s,
            palette_source: "profile",
          })),
        },
      },
    ],
    curation: [curationRecording(["shirt", "trousers"]), curationRecording(["shirt", "trousers"])],
  },
  steps: [
    {
      user: "casual weekend outfit — shirt and trousers",
      expect: { route: { move: "ready_to_search" } },
    },
    {
      interact: { kind: "reject", slotId: "shirt" },
    },
    {
      user: "another casual outfit like last time — shirt and trousers",
      expect: {
        route: { move: "ready_to_search" },
        plan: { paletteSource: "profile" },
      },
    },
  ],
};
