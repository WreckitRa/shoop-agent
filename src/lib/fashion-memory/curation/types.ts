import type { BudgetInterpretation } from "../budget/budgetAllocation";
import type { BudgetTension } from "../budget/budgetTension";
import type { BudgetAssembly } from "../budget/budgetAllocation";
import type {
  HydratedCandidate,
  HydrationDeathCause,
  OverflowItem,
} from "../hydration/types";
import type { FashionSearchPlan, SearchPlanMode } from "../search-planner/types";
import type { FashionSlotBrandStatus } from "../router/types";
import type { ProductCard } from "@/lib/ai-chat/types";

export type PickRole =
  | "safe"
  | "stretch"
  | "value"
  | "reach"
  | "anchor"
  | "support";

export type CuratorVetoReason =
  | "wrong_item_type"
  | "wrong_department_visual"
  | "color_mismatch_visual"
  | "visibly_off_brief"
  | "quality_visual"
  | "duplicate_of_pick"
  | "exclusion_violation";

export type CurationNarration = {
  opening: string;
  brand_note?: string;
  budget_note?: string;
  thin_note?: string;
};

export type CurationLook = {
  name: string;
  item_refs: string[];
  total: number;
  note?: string;
};

export type CapsuleOutfit = {
  item_refs: string[];
  label?: string;
};

export type DeliverCurationPick = {
  ref: string;
  role: PickRole;
  stylist_line: string;
  corrected_color?: string;
};

export type DeliverCurationSlot = {
  slot_id: string;
  picks: DeliverCurationPick[];
};

export type DeliverCurationVeto = {
  ref: string;
  reason: CuratorVetoReason;
  evidence: string;
};

export type DeliverCurationInput = {
  slots: DeliverCurationSlot[];
  looks?: CurationLook[];
  capsule_outfits?: CapsuleOutfit[];
  vetoes: DeliverCurationVeto[];
  narration: CurationNarration;
};

export type RefEntry = {
  ref: string;
  slot_id: string;
  product_id: string;
  candidate: HydratedCandidate;
  score_rank: number;
  image_shown: boolean;
};

export type CurationRefRegistry = Map<string, RefEntry>;

/**
 * User-facing pick badges — CLOSED enum. Internal flags (attire_conflict,
 * department_unknown, raw evidence) must never appear here.
 */
export type FashionCuratedPickBadge =
  | { kind: "converted_size"; from: string; label: string }
  | { kind: "check_sizing" }
  | { kind: "material_suspected"; material: string }
  | { kind: "photo_color"; color: string; listed?: string }
  | { kind: "near_budget_lifted" }
  | { kind: "brand_unconfirmed" };

export type FashionCuratedPick = ProductCard & {
  ref: string;
  slot_id: string;
  garment: string;
  role: PickRole;
  stylist_line: string;
  badges: FashionCuratedPickBadge[];
  look_names?: string[];
  corrected_color?: string;
  score_rank: number;
  brand_confirmed?: boolean;
};

export type FashionVerifiedTierItem = ProductCard & {
  ref: string;
  slot_id: string;
  garment: string;
  score_rank: number;
  brand_confirmed?: boolean;
  size_status?: string;
};

export type FashionUnverifiedTierItem = OverflowItem & {
  slot_id: string;
  garment: string;
};

export type FashionCurationPresentation = {
  narration: CurationNarration;
  tiers: {
    picks: FashionCuratedPick[];
    verified: FashionVerifiedTierItem[];
    unverified: FashionUnverifiedTierItem[];
  };
  looks?: CurationLook[];
  capsule_outfits?: CapsuleOutfit[];
  meta: {
    mode: SearchPlanMode;
    thin_slots: string[];
    brand_status: Record<string, FashionSlotBrandStatus | undefined>;
    budget_tension?: BudgetTension["severity"];
    budget_interpretation?: BudgetInterpretation;
    /** Capsule: sum of all picked pieces (major units). */
    set_total?: number;
    fallback: boolean;
    /**
     * Stage B LLM voice failed → deterministic stylist templates.
     * Picks are fine; render contract carries degradation.kind=voice_fallback.
     */
    voice_fallback?: boolean;
    weights_version?: string;
  };
};

export type FashionCurationResult = {
  presentation: FashionCurationPresentation;
  curation_ms: number;
  registry: CurationRefRegistry;
  debug: import("./fashion-curation-debug").FashionCurationDebugV1;
};

export type RunFashionCurationParams = {
  traceId?: string | null;
  plan: FashionSearchPlan;
  slots: Array<{
    slot_id: string;
    garment: string;
    verified_pool?: HydratedCandidate[];
    overflow_items?: OverflowItem[];
    thin_slot?: boolean;
    coverage_gap?: boolean;
    curator_exclusions?: string[];
    brand_status?: FashionSlotBrandStatus;
    brand_sanity_note?: string;
    brand_confirmed_count?: number;
  }>;
  pools: Map<
    string,
    {
      reportDeath(
        productId: string,
        cause: HydrationDeathCause,
        stage: string,
      ): Promise<void>;
      verified: HydratedCandidate[];
      getOverflow(n?: number): OverflowItem[];
    }
  >;
  tasteSignals?: Array<{
    attribute_type: string;
    attribute_value: string;
    polarity: number;
  }>;
  budget_assembly?: BudgetAssembly;
  budget_tension?: BudgetTension;
  budget_interpretation?: BudgetInterpretation;
  recipientRelation?: string;
  department?: string;
  /** Full recipient profile text for the curator (facts + signals). */
  recipientProfile?: string;
  excludedRefs?: string[];
  signal?: AbortSignal;
  /** Stage A rung overrides — shrink image budget / omit images / hard timeout. */
  imageBudgetScale?: number;
  omitImages?: boolean;
  timeoutMs?: number;
  /** Skip LLM entirely — deterministic looks synthesis only (rung 4). */
  deterministicOnly?: boolean;
  /** E2E/test — mock curation LLM without patching Anthropic client. */
  createMessage?: (params: {
    traceId?: string | null;
    systemPrompt: string;
    userMessages: import("@anthropic-ai/sdk/resources/messages/messages").MessageCreateParamsNonStreaming["messages"];
    signal?: AbortSignal;
    correctiveHint?: string;
    timeoutMs?: number;
  }) => Promise<import("@anthropic-ai/sdk/resources/messages/messages").Message>;
  /** E2E/test — bypass LLM with registry-aligned deliver_curation payload. */
  resolveCurationMessage?: (ctx: {
    registry: CurationRefRegistry;
    plan: FashionSearchPlan;
    slots: RunFashionCurationParams["slots"];
  }) =>
    | Promise<import("@anthropic-ai/sdk/resources/messages/messages").Message>
    | import("@anthropic-ai/sdk/resources/messages/messages").Message;
};

export type MessageFashionCurationMetaV1 = FashionCurationPresentation & {
  version: 1;
  trace_id?: string;
};
