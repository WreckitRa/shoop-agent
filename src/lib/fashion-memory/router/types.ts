import type { FashionDepartment } from "../department";

export type ColorDirectionSource = "stated" | "profile" | "none";

export type FashionBriefColorDirection = {
  source: ColorDirectionSource;
  stated_colors?: string[];
};

export type BrandDirectionSource = "stated" | "profile" | "none";

export type FashionBriefBrandDirection = {
  source: BrandDirectionSource;
  /** User-stated brands, normalized lowercase. */
  brands?: string[];
};

/** Post-retrieval brand outcome for a slot — drives scoring + narration. */
export type FashionSlotBrandStatus = "confirmed" | "partial" | "translated";

export type FashionBriefKnowledgeState = {
  department: FashionDepartment;
  sizes_confirmed: string[];
  sizes_unconfirmed: string[];
};

/**
 * Conversation-stated essentials the router copies onto the tool call so the
 * identity gate can register them synchronously (before async extraction).
 */
export type FashionStatedFacts = {
  /** Roster id, short id, or `"new"` when introducing someone. */
  person_ref: string | "new";
  new_person?: { name?: string; relation?: string };
  department?: import("../department").PersonDepartment;
  sizes?: {
    tops?: string;
    bottoms?: string;
    shoes?: string;
    dresses?: string;
  };
  budget?: { max?: number; currency?: string };
};

/** Structured brief produced by ready_to_search. */
export type FashionSearchBrief = {
  recipient_person_id: string;
  request_type: "single_item" | "outfit" | "capsule" | "multi_item";
  garments: string[];
  occasion_context: string;
  quantity_hint: string;
  must_haves: string[];
  nice_to_haves: string[];
  budget_context: {
    max?: number;
    min?: number;
    currency?: string;
    stated: boolean;
    /**
     * How the stated number applies. `"per_item"` from "each" / "per item" /
     * "a piece" language — a STATED scope, not an assumption.
     */
    scope?: "per_item" | "total";
  };
  style_direction: string;
  /** Set after inline department clarification. */
  department_scope?: FashionDepartment;
  /** Router sets source; planner resolves occasion_default from source:"none". */
  color_direction?: FashionBriefColorDirection;
  /**
   * Stated brands are a binding request constraint — never drop them,
   * never put them in must_haves (they'd be treated as text attributes).
   */
  brand_direction?: FashionBriefBrandDirection;
  /**
   * Facts stated in this conversation — registered synchronously in the gate
   * before knowledge checks. Optional on ask_clarification too.
   */
  stated_facts?: FashionStatedFacts;
  /** Filled by code in identity-gate — never by the LLM. */
  knowledge_state?: FashionBriefKnowledgeState;
};

export type FashionRouterContext = {
  roster: string;
  profiles: string;
  currentDate: string;
  personShortIds: Record<string, string>;
  /** Last 12 turns, oldest first — excludes the in-flight user message if not yet persisted. */
  conversationMessages: Array<{ role: "user" | "assistant"; content: string }>;
};

export type FashionClarificationGap =
  | "garment"
  | "recipient"
  | "person_name"
  | "department"
  | "size"
  | "occasion"
  | "budget";

/** Optional apply-path field for deterministic size/department templates. */
export type FashionClarificationApplyField =
  | "gender_presentation"
  | "size_tops"
  | "size_bottoms"
  | "size_shoes"
  | "size_dresses"
  | "fit_preference"
  | "person_name"
  | "budget_max";

export type FashionClarificationQuestion = {
  text: string;
  gap: FashionClarificationGap;
  garment_type?: string;
  quick_options?: string[];
  /** Present on gate templates so answers can be written as facts. */
  field?: FashionClarificationApplyField;
};

export type FashionClarificationRideAlong = {
  text: string;
  quick_options: string[];
};

/** @deprecated Use FashionClarificationQuestion — kept for apply-path aliases. */
export type FashionIntakeQuestionField = FashionClarificationApplyField;

/** @deprecated Use FashionClarificationQuestion. */
export type FashionIntakeQuestion = {
  field: FashionIntakeQuestionField;
  question: string;
  quick_options?: string[];
};

export type FashionRouterMove =
  | "respond_off_topic"
  | "ask_clarification"
  | "ready_to_search";

export type FashionRouterResult =
  | { move: "respond_off_topic"; reply: string }
  | {
      move: "ask_clarification";
      reply: string;
      questions: FashionClarificationQuestion[];
      ride_along?: FashionClarificationRideAlong;
      /** Partial essentials captured mid-clarification. */
      stated_facts?: FashionStatedFacts;
      /** Set by gate when clarifying for a known recipient. */
      target_person_id?: string;
    }
  | { move: "ready_to_search"; brief: FashionSearchBrief };

/** Persisted on assistant message metadata after a router turn. */
export type MessageFashionRouterMetaV1 = {
  version: 1;
  move: FashionRouterMove;
  reply?: string;
  questions?: FashionClarificationQuestion[];
  ride_along?: FashionClarificationRideAlong;
  brief?: FashionSearchBrief;
  /** Conversation-stated essentials — also nested under brief for search turns. */
  stated_facts?: FashionStatedFacts;
  target_person_id?: string;
  /** Gaps the user declined twice — no longer block search. */
  declined_gaps?: Array<{ gap: FashionClarificationGap; person_id: string; garment_type?: string }>;
  /**
   * Quiz lifecycle. `pending` while chips are open; `answered` after the user
   * submits (or sends any follow-up). Survives page refresh.
   */
  status?: "pending" | "answered";
  /** question.text → selected answer label (chip or free text). */
  answers?: Record<string, string>;
  /** @deprecated Legacy flat clarification chips — prefer questions[]. */
  missing?: string[];
  /** @deprecated Legacy flat clarification chips — prefer questions[]. */
  quick_options?: string[];
  /** @deprecated Legacy intake metadata — prefer questions[]. */
  intake?: {
    target_person_id: string;
    questions: FashionIntakeQuestion[];
  };
  trace_id?: string;
};

export type FashionPendingBriefMetaV1 = {
  version: 1;
  brief: FashionSearchBrief;
  recipientPersonId: string;
  savedAt: string;
};
