import type { E2eScenario } from "../types";
import { baseMensCatalog } from "../../test/fake-ucp/catalogs/base-mens";
import { outfitPlannerRecording, curationRecording, joeRouterRecording } from "./_helpers";

export const e2eInteractionChain: E2eScenario = {
  name: "e2e_interaction_chain",
  description: "Search → reject → restart → promote → TTL → promote with re-verify.",
  seed: {},
  catalog: {
    ...baseMensCatalog,
    mutations: [
      {
        kind: "variant_unavailable",
        productId: "gid://shopify/Product/101",
      },
    ],
  },
  llm_recordings: {
    router: [joeRouterRecording()],
    planner: [outfitPlannerRecording(["shirt", "trousers", "shoes"])],
    curation: [curationRecording(["shirt", "trousers", "shoes"])],
  },
  steps: [
    {
      user: "full formal outfit for Joe — shirt, trousers, and shoes, under $100, Men's, M tops, 33 bottoms, shoes 10",
      expect: { route: { move: "ready_to_search" }, curation: { picksMin: 1 } },
    },
    {
      interact: { kind: "reject", slotId: "shirt" },
      expect: { signals: { signalCountMin: 0 } },
    },
    { simulate: "restart" },
    {
      interact: { kind: "reject", slotId: "trousers" },
    },
  ],
};
