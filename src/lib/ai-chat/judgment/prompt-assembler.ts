import {
  detectContextExpertise,
  getContextExpertiseByTag,
  type ContextExpertise,
} from "../shopping-mode/context-expertise";
import type { SearchBrief } from "../search/types";
import { formatExpertiseCorpus } from "./expertise-corpus";
import {
  TIER_JUDGE_COMPARATIVE_METHOD,
  TIER_JUDGE_EXPERTISE_ELICITATION,
  TIER_JUDGE_LISTING_LITERACY,
  TIER_JUDGE_OUTPUT_RULES,
  TIER_JUDGE_SELF_VERIFICATION,
  TIER_JUDGE_TRIAGE_OUTPUT_RULES,
  TIER_RUBRIC,
} from "./rubric";

export type JudgmentPromptSlots = {
  specialistFrame: string;
  clientPicture: string;
  retrievedExpertise: string;
  candidatesBlock: string;
  rubric: string;
};

/** Strip leading emoji/icons from gift direction chip labels. */
export function cleanDirectionLabel(label: string): string {
  return (
    label
      .replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]+/u, "")
      .trim() || label.trim()
  );
}

function directionLanePrinciples(lane: string): string {
  return `Principles for the "${lane}" gift direction:
- Every tier-1 pick must clearly belong in this lane — reject strong catalog matches from other gift themes.
- Vary product subtypes within the lane; do not mix unrelated categories.
- Gift fit: would the recipient recognize this as a thoughtful pick for this direction?`;
}

/** Composed per request — framing only, not substitute for retrieved expertise. */
export function composeSpecialistFrame(brief: SearchBrief): string {
  const must = brief.mustHaves.filter(Boolean).slice(0, 4).join(", ");
  const direction = brief.directionLabel?.trim();

  if (direction && brief.archetype === "gift_directed") {
    const lane = cleanDirectionLabel(direction);
    const who =
      brief.recipient.name?.trim() ||
      brief.recipient.label?.trim() ||
      "the recipient";
    const interests = brief.recipient.knownInterests?.slice(0, 3).join(", ");
    const expert = `a ${lane} specialist curating gifts for ${who}${interests ? ` (${interests})` : ""}`;
    return `You are ${expert}. You judge as an expert in ${lane} — not a general gift shopper.${must ? ` Non-negotiables from the brief: ${must}.` : ""} You judge with gift curation sensibility: each pick must clearly belong in this direction lane.`;
  }

  const query = brief.query.trim();
  const category = brief.category?.trim();
  const useCase = brief.useCase?.trim();

  let sensibility = "practical taste and honest tradeoffs";
  if (brief.rankingProfile === "value_first") {
    sensibility = "value-first judgment — quality per dollar, never cheapest-for-cheapest";
  } else if (brief.rankingProfile === "gift_diversity") {
    sensibility = "gift curation — distinct directions, each defensible on its own merits";
  } else if (brief.archetype === "specific") {
    sensibility = "precision — only clear fits earn top placement";
  } else if (brief.archetype === "broad") {
    sensibility = "editorial range — surface distinct viable directions";
  }

  const domain = category || query.split(/\s+/).slice(-2).join(" ") || "this category";
  const specialist = `a knowledgeable ${domain} buyer who specializes in ${useCase || query}`;

  return `You are ${specialist}. You judge with ${sensibility}.${must ? ` Non-negotiables from the brief: ${must}.` : ""}`;
}

export function composeClientPicture(
  brief: SearchBrief,
  memoryXml?: string,
): string {
  const parts: string[] = [];
  if (brief.recipient.kind === "other") {
    const who =
      brief.recipient.name?.trim() ||
      brief.recipient.label?.trim() ||
      "someone else";
    const interests = brief.recipient.knownInterests?.slice(0, 4).join(", ");
    parts.push(
      `Your client is shopping for ${who}${interests ? ` (${interests})` : ""}.`,
    );
  } else {
    parts.push("Your client is shopping for themselves.");
  }
  const direction = brief.directionLabel?.trim();
  if (direction && brief.archetype === "gift_directed") {
    const lane = cleanDirectionLabel(direction);
    if (brief.useCase?.trim()) {
      parts.push(`Occasion: ${brief.useCase.trim()}.`);
    }
    parts.push(`They chose to explore this gift direction: ${lane}.`);
    parts.push(`Catalog seed query: ${brief.query.trim()}.`);
    parts.push(
      `Judge and search only within this lane — you are the expert for ${lane}.`,
    );
  } else {
    parts.push(`They asked for: ${brief.query.trim()}.`);
    if (brief.useCase?.trim()) {
      parts.push(`Occasion: ${brief.useCase.trim()}.`);
    }
    if (brief.provenance?.occasionResolution) {
      parts.push(`Occasion resolution: ${brief.provenance.occasionResolution}`);
    }
    if (direction) {
      parts.push(`Chosen direction: ${direction}.`);
    }
  }
  if (memoryXml?.trim()) {
    parts.push(`Profile context (use for fit, never invent beyond this):\n${memoryXml.trim()}`);
  }
  return parts.join("\n");
}

function formatExpertiseEntry(ctx: ContextExpertise): string {
  return `Principles for ${ctx.label}:\n${ctx.brief.trim()}`;
}

/** Static + corpus expertise — precedents keyed to category/query. */
export function getRetrievedExpertise(contextTag?: string | null, query?: string): string {
  const ctx =
    getContextExpertiseByTag(contextTag) ??
    (query ? detectContextExpertise(query) : null);
  const extra = ctx ? [ctx.brief.trim()] : undefined;
  return formatExpertiseCorpus(query ?? "", undefined, extra);
}

/** Expertise keyed to gift direction lane when present, else query/context tag. */
export function getRetrievedExpertiseForBrief(
  brief: SearchBrief,
  contextTag?: string | null,
): string {
  const direction = brief.directionLabel?.trim();
  if (direction && brief.archetype === "gift_directed") {
    const lane = cleanDirectionLabel(direction);
    const ctx =
      detectContextExpertise(lane) ??
      detectContextExpertise(brief.query) ??
      null;
    const extra = [
      ctx ? formatExpertiseEntry(ctx) : directionLanePrinciples(lane),
    ];
    return formatExpertiseCorpus(brief.query, brief.category, extra);
  }
  const ctx =
    getContextExpertiseByTag(contextTag) ??
    detectContextExpertise(brief.query);
  const extra = ctx ? [formatExpertiseEntry(ctx)] : undefined;
  return formatExpertiseCorpus(brief.query, brief.category, extra);
}

export function assembleJudgmentPrompt(slots: JudgmentPromptSlots): string {
  return [
    "[SPECIALIST FRAME]",
    slots.specialistFrame,
    "",
    "[CLIENT PICTURE]",
    slots.clientPicture,
    "",
    "[RETRIEVED EXPERTISE]",
    slots.retrievedExpertise,
    "",
    "[CANDIDATES]",
    slots.candidatesBlock,
    "",
    "[BUYING RULES FIRST]",
    TIER_JUDGE_EXPERTISE_ELICITATION,
    "",
    "[LISTING LITERACY]",
    TIER_JUDGE_LISTING_LITERACY,
    "",
    "[TIER RUBRIC]",
    slots.rubric,
    "",
    TIER_JUDGE_OUTPUT_RULES,
  ].join("\n");
}

export function buildTierJudgeTriageSystemPrompt(): string {
  return `You are Shoop's product judge — phase 1: WIDE TRIAGE only.

${TIER_JUDGE_EXPERTISE_ELICITATION}

${TIER_JUDGE_COMPARATIVE_METHOD}

${TIER_JUDGE_LISTING_LITERACY}

Do NOT assign final tiers. Call emit_triage_verdicts with buying_rules, listing_assessments, then triage (advance|drop) for every candidate. Use ONLY product_id values from the candidate list.`;
}

export function buildTierJudgeSystemPrompt(): string {
  return `You are Shoop's product judge — phase 2: DEEP COMPARE among finalists.

Each finalist includes a product photo when available. Use what you SEE — silhouette, structure, lapels, shoulder, fabric drape, hardware, and perceived quality/cheapness — together with the text attributes. Photos override vague marketing copy when they conflict.

${TIER_JUDGE_COMPARATIVE_METHOD}

${TIER_JUDGE_SELF_VERIFICATION}

${TIER_JUDGE_LISTING_LITERACY}

${TIER_RUBRIC}

Call emit_tier_placements with head_to_head, checks (every tier-1 pick), listing_assessments, placements, then omissions (every finalist NOT placed — cite head_to_head loser or misfit). Use ONLY product_id values from the finalist list.`;
}

export function buildTierJudgeCompareUserPrompt(params: {
  brief: SearchBrief;
  candidatesBlock: string;
  buyingRules: string[];
  memoryXml?: string;
  contextTag?: string | null;
}): string {
  const rulesBlock = params.buyingRules.map((r, i) => `${i + 1}. ${r}`).join("\n");
  return [
    "[SPECIALIST FRAME]",
    composeSpecialistFrame(params.brief),
    "",
    "[CLIENT PICTURE]",
    composeClientPicture(params.brief, params.memoryXml),
    "",
    "[RETRIEVED EXPERTISE]",
    getRetrievedExpertiseForBrief(params.brief, params.contextTag),
    "",
    "[BUYING RULES FROM TRIAGE]",
    rulesBlock,
    "",
    "[FINALISTS — compare these head-to-head before tiering]",
    params.candidatesBlock,
  ].join("\n");
}

export function buildTierJudgeUserPrompt(params: {
  brief: SearchBrief;
  candidatesBlock: string;
  memoryXml?: string;
  contextTag?: string | null;
}): string {
  // Rubric + output rules live in the system prompt only — keeps the user turn lean.
  return [
    "[SPECIALIST FRAME]",
    composeSpecialistFrame(params.brief),
    "",
    "[CLIENT PICTURE]",
    composeClientPicture(params.brief, params.memoryXml),
    "",
    "[RETRIEVED EXPERTISE]",
    getRetrievedExpertiseForBrief(params.brief, params.contextTag),
    "",
    "[CANDIDATES]",
    params.candidatesBlock,
  ].join("\n");
}

export { TIER_RUBRIC };
