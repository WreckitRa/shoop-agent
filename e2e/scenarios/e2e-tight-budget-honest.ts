import type { E2eScenario } from "../types";
import { makeNoiseProduct, makeProduct } from "../../test/fake-ucp/make-product";
import { curationRecording, plannerQueryVariants } from "./_helpers";
import { READY_TO_SEARCH_TOOL_NAME } from "@/lib/fashion-memory/router/tool-schema";
import { PLAN_SEARCH_TOOL_NAME } from "@/lib/fashion-memory/search-planner/tool-schema";

const shoesBrief = {
  recipient_person_id: "self",
  request_type: "single_item",
  garments: ["shoes"],
  occasion_context: "general",
  quantity_hint: "one",
  must_haves: [] as string[],
  nice_to_haves: [] as string[],
  budget_context: { stated: true, max: 10, currency: "USD" },
  style_direction: "Men's shoes under $10.",
  department_scope: "mens",
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shoes"],
    sizes_unconfirmed: [] as string[],
  },
};

export const e2eTightBudgetHonest: E2eScenario = {
  name: "e2e_tight_budget_honest",
  description: "$10 shoes with junk noise → honest infeasible tension, no barrel-scraping.",
  seed: { profile_state: { genderPresentation: "mens" } },
  catalog: {
    relevant: [
      makeProduct("gid://shopify/Product/s10", "Men's Budget Sneaker", {
        priceUsd: 9.99,
        size: "10",
        gender: "mens",
      }),
    ],
    noise: [
      makeNoiseProduct("gid://shopify/Product/junk1", "Random Home Decor", {
        priceUsd: 2,
      }),
      makeNoiseProduct("gid://shopify/Product/junk2", "Womens Sandals", {
        priceUsd: 4,
        gender: "womens",
      }),
    ],
    priceFilterMode: "soft",
  },
  llm_recordings: {
    router: [
      { stage: "router", toolName: READY_TO_SEARCH_TOOL_NAME, input: { brief: shoesBrief } },
    ],
    planner: [
      {
        stage: "planner",
        toolName: PLAN_SEARCH_TOOL_NAME,
        input: {
          mode: "single_item",
          reasoning: "Tight shoe budget",
          slots: [
            {
              slot_id: "shoes",
              garment: "shoes",
              role: "anchor",
              style_direction: "Budget mens shoes",
              palette_constraint: null,
              palette_source: "spread",
              options_wanted: 3,
              query_variants: plannerQueryVariants("mens", "shoes"),
            },
          ],
        },
      },
    ],
    curation: [curationRecording(["shoes"])],
  },
  steps: [
    {
      user: "men's shoes under $10",
      expect: {
        funnel: { tension: "infeasible" },
        events: { invariantWarningsEmpty: true },
      },
    },
  ],
};
