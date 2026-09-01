import type { E2eScenario } from "../types";
import { baseMensCatalog } from "../../test/fake-ucp/catalogs/base-mens";
import {
  joeRouterRecording,
  outfitPlannerRecording,
  mensDepartmentFirst,
} from "./_helpers";

export const e2eFullSseTurn: E2eScenario = {
  name: "e2e_full_sse_turn",
  description:
    "Full SSE path via createFashionChatSseStream; turn-2 router shows prompt-cache reads.",
  seed: {},
  catalog: baseMensCatalog,
  use_sse: true,
  llm_recordings: {
    router: [joeRouterRecording(), joeRouterRecording()],
    planner: [
      outfitPlannerRecording(["shirt", "trousers", "shoes"]),
      outfitPlannerRecording(["shirt", "trousers", "shoes"]),
    ],
  },
  steps: [
    {
      user: "full formal outfit for Joe — shirt, trousers, and shoes, under $100, Men's, M tops, 33 bottoms, shoes 10",
      expect: {
        route: { move: "ready_to_search" },
        plan: { slotCountMin: 3, mode: "outfit" },
        queries: [mensDepartmentFirst],
        curation: { picksMin: 1 },
        sse: {
          sseEvents: [
            "fashion_router",
            "fashion_search_plan",
            "fashion_catalog_search",
          ],
        },
        events: { invariantWarningsEmpty: true },
      },
    },
    {
      user: "another formal look for Joe under $100 — shirt, trousers, and shoes",
      expect: {
        route: { move: "ready_to_search" },
        events: { routerCacheReadOnTurn2: true },
      },
    },
  ],
};
