/**
 * Stage 0 interpretation: classify a request into one of four archetypes and
 * assemble a structured `SearchBrief`. See docs/search-improvements.md §4.
 *
 * The chat model normally supplies the brief fields via the search tool; this
 * module fills the gaps deterministically (archetype + ranking profile +
 * budget classification + gender scope from the buyer profile) so the engine
 * always has a complete brief even when the model omits fields.
 */
import type { OccasionProfile } from "./brief-occasion";
import type { ShoppingMode } from "@/lib/ai-chat/shopping-mode/types";
import {
  applyProvenanceToBrief,
  tagListProvenance,
  type BriefProvenance,
} from "./brief-provenance";
import {
  DEFAULT_RANKING_PROFILE,
  type Archetype,
  type BudgetType,
  type GenderScope,
  type RankingProfile,
  type SearchBrief,
  type SearchBriefBudget,
  type VariantConstraints,
} from "./types";

const GIFT_PHRASES: RegExp[] = [
  /\bgift\b/iu,
  /\bpresent\b/iu,
  /\bfor\s+(?:my|a|his|her|their)\s+(?:wife|husband|mom|mum|mother|dad|father|girlfriend|boyfriend|partner|friend|sister|brother|son|daughter|kid|kids|niece|nephew|coworker|boss|teacher|grandma|grandpa)\b/iu,
  /\bbirthday\b/iu,
  /\banniversary\b/iu,
  /\bvalentine'?s?\b/iu,
  /\bchristmas\b/iu,
];

const SPECIFIC_PHRASES: RegExp[] = [
  /\bunder\s*\$?\s*\d/iu,
  /\baround\s*\$?\s*\d/iu,
  /\bsize\s*(?:us|uk|eu)?\s*\d{1,3}(?:\.\d)?\b/iu,
  /\b(?:eu|us|uk)\s*\d{1,3}(?:\.\d)?\b/iu,
  /\b(?:xxs|xs|small|medium|large|xl|xxl|xxxl)\b/iu,
  /\bvs\.?\b/iu,
  /\bversus\b/iu,
  /\b\d{1,4}\s?(?:gb|tb|ghz|mm|cm|inch(?:es)?|wh|mah)\b/iu,
];

const VAGUE_PHRASES: RegExp[] = [
  /\b(?:i\s*don'?t|not\s*sure|no\s*idea)\b/iu,
  /\bsurprise\s+me\b/iu,
  /\bany\s+(?:ideas?|suggestions?|recs?|recommendations?)\b/iu,
  /\bwhat\s+(?:should|would|could)\s+i\b/iu,
  /\bhelp\s+me\s+(?:choose|pick|decide|find)\b/iu,
  /\binspire\s+me\b/iu,
];

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export type ArchetypeSignals = {
  query: string;
  /** True when memory holds the recipient's interests/preferences. */
  hasRecipientFacts?: boolean;
  /** True when the user gave SOME anchor (interest/occasion) for a gift. */
  hasGiftAnchor?: boolean;
  previousArchetype?: Archetype | null;
};

export type ArchetypeResult = {
  archetype: Archetype;
  reason: string;
};

/**
 * Deterministic archetype classifier. Gift framing splits into directed
 * (we have a usable direction) vs vague (we need a direction first).
 */
export function classifyArchetype(input: ArchetypeSignals): ArchetypeResult {
  const text = (input.query ?? "").trim();
  if (!text) {
    return {
      archetype: input.previousArchetype ?? "broad",
      reason: "empty query",
    };
  }

  const isGift = anyMatch(text, GIFT_PHRASES);
  if (isGift) {
    const directed =
      input.hasRecipientFacts === true || input.hasGiftAnchor === true;
    return directed
      ? { archetype: "gift_directed", reason: "gift with usable direction" }
      : { archetype: "gift_vague", reason: "gift without a direction yet" };
  }

  if (anyMatch(text, SPECIFIC_PHRASES)) {
    return {
      archetype: "specific",
      reason: "explicit constraints / comparison",
    };
  }

  if (anyMatch(text, VAGUE_PHRASES)) {
    return { archetype: "broad", reason: "exploratory wording" };
  }

  // Short bare-category asks ("black t-shirt", "running shoes") => broad.
  const wordCount = text.split(/\s+/u).length;
  if (wordCount <= 5) {
    return { archetype: "broad", reason: "short, broad category ask" };
  }

  return {
    archetype: input.previousArchetype ?? "broad",
    reason: input.previousArchetype
      ? "continuing prior archetype"
      : "default broad",
  };
}

export function rankingProfileForArchetype(a: Archetype): RankingProfile {
  return DEFAULT_RANKING_PROFILE[a];
}

/** Map the free-form `UserProfile.genderPresentation` to a query gender scope. */
export function genderScopeFromPresentation(
  presentation: string | null | undefined,
): GenderScope {
  if (!presentation) return "unknown";
  const t = presentation.trim().toLowerCase();
  if (/\b(masculine|male|man|men|boy)\b/.test(t)) return "mens";
  if (/\b(feminine|female|woman|women|girl)\b/.test(t)) return "womens";
  if (/\b(androgynous|nonbinary|non-binary|unisex|neutral)\b/.test(t))
    return "unisex";
  return "unknown";
}

/** Map an archetype to the legacy shopping mode (display limits + back-compat). */
export function archetypeToShoppingMode(a: Archetype): ShoppingMode {
  switch (a) {
    case "specific":
      return "judge";
    case "broad":
      return "copilot";
    case "gift_directed":
      return "directional";
    case "gift_vague":
      return "copilot";
  }
}

export function shoppingModeToArchetype(m: ShoppingMode): Archetype {
  switch (m) {
    case "judge":
      return "specific";
    case "copilot":
      return "broad";
    case "directional":
      return "gift_directed";
    case "hybrid":
      return "broad";
  }
  return "broad";
}

/** Classify the buyer's budget phrasing into hard / soft / none. */
export function classifyBudgetType(query: string): BudgetType {
  const t = query.toLowerCase();
  if (
    /\bstrictly\b|\bhard\s+(?:budget|limit|cap)\b|\bno\s+more\s+than\b|\bmust\s+be\s+under\b|\bunder\s+\$?\d/.test(
      t,
    )
  ) {
    return "hard";
  }
  if (
    /\baround\b|\babout\b|\broughly\b|\bish\b|\bsoft\b|\bnear\b|\bnearly\b/.test(
      t,
    )
  ) {
    return "soft";
  }
  return "none";
}

export type BriefBuildContext = {
  /** Buyer profile gender (UserProfile.genderPresentation), if known. */
  buyerGenderScope?: GenderScope;
  /** Pre-filled variant constraints from memory (stored sizes). */
  memoryVariantConstraints?: VariantConstraints;
  /** Profile fields for occasion disambiguation. */
  profile?: OccasionProfile;
  /** True when recipient interests are known in memory. */
  hasRecipientFacts?: boolean;
  /** Soft anchor the user gave for a gift (occasion/interest hint). */
  hasGiftAnchor?: boolean;
  previousArchetype?: Archetype | null;
  defaultCurrency?: string;
};

/** Raw structured fields the chat model may emit alongside `query`. */
export type SearchBriefToolFields = {
  archetype?: Archetype;
  category?: string;
  use_case?: string;
  must_haves?: string[];
  nice_to_haves?: string[];
  budget_type?: BudgetType;
  budget_amount_cents?: number;
  variant_constraints?: VariantConstraints;
  gender_scope?: GenderScope;
  recipient?: {
    kind: "self" | "other";
    label?: string;
    known_interests?: string[];
  };
  ranking_profile?: RankingProfile;
  condition?: string[];
  similar_to_product_ids?: string[];
  direction_label?: string;
};

function mergeVariantConstraints(
  fromModel: VariantConstraints | undefined,
  fromMemory: VariantConstraints | undefined,
): VariantConstraints {
  const out: VariantConstraints = {
    ...(fromMemory ?? {}),
    ...(fromModel ?? {}),
  };
  const other = { ...(fromMemory?.other ?? {}), ...(fromModel?.other ?? {}) };
  if (Object.keys(other).length) out.other = other;
  return out;
}

/**
 * Assemble a complete `SearchBrief` from the (optional) model-emitted fields,
 * the seed query, price filters, and buyer/memory context.
 */
export function buildSearchBrief(params: {
  query: string;
  fields?: SearchBriefToolFields;
  priceMinCents?: number;
  priceMaxCents?: number;
  ctx?: BriefBuildContext;
}): SearchBrief {
  const { query, fields, ctx } = params;

  // A model-supplied recipient with known interests is itself a usable gift
  // direction, so it counts as a recipient fact for classification.
  const recipientHasInterests = Boolean(
    fields?.recipient?.known_interests?.length,
  );
  const archetype =
    fields?.archetype ??
    classifyArchetype({
      query,
      hasRecipientFacts: ctx?.hasRecipientFacts || recipientHasInterests,
      hasGiftAnchor: ctx?.hasGiftAnchor,
      previousArchetype: ctx?.previousArchetype ?? null,
    }).archetype;

  const rankingProfile =
    fields?.ranking_profile ?? rankingProfileForArchetype(archetype);

  // Budget: prefer an explicit model budget_type; otherwise classify from text.
  // Ceiling comes from price_max filter or budget_amount_cents; floor from price_min.
  const maxCents = params.priceMaxCents ?? fields?.budget_amount_cents ?? null;
  const minCents = params.priceMinCents ?? null;
  let budgetType: BudgetType = fields?.budget_type ?? classifyBudgetType(query);
  if (maxCents == null && !fields?.budget_type) budgetType = "none";
  const budget: SearchBriefBudget = {
    amountCents: maxCents,
    minCents,
    maxCents,
    type: budgetType,
    currency: ctx?.defaultCurrency ?? "USD",
  };

  // Recipient: a gift archetype implies "other" unless the model says self.
  const recipientKind =
    fields?.recipient?.kind ??
    (archetype === "gift_directed" || archetype === "gift_vague"
      ? "other"
      : "self");

  // Gender scope: the model can set it, else use the buyer profile — but only
  // for self requests. Gifts to others must never inherit the buyer's gender.
  const genderScope: GenderScope =
    recipientKind === "other"
      ? (fields?.gender_scope ?? "unknown")
      : (fields?.gender_scope ?? ctx?.buyerGenderScope ?? "unknown");

  const modelMust = fields?.must_haves ?? [];
  const modelNice = fields?.nice_to_haves ?? [];
  const provenance: BriefProvenance = {
    query: "user_stated",
    category: fields?.category ? "user_stated" : undefined,
    useCase: fields?.use_case ? "user_stated" : undefined,
    mustHaves: tagListProvenance(modelMust, "user_stated"),
    niceToHaves: tagListProvenance(modelNice, "user_stated"),
    genderScope: fields?.gender_scope
      ? "user_stated"
      : ctx?.buyerGenderScope
        ? "profile_default"
        : undefined,
    variantConstraints: {},
  };
  if (fields?.variant_constraints?.size) {
    provenance.variantConstraints!.size = "user_stated";
  } else if (ctx?.memoryVariantConstraints?.size) {
    provenance.variantConstraints!.size = "profile_default";
  }
  if (fields?.variant_constraints?.color) {
    provenance.variantConstraints!.color = "user_stated";
  }

  return applyProvenanceToBrief(
    {
      archetype,
      query: query.trim(),
      category: fields?.category,
      useCase: fields?.use_case,
      mustHaves: modelMust,
      niceToHaves: modelNice,
      budget,
      variantConstraints: mergeVariantConstraints(
        fields?.variant_constraints,
        recipientKind === "self" ? ctx?.memoryVariantConstraints : undefined,
      ),
      genderScope,
      recipient: {
        kind: recipientKind,
        label: fields?.recipient?.label,
        knownInterests: fields?.recipient?.known_interests,
      },
      rankingProfile,
      condition: fields?.condition ?? ["new"],
      similarToProductIds: fields?.similar_to_product_ids,
      directionLabel: fields?.direction_label,
    },
    provenance,
  );
}
