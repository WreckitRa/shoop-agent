import type { E2eScenario } from "../types";
import { makeProduct } from "../../test/fake-ucp/make-product";
import { curationRecording, plannerQueryVariants } from "./_helpers";
import { READY_TO_SEARCH_TOOL_NAME } from "@/lib/fashion-memory/router/tool-schema";
import { PLAN_SEARCH_TOOL_NAME } from "@/lib/fashion-memory/search-planner/tool-schema";

const aldoBrief = {
  recipient_person_id: "mother",
  request_type: "single_item",
  garments: ["dress"],
  occasion_context: "general",
  quantity_hint: "one",
  must_haves: [] as string[],
  nice_to_haves: [] as string[],
  budget_context: { stated: false },
  style_direction: "A dress for my mother from Aldo.",
  department_scope: "womens",
  brand_direction: { source: "stated", brands: ["aldo"] },
  knowledge_state: {
    department: "womens",
    sizes_confirmed: ["dress"],
    sizes_unconfirmed: [] as string[],
  },
};

/** Zero Aldo products — forces brand probe + translation. */
const noAldoCatalog = {
  relevant: [
    makeProduct("gid://shopify/Product/d201", "Womens Linen Midi Dress", {
      priceUsd: 89,
      gender: "womens",
      color: "Sage",
      size: "M",
    }),
    makeProduct("gid://shopify/Product/d202", "Womens Day Dress", {
      priceUsd: 79,
      gender: "womens",
      color: "Navy",
      size: "M",
    }),
  ],
};

export const e2eAldoTranslated: E2eScenario = {
  name: "e2e_aldo_translated",
  description: "Stated Aldo brand with zero catalog hits → translation + brand_note.",
  seed: {},
  catalog: noAldoCatalog,
  curation_options: {
    brandNote: "Aldo doesn't sell dresses — showing similar womens day dresses.",
    opening: "Similar womens day dresses since Aldo doesn't carry dresses.",
  },
  llm_recordings: {
    router: [
      {
        stage: "router",
        toolName: READY_TO_SEARCH_TOOL_NAME,
        input: { brief: aldoBrief },
      },
    ],
    planner: [
      {
        stage: "planner",
        toolName: PLAN_SEARCH_TOOL_NAME,
        input: {
          mode: "single_item",
          reasoning: "Aldo dress request",
          slots: [
            {
              slot_id: "dress",
              garment: "dress",
              role: "anchor",
              style_direction: aldoBrief.style_direction,
              palette_constraint: null,
              palette_source: "spread",
              options_wanted: 4,
              query_variants: plannerQueryVariants("womens", "dress"),
              brand_status: "translate",
            },
          ],
        },
      },
    ],
    extraction: [
      {
        stage: "brand_translate",
        toolName: "brand_translate",
        input: {
          translated_style: "polished womens day dress",
          query_variants: ["womens polished day dress", "womens linen midi dress"],
          brand_note: "Aldo doesn't sell dresses — showing similar womens day dresses.",
        },
      },
    ],
    curation: [
      {
        ...curationRecording(["dress"]),
        input: {
          ...curationRecording(["dress"]).input,
          narration: {
            opening: "Similar womens day dresses since Aldo doesn't carry dresses.",
            brand_note: "Aldo doesn't sell dresses — showing similar womens day dresses.",
          },
        },
      },
    ],
  },
  steps: [
    {
      user: "i want a dress for my mother from aldo",
      expect: {
        curation: { brandNotePresent: true, brandMentioned: "aldo" },
      },
    },
  ],
};
