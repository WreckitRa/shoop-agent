import type { E2eScenario } from "../types";
import { baseMensCatalog } from "../../test/fake-ucp/catalogs/base-mens";
import {
  joeRouterRecording,
  outfitPlannerRecording,
  curationRecording,
  mensDepartmentFirst,
} from "./_helpers";

export const e2eJoeFirstMessage: E2eScenario = {
  name: "e2e_joe_first_message",
  description: "Joe message → zero clarifications, outfit plan ≥3 slots, tiers rendered.",
  seed: {},
  catalog: baseMensCatalog,
  llm_recordings: {
    router: [joeRouterRecording()],
    planner: [outfitPlannerRecording(["shirt", "trousers", "shoes"])],
    curation: [curationRecording(["shirt", "trousers", "shoes"])],
  },
  steps: [
    {
      user: "full formal outfit for Joe — shirt, trousers, and shoes, under $100, Men's, M tops, 33 bottoms, shoes 10, business event",
      expect: {
        route: { move: "ready_to_search" },
        plan: { slotCountMin: 3, mode: "outfit" },
        queries: [mensDepartmentFirst],
        curation: { picksMin: 1 },
        memory: { factCountMin: 1 },
        events: { invariantWarningsEmpty: true },
      },
    },
  ],
};
