/**
 * Frozen render contract — THE versioned presentation surface for chat UI.
 * Frontend renders from this and nothing else.
 */
export const RENDER_CONTRACT_VERSION = 1 as const;

/** Size converted from recipient system to merchant label. */
export type RenderBadgeSizeConverted = {
  kind: "size_converted";
  from: string;
  merchant_label: string;
};

/** Size availability unknown at hydration. */
export type RenderBadgeSizeUnknown = { kind: "size_unknown" };

/** Material suspicion — owned copy only (`may contain <material>`). */
export type RenderBadgeMaterialSuspected = {
  kind: "material_suspected";
  material: string;
};

/** Photo shows different color than listing. */
export type RenderBadgePhotoColor = {
  kind: "photo_color";
  color: string;
  listed?: string;
};

/** Price lifted near budget ceiling. */
export type RenderBadgeNearBudgetLifted = { kind: "near_budget_lifted" };

/** Brand not confirmed in catalog metadata. */
export type RenderBadgeBrandUnconfirmed = { kind: "brand_unconfirmed" };

export type RenderPickBadge =
  | RenderBadgeSizeConverted
  | RenderBadgeSizeUnknown
  | RenderBadgeMaterialSuspected
  | RenderBadgePhotoColor
  | RenderBadgeNearBudgetLifted
  | RenderBadgeBrandUnconfirmed;

/** Tier-1 curated pick — hero placement with stylist voice. */
export type RenderPick = {
  ref: string;
  slot_id: string;
  garment: string;
  id: string;
  title: string;
  imageUrl?: string;
  displayPrice?: { amount: number; currency: string };
  preferredOptions?: Array<{ name: string; label: string }>;
  featuredVariant?: {
    id: string;
    price?: { amount: number; currency: string };
    checkoutUrl?: string;
    options?: Array<{ name: string; label: string }>;
  };
  role: string;
  stylist_line: string;
  badges: RenderPickBadge[];
  look_names?: string[];
  corrected_color?: string;
  score_rank: number;
  product_url?: string;
  tryon?: {
    available: boolean;
    /** When no avatar yet — UI shows create-avatar CTA instead of try-on. */
    cta?: "create_avatar";
    image_url?: string;
    job_id?: string;
    compare?: boolean;
    disclaimer: "AI visualization — actual fit and details may differ";
  };
};

/** Tier-2 verified bench item — promotable alternative. */
export type RenderVerifiedItem = {
  ref: string;
  slot_id: string;
  garment: string;
  id: string;
  title: string;
  imageUrl?: string;
  displayPrice?: { amount: number; currency: string };
  preferredOptions?: Array<{ name: string; label: string }>;
  featuredVariant?: {
    id: string;
    price?: { amount: number; currency: string };
    checkoutUrl?: string;
    options?: Array<{ name: string; label: string }>;
  };
  score_rank: number;
  size_status?: string;
  product_url?: string;
};

/** Tier-3 unverified overflow — curiosity tap triggers on-demand verify. */
export type RenderUnverifiedItem = {
  product_id: string;
  slot_id: string;
  garment: string;
  title: string;
  price?: { amount: number; currency: string };
  image_url?: string;
  score_rank: number;
  verification: "not_verified";
  size_note?: string;
};

/** Honest degradation surfaced to the user — never confess invisible turbulence. */
export type RenderDegradation = {
  kind:
    | "none"
    | "curation_fallback"
    | "partial_slots"
    | "heavy_unverified"
    | "voice_fallback";
  user_line: string;
  action?: "recurate";
};

/** Stylist-voice narration blocks. */
export type RenderNextStepOffer = {
  text: string;
  chips: string[];
};

export type RenderNarration = {
  opening: string;
  brand_note?: string;
  budget_note?: string;
  thin_note?: string;
  next_step_offer?: RenderNextStepOffer;
  degradation: RenderDegradation;
};

/** A named look with code-computed total. */
export type RenderLook = {
  name: string;
  item_refs: string[];
  total: number;
  note?: string;
  tryon?: {
    available: boolean;
    /** When no avatar yet — UI shows create-avatar CTA instead of try-on. */
    cta?: "create_avatar";
    disclaimer: "AI visualization — actual fit and details may differ";
  };
  tryon_look?: {
    status: string;
    steps: Array<{
      ref: string;
      title?: string;
      price?: { amount: number; currency: string };
      status: string;
      image_url?: string;
      note?: string;
    }>;
    final_image_url?: string;
    disclaimer: "AI visualization — actual fit and details may differ";
    job_id?: string;
    partial_note?: string;
    compare?: boolean;
    variants?: Array<{
      provider_key: "fashn";
      provider: string;
      label: string;
      job_id: string;
      status: string;
      image_url?: string;
      ms?: number;
      error?: string;
    }>;
  };
};

/** Capsule outfit grouping with set_total validated in code. */
export type RenderCapsuleOutfit = {
  item_refs: string[];
  label?: string;
  /** Stable id for outfit try-on API (`capsule:…`). */
  look_id?: string;
  tryon?: {
    available: boolean;
    /** When no avatar yet — UI shows create-avatar CTA instead of try-on. */
    cta?: "create_avatar";
    disclaimer: "AI visualization — actual fit and details may differ";
  };
};

/** Interaction affordance flags for the UI layer. */
export type RenderAffordances = {
  can_recurate: boolean;
  exhausted: boolean;
  suggest_new_search?: boolean;
};

/** Complete frozen render contract. */
export type RenderContract = {
  contract_version: typeof RENDER_CONTRACT_VERSION;
  narration: RenderNarration;
  tiers: {
    picks: RenderPick[];
    verified: RenderVerifiedItem[];
    unverified: RenderUnverifiedItem[];
  };
  looks?: RenderLook[];
  capsule_outfits?: RenderCapsuleOutfit[];
  meta: {
    mode: string;
    thin_slots: string[];
    set_total?: number;
    budget_tension?: string;
    fallback: boolean;
  };
  affordances: RenderAffordances;
};
