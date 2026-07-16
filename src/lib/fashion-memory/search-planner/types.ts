import type {
  FashionBriefKnowledgeState,
  FashionSearchBrief,
} from "../router/types";
import type { PaletteSource } from "./palette-ladder";

export type SearchPlanMode =
  | "single_item"
  | "outfit"
  | "capsule"
  | "multi_item";

export type SearchPlanSlotRole = "anchor" | "support";

/** How the resolved plan was produced — persisted for curation honesty. */
export type PlanSource = "planner" | "clamped" | "fallback";

export type FashionSearchPlanSlot = {
  slot_id: string;
  garment: string;
  role: SearchPlanSlotRole;
  style_direction: string;
  palette_constraint: string | null;
  palette_source: PaletteSource;
  options_wanted: number;
  query_variants: string[];
  /** 0–1 share of total budget; outfit/capsule + stated budget only. */
  budget_fraction?: number;
  /** Set after catalog brand probe — drives scoring + narration. */
  brand_status?: import("../router/types").FashionSlotBrandStatus;
  brand_sanity_note?: string;
  brand_confirmed_count?: number;
  brand_style_descriptors?: string[];
  /**
   * No taxonomy / accessory-family mapping — pass through the user's noun,
   * omit category filter, skip sizing. Surfaced via unknown_garment_family.
   */
  unknown_family?: boolean;
};

/** Validated retrieval plan generated from a confirmed brief. */
export type FashionSearchPlan = {
  version: 1;
  mode: SearchPlanMode;
  slots: FashionSearchPlanSlot[];
  reasoning: string;
  brief: FashionSearchBrief;
  currentDate: string;
  plan_source?: PlanSource;
  budget_allocation?: import("../budget/budgetAllocation").ResolvedBudgetAllocation;
};

export type MessageFashionSearchPlanMetaV1 = {
  version: 1;
  mode: SearchPlanMode;
  slots: FashionSearchPlanSlot[];
  reasoning: string;
  plan_source?: PlanSource;
  recipient_person_id: string;
  knowledge_state: FashionBriefKnowledgeState;
  trace_id?: string;
  budget_assembly?: import("../budget/budgetAllocation").BudgetAssembly;
  budget_interpretation?: import("../budget/budgetAllocation").BudgetInterpretation;
  budget_allocation_validation?: import("../budget/budgetAllocation").BudgetValidation;
  per_slot_budget?: Record<
    string,
    Pick<
      import("../budget/budgetAllocation").SlotBudgetAllocation,
      "fraction" | "fraction_source" | "allocated_max" | "padded_max"
    >
  >;
};
