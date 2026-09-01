import type { E2eScenario } from "../types";
import { baseMensCatalog } from "../../test/fake-ucp/catalogs/base-mens";
import {
  capsulePlannerRecording,
  curationRecording,
  mensDepartmentFirst,
} from "./_helpers";
import { READY_TO_SEARCH_TOOL_NAME } from "@/lib/fashion-memory/router/tool-schema";

const capsuleBrief = {
  recipient_person_id: "self",
  request_type: "capsule",
  garments: ["shirt", "trousers", "shoes"],
  occasion_context: "work",
  quantity_hint: "3 outfits to rotate",
  must_haves: [] as string[],
  nice_to_haves: [] as string[],
  budget_context: { stated: true, max: 300, currency: "USD" },
  style_direction: "3 work outfits to rotate, $300 total.",
  department_scope: "mens",
  stated_facts: {
    person_ref: "self",
    department: "mens",
    sizes: { tops: "M", bottoms: "33", shoes: "10" },
    budget: { max: 300, currency: "USD" },
  },
  knowledge_state: {
    department: "mens",
    sizes_confirmed: ["shirt", "trousers", "shoes"],
    sizes_unconfirmed: [] as string[],
  },
  depth: { looks_wanted: 3, source: "stated" as const },
};

export const e2eCapsule300: E2eScenario = {
  name: "e2e_capsule_300",
  description: "$300 capsule — per-piece bounds, set_total, capsule grid.",
  seed: { profile_state: { genderPresentation: "mens" } },
  catalog: baseMensCatalog,
  curation_options: { capsuleOutfits: true },
  llm_recordings: {
    router: [
      {
        stage: "router",
        toolName: READY_TO_SEARCH_TOOL_NAME,
        input: { brief: capsuleBrief },
      },
    ],
    planner: [capsulePlannerRecording()],
    curation: [
      {
        stage: "curation",
        toolName: "deliver_curation",
        input: {
          slots: ["shirt", "trousers", "shoes"].map((id) => ({
            slot_id: id,
            picks: [{ ref: "p1", role: "safe", stylist_line: "Work rotation pick." }],
          })),
          capsule_outfits: [
            { item_refs: ["p1", "p2", "p3"], label: "Look A" },
            { item_refs: ["p4", "p5", "p6"], label: "Look B" },
          ],
          vetoes: [],
          narration: {
            opening: "Three work rotations within your $300 set budget.",
            budget_note: "Set total $300 across three rotations.",
          },
        },
      },
    ],
  },
  steps: [
    {
      user: "3 work outfits to rotate — shirts, trousers, and shoes, $300 total",
      expect: {
        plan: {
          mode: "capsule",
          setTotal: 300,
          perPieceMax: 100,
        },
        queries: [mensDepartmentFirst],
      },
    },
  ],
};
