import type { ContentBlockParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages/messages";
import { getAnthropicClient } from "../anthropic";
import {
  AI_CHAT_TIER_JUDGE_ESCALATION_MODEL,
  AI_CHAT_TIER_JUDGE_MODEL,
  AI_CHAT_TIER_JUDGE_TIMEOUT_MS,
  TIER_JUDGE_CANDIDATE_LIMIT,
  TIER_JUDGE_FINALIST_LIMIT,
} from "../constants";
import { parseLlmJsonObject, stripNullFields } from "../shopping-memory/llm-json";
import { logAiChat } from "../observability";
import type { ListingHygieneFlag, ListingQuality } from "../search/listing-hygiene";
import type { BrandTier } from "../search/brand-anchors";
import type { SearchBrief } from "../search/types";
import type { VerifiedCandidate } from "../search/verify";
import { extractCatalogAttributes } from "@/lib/shopify/catalog-attributes";
import {
  formatFinalistsForCompare,
  formatVerifiedCandidatesForTriage,
} from "./attributes-prompt";
import {
  type FinalistImageEntry,
  type FinalistImagePrefetch,
  type JudgeImage,
} from "./finalist-images";
import {
  buildTierJudgeCompareUserPrompt,
  buildTierJudgeSystemPrompt,
  buildTierJudgeTriageSystemPrompt,
  buildTierJudgeUserPrompt,
} from "./prompt-assembler";
import { clampTierConfidenceFromRating } from "./rating-confidence";
import { LISTING_ASSESSMENT_SCHEMA } from "./rubric";
import {
  enforceTierOneSelfChecks,
  parseTierOneSelfChecks,
  type SelfCheckDrop,
  type TierOneSelfCheck,
} from "./tier-one-self-check";

export type ListingAssessment = {
  productId: string;
  listingQuality: ListingQuality;
  flags: ListingHygieneFlag[];
  brandTier: BrandTier;
};

export type TierConfidence = "strong" | "moderate" | "limited";

export type TriageVerdict = {
  productId: string;
  verdict: "advance" | "drop";
  note: string;
};

export type HeadToHeadComparison = {
  productIds: string[];
  winnerId: string;
  tradeoff: string;
};

export type TierPlacement = {
  productId: string;
  tier: 1 | 2 | 3;
  reason: string;
  confidence: TierConfidence;
  /** Passed tier-1 self-verification — feeds UI checkedItems. */
  selfCheck?: TierOneSelfCheck;
};

export type TierJudgeOmission = {
  productId: string;
  title: string;
  reason: string;
};

export type TierJudgeResult = {
  placements: TierPlacement[];
  omissions: TierJudgeOmission[];
  /** Master stylist/buyer rules elicited before sorting. */
  buyingRules?: string[];
  /** Head-to-head comparisons among finalists (phase 2). */
  headToHeadComparisons?: HeadToHeadComparison[];
  /** Phase-1 advance/drop verdicts for the wide pool. */
  triageVerdicts?: TriageVerdict[];
  /** Per-candidate listing literacy from judge tool output. */
  listingAssessments?: ListingAssessment[];
  /** How many candidates had inferred attributes in the prompt. */
  candidatesWithAttributes: number;
  fallback: boolean;
  promptText?: string;
  resultText?: string;
  model?: string;
};

export const TIER_JUDGE_TOOL_NAME = "emit_tier_placements";
export const TIER_TRIAGE_TOOL_NAME = "emit_triage_verdicts";

const TIER_JUDGE_ATTEMPTS = 3;
const TRIAGE_TIMEOUT_RATIO = 0.42;

const triageTool: Tool = {
  name: TIER_TRIAGE_TOOL_NAME,
  description:
    "Phase 1 wide triage: buying rules plus advance/drop for every candidate. No final tiers.",
  input_schema: {
    type: "object",
    properties: {
      buying_rules: {
        type: "array",
        minItems: 4,
        maxItems: 5,
        items: { type: "string" },
      },
      listing_assessments: {
        type: "array",
        maxItems: 25,
        items: LISTING_ASSESSMENT_SCHEMA,
      },
      triage: {
        type: "array",
        maxItems: 25,
        items: {
          type: "object",
          properties: {
            product_id: { type: "string" },
            verdict: { type: "string", enum: ["advance", "drop"] },
            note: { type: "string" },
          },
          required: ["product_id", "verdict", "note"],
        },
      },
    },
    required: ["buying_rules", "listing_assessments", "triage"],
  },
};

const selfCheckDimensionSchema = {
  type: "object",
  properties: {
    required: {
      type: "string",
      description: "Brief requirement or 'none' if not applicable.",
    },
    actual: {
      type: "string",
      description: "What variant/title/options actually show — cite evidence.",
    },
    pass: { type: "boolean" },
    note: {
      type: "string",
      description: "One sentence explicit verification for this dimension.",
    },
  },
  required: ["required", "actual", "pass", "note"],
} as const;

const tierJudgeTool: Tool = {
  name: TIER_JUDGE_TOOL_NAME,
  description:
    "Phase 2 deep compare: head-to-head, tier-1 self-checks, then placements.",
  input_schema: {
    type: "object",
    properties: {
      head_to_head: {
        type: "array",
        minItems: 2,
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            product_ids: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: { type: "string" },
            },
            winner_id: { type: "string" },
            tradeoff: {
              type: "string",
              description:
                "A vs B for this client: pick one, name the tradeoff (forced comparison).",
            },
          },
          required: ["product_ids", "winner_id", "tradeoff"],
        },
      },
      checks: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            product_id: {
              type: "string",
              description: "Must match a tier-1 product_id in placements.",
            },
            color: selfCheckDimensionSchema,
            gender: selfCheckDimensionSchema,
            size_in_stock: selfCheckDimensionSchema,
          },
          required: ["product_id", "color", "gender", "size_in_stock"],
        },
        description:
          "Required self-verification for EVERY tier-1 placement before emit. Use variant/options data.",
      },
      listing_assessments: {
        type: "array",
        maxItems: 12,
        items: LISTING_ASSESSMENT_SCHEMA,
      },
      placements: {
        type: "array",
        maxItems: 25,
        items: {
          type: "object",
          properties: {
            product_id: {
              type: "string",
              description: "Must match an id= line from [CANDIDATES]",
            },
            tier: {
              type: "integer",
              enum: [1, 2, 3],
              description: "1 = clear fit, 2 = worth considering, 3 = other direction",
            },
            reason: {
              type: "string",
              description:
                "Comparison won/lost vs a named alternative plus product features. Tier 1 must cite head_to_head.",
            },
            confidence: {
              type: "string",
              enum: ["strong", "moderate", "limited"],
            },
          },
          required: ["product_id", "tier", "reason", "confidence"],
        },
      },
      omissions: {
        type: "array",
        maxItems: 25,
        items: {
          type: "object",
          properties: {
            product_id: {
              type: "string",
              description:
                "Finalist id= line for every candidate NOT in placements.",
            },
            reason: {
              type: "string",
              description:
                "One honest sentence: why it lost head-to-head or missed every tier for this client.",
            },
          },
          required: ["product_id", "reason"],
        },
        description:
          "Required: one row per finalist missing from placements — cite the comparison lost or misfit.",
      },
    },
    required: [
      "head_to_head",
      "checks",
      "listing_assessments",
      "placements",
      "omissions",
    ],
  },
};

function countCandidatesWithAttributes(verified: VerifiedCandidate[]): number {
  return verified.filter((v) => extractCatalogAttributes(v.detail).length > 0)
    .length;
}

function normalizeTier(raw: unknown): 1 | 2 | 3 | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw.trim(), 10)
        : NaN;
  if (n === 1 || n === 2 || n === 3) return n;
  return null;
}

function normalizeConfidence(raw: unknown): TierConfidence {
  const s = String(raw ?? "moderate").trim().toLowerCase();
  if (s === "strong" || s === "moderate" || s === "limited") return s;
  return "moderate";
}

function normalizeReason(raw: unknown): string | null {
  const reason = String(raw ?? "").trim();
  if (!reason) return null;
  return reason.slice(0, 220);
}

function extractPlacementRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  if (Array.isArray(root.placements)) return root.placements;
  return [];
}

export function parseBuyingRules(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>).buying_rules;
  if (!Array.isArray(raw)) return undefined;
  const rules = raw
    .map((rule) => String(rule ?? "").trim())
    .filter(Boolean)
    .slice(0, 5);
  return rules.length ? rules : undefined;
}

export function parseTriageVerdicts(
  value: unknown,
  validIds: Set<string>,
): TriageVerdict[] {
  if (!value || typeof value !== "object") return [];
  const o = value as Record<string, unknown>;
  const raw =
    (Array.isArray(o.triage) && o.triage) ||
    (Array.isArray(o.triage_verdicts) && o.triage_verdicts) ||
    (Array.isArray(o.verdicts) && o.verdicts) ||
    (Array.isArray(o.candidates) && o.candidates) ||
    null;
  if (!raw) return [];
  const out: TriageVerdict[] = [];
  const seen = new Set<string>();

  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const canonicalId = resolveCanonicalProductId(
      String(r.product_id ?? r.productId ?? r.id ?? ""),
      validIds,
    );
    if (!canonicalId || seen.has(canonicalId)) continue;
    const verdictRaw = String(r.verdict ?? r.decision ?? "").trim().toLowerCase();
    const advance =
      verdictRaw === "advance" ||
      verdictRaw === "keep" ||
      verdictRaw === "pass";
    const drop =
      verdictRaw === "drop" ||
      verdictRaw === "reject" ||
      verdictRaw === "fail";
    if (!advance && !drop) continue;
    const note = String(r.note ?? r.reason ?? r.rationale ?? "").trim().slice(0, 160);
    if (!note) continue;
    seen.add(canonicalId);
    out.push({
      productId: canonicalId,
      verdict: advance ? "advance" : "drop",
      note,
    });
  }

  return out;
}

/** When the model emits buying rules but omits per-candidate triage, advance the pre-gated pool. */
export function synthesizeTriageVerdicts(
  verified: VerifiedCandidate[],
): TriageVerdict[] {
  return verified.map((vc) => ({
    productId: vc.detail.id,
    verdict: "advance" as const,
    note: "Pre-filtered candidate — triage verdict synthesized after model omitted triage array",
  }));
}

const VALID_LISTING_FLAGS = new Set<ListingHygieneFlag>([
  "single_size_clearance",
  "sku_title",
  "thin_reviews",
  "dropship_tell",
  "price_anomaly",
  "single_variant",
]);

function normalizeListingQuality(raw: unknown): ListingQuality | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "clean" || s === "suspect" || s === "junk") return s;
  return null;
}

function normalizeBrandTier(raw: unknown): BrandTier | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "anchor" || s === "known" || s === "unknown") return s;
  return null;
}

export function parseListingAssessments(
  value: unknown,
  validIds: Set<string>,
): ListingAssessment[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as Record<string, unknown>).listing_assessments;
  if (!Array.isArray(raw)) return [];
  const out: ListingAssessment[] = [];
  const seen = new Set<string>();

  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const canonicalId = resolveCanonicalProductId(
      String(r.product_id ?? r.productId ?? ""),
      validIds,
    );
    if (!canonicalId || seen.has(canonicalId)) continue;
    const listingQuality = normalizeListingQuality(r.listing_quality ?? r.listingQuality);
    const brandTier = normalizeBrandTier(r.brand_tier ?? r.brandTier);
    if (!listingQuality || !brandTier) continue;
    const flagsRaw = r.flags;
    const flags = Array.isArray(flagsRaw)
      ? flagsRaw
          .map((f) => String(f ?? "").trim() as ListingHygieneFlag)
          .filter((f) => VALID_LISTING_FLAGS.has(f))
      : [];
    seen.add(canonicalId);
    out.push({ productId: canonicalId, listingQuality, flags, brandTier });
  }

  return out;
}

export function synthesizeListingAssessments(
  verified: VerifiedCandidate[],
): ListingAssessment[] {
  return verified.map((v) => {
    if (v.listingHygiene) {
      return {
        productId: v.detail.id,
        listingQuality: v.listingHygiene.quality,
        flags: v.listingHygiene.flags,
        brandTier: v.listingHygiene.brandTier,
      };
    }
    return {
      productId: v.detail.id,
      listingQuality: "clean",
      flags: [],
      brandTier: "unknown",
    };
  });
}

/** Demote tier-1 placements on junk/suspect+severe listing flags. */
export function enforceListingQualityOnPlacements(
  placements: TierPlacement[],
  assessments: ListingAssessment[],
): { placements: TierPlacement[]; drops: TierJudgeOmission[] } {
  const byId = new Map(assessments.map((a) => [a.productId, a]));
  const severe = new Set<ListingHygieneFlag>([
    "sku_title",
    "single_size_clearance",
    "dropship_tell",
    "price_anomaly",
  ]);
  const drops: TierJudgeOmission[] = [];
  const out = placements.map((p) => {
    const a = byId.get(p.productId);
    if (!a || p.tier !== 1) return p;
    const bad =
      a.listingQuality === "junk" ||
      (a.listingQuality === "suspect" && a.flags.some((f) => severe.has(f)));
    if (!bad) return p;
    drops.push({
      productId: p.productId,
      title: "",
      reason: `Listing quality ${a.listingQuality} (${a.flags.join(", ") || "flags"}) — not tier 1`,
    });
    return {
      ...p,
      tier: 2 as const,
      reason: `${p.reason} — downgraded: ${a.listingQuality} listing`,
      confidence: "limited" as const,
    };
  });
  return { placements: out, drops };
}

export function parseHeadToHeadComparisons(
  value: unknown,
  validIds: Set<string>,
): HeadToHeadComparison[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as Record<string, unknown>).head_to_head;
  if (!Array.isArray(raw)) return [];
  const out: HeadToHeadComparison[] = [];

  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const idsRaw = r.product_ids ?? r.productIds;
    if (!Array.isArray(idsRaw)) continue;
    const productIds = idsRaw
      .map((id) => resolveCanonicalProductId(String(id ?? ""), validIds))
      .filter((id): id is string => Boolean(id));
    if (productIds.length < 2) continue;
    const winnerId = resolveCanonicalProductId(
      String(r.winner_id ?? r.winnerId ?? ""),
      validIds,
    );
    if (!winnerId || !productIds.includes(winnerId)) continue;
    const tradeoff = String(r.tradeoff ?? "").trim().slice(0, 280);
    if (!tradeoff) continue;
    out.push({ productIds, winnerId, tradeoff });
  }

  return out;
}

/** Pick deep-compare finalists from triage; pad from score order if too few advances. */
export function selectFinalistsForCompare(
  verified: VerifiedCandidate[],
  triage: TriageVerdict[],
  limit = TIER_JUDGE_FINALIST_LIMIT,
): VerifiedCandidate[] {
  const byId = new Map(verified.map((v) => [v.detail.id, v]));
  const advances = triage
    .filter((t) => t.verdict === "advance")
    .map((t) => byId.get(t.productId))
    .filter((v): v is VerifiedCandidate => Boolean(v));

  const picked: VerifiedCandidate[] = [];
  const seen = new Set<string>();
  for (const vc of advances) {
    if (picked.length >= limit) break;
    if (seen.has(vc.detail.id)) continue;
    seen.add(vc.detail.id);
    picked.push(vc);
  }

  const minFinalists = Math.min(4, verified.length);
  if (picked.length < minFinalists) {
    for (const vc of verified) {
      if (picked.length >= Math.min(limit, minFinalists)) break;
      if (seen.has(vc.detail.id)) continue;
      seen.add(vc.detail.id);
      picked.push(vc);
    }
  }

  return picked.slice(0, limit);
}

function resolveCanonicalProductId(
  rawId: string,
  validIds: Set<string>,
): string | null {
  const trimmed = rawId.trim();
  if (!trimmed) return null;
  if (validIds.has(trimmed)) return trimmed;

  for (const id of validIds) {
    if (id.endsWith(trimmed) || trimmed.endsWith(id)) return id;
  }

  const numeric = trimmed.match(/(\d+)\s*$/)?.[1];
  if (numeric) {
    for (const id of validIds) {
      if (id.endsWith(`/${numeric}`) || id.endsWith(numeric)) return id;
    }
  }

  return null;
}

/** Lenient parse — keep valid rows even when the model omits fields or uses string tiers. */
export function parseTierJudgePlacementRows(
  value: unknown,
  validIds: Set<string>,
): TierPlacement[] {
  const rows = extractPlacementRows(stripNullFields(value));
  const out: TierPlacement[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const canonicalId = resolveCanonicalProductId(
      String(r.product_id ?? r.productId ?? ""),
      validIds,
    );
    if (!canonicalId || seen.has(canonicalId)) continue;

    const tier = normalizeTier(r.tier);
    const reason = normalizeReason(r.reason);
    if (tier == null || !reason) continue;

    seen.add(canonicalId);
    out.push({
      productId: canonicalId,
      tier,
      reason,
      confidence: normalizeConfidence(r.confidence),
    });
  }

  return out;
}

function enrichPlacementsWithRatingConfidence(
  placements: TierPlacement[],
  verified: VerifiedCandidate[],
): TierPlacement[] {
  const byId = new Map(verified.map((v) => [v.detail.id, v]));
  return placements.map((p) => {
    const vc = byId.get(p.productId);
    if (!vc) return p;
    return {
      ...p,
      confidence: clampTierConfidenceFromRating(vc.detail, p.confidence),
    };
  });
}

export type JudgeOmissionRow = {
  productId: string;
  reason: string;
};

function extractOmissionRows(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  if (Array.isArray(root.omissions)) return root.omissions;
  return [];
}

/** Parse explicit omission reasons from tier-judge tool output. */
export function parseJudgeOmissions(
  value: unknown,
  validIds: Set<string>,
): JudgeOmissionRow[] {
  const rows = extractOmissionRows(stripNullFields(value));
  const out: JudgeOmissionRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const canonicalId = resolveCanonicalProductId(
      String(r.product_id ?? r.productId ?? ""),
      validIds,
    );
    if (!canonicalId || seen.has(canonicalId)) continue;

    const reason = normalizeReason(r.reason);
    if (!reason) continue;

    seen.add(canonicalId);
    out.push({ productId: canonicalId, reason });
  }

  return out;
}

/** Map head-to-head losers to the comparison tradeoff that eliminated them. */
export function headToHeadLoserReasons(
  comparisons: HeadToHeadComparison[],
): Map<string, string> {
  const byLoser = new Map<string, string>();
  for (const comparison of comparisons) {
    for (const productId of comparison.productIds) {
      if (productId === comparison.winnerId || byLoser.has(productId)) continue;
      byLoser.set(productId, comparison.tradeoff);
    }
  }
  return byLoser;
}

export function resolveJudgeOmissions(
  candidates: VerifiedCandidate[],
  placements: TierPlacement[],
  options?: {
    triage?: TriageVerdict[];
    llmOmissions?: JudgeOmissionRow[];
    headToHead?: HeadToHeadComparison[];
    finalistIds?: Set<string>;
  },
): TierJudgeOmission[] {
  const placed = new Set(placements.map((p) => p.productId));
  const triageById = new Map(options?.triage?.map((t) => [t.productId, t]) ?? []);
  const llmById = new Map(
    options?.llmOmissions?.map((o) => [o.productId, o.reason]) ?? [],
  );
  const h2hByLoser = headToHeadLoserReasons(options?.headToHead ?? []);
  const finalistIds = options?.finalistIds;

  return candidates
    .filter((c) => !placed.has(c.detail.id))
    .map((c) => {
      const productId = c.detail.id;
      const title = c.detail.title ?? "";
      const triageVerdict = triageById.get(productId);
      if (triageVerdict?.verdict === "drop") {
        return {
          productId,
          title,
          reason: triageVerdict.note || "Dropped in wide triage",
        };
      }

      const llmReason = llmById.get(productId);
      if (llmReason) {
        return { productId, title, reason: llmReason };
      }

      const h2hReason = h2hByLoser.get(productId);
      if (h2hReason) {
        return {
          productId,
          title,
          reason: `Lost head-to-head: ${h2hReason}`,
        };
      }

      if (finalistIds && !finalistIds.has(productId)) {
        const triageNote = triageVerdict?.note?.trim();
        return {
          productId,
          title,
          reason: triageNote
            ? `Not selected for deep compare — ${triageNote}`
            : "Not selected for head-to-head compare (below finalist cut)",
        };
      }

      return {
        productId,
        title,
        reason: "Dropped by tier judge — did not fit well enough for any tier",
      };
    });
}

/** Parse raw model text (legacy JSON-in-text path). */
export function parseTierJudgePlacements(
  raw: string,
  validIds: Set<string>,
): TierPlacement[] {
  const parsed = parseLlmJsonObject(raw);
  if (!parsed?.value) return [];
  return parseTierJudgePlacementRows(parsed.value, validIds);
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function attemptTimeoutMs(base: number, attempt: number): number {
  const step = Math.min(20_000, Math.round(base * 0.25));
  return Math.min(base + step * attempt, 120_000);
}

function modelForAttempt(attempt: number): string {
  if (attempt >= TIER_JUDGE_ATTEMPTS - 1) {
    return AI_CHAT_TIER_JUDGE_ESCALATION_MODEL;
  }
  return AI_CHAT_TIER_JUDGE_MODEL;
}

function triageTimeoutMs(base: number, attempt: number): number {
  return Math.min(
    Math.max(20_000, Math.round(base * TRIAGE_TIMEOUT_RATIO)),
    attemptTimeoutMs(base, attempt) - 8_000,
  );
}

async function callTierJudgeTriage(params: {
  brief: SearchBrief;
  verified: VerifiedCandidate[];
  memoryXml?: string;
  contextTag?: string | null;
  signal?: AbortSignal;
  timeoutMs: number;
  model: string;
  attempt: number;
}): Promise<
  | {
      ok: true;
      triage: TriageVerdict[];
      buyingRules: string[];
      listingAssessments: ListingAssessment[];
      userPrompt: string;
      system: string;
      model: string;
      resultText: string;
    }
  | { ok: false; reason: "timeout" | "error" | "empty_response" | "parse_failed"; error?: string }
> {
  const { brief, verified, timeoutMs, model, attempt } = params;
  const validIds = new Set(verified.map((v) => v.detail.id));
  const candidatesBlock = formatVerifiedCandidatesForTriage(verified);
  const userPrompt = buildTierJudgeUserPrompt({
    brief,
    candidatesBlock,
    memoryXml: params.memoryXml,
    contextTag: params.contextTag,
  });
  const system = buildTierJudgeTriageSystemPrompt();

  const anthropic = getAnthropicClient();
  const reqPromise = anthropic.messages.create(
    {
      model,
      max_tokens: 1536,
      system,
      tools: [triageTool],
      tool_choice: { type: "tool", name: TIER_TRIAGE_TOOL_NAME },
      messages: [{ role: "user", content: userPrompt }],
    },
    params.signal ? { signal: params.signal } : undefined,
  );

  let msg: Awaited<ReturnType<typeof anthropic.messages.create>>;
  try {
    msg = await withTimeout(reqPromise, timeoutMs, "tier_judge_triage");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const reason = /timed out after/i.test(errorMessage) ? "timeout" : "error";
    logAiChat("warn", reason === "timeout" ? "tier_judge_triage_timeout" : "tier_judge_triage_error", {
      query: brief.query.slice(0, 120),
      candidateCount: verified.length,
      timeoutMs,
      model,
      attempt: attempt + 1,
      error: errorMessage,
    });
    return { ok: false, reason, error: errorMessage };
  }

  const toolBlock = msg.content.find(
    (b): b is ToolUseBlock =>
      b.type === "tool_use" && b.name === TIER_TRIAGE_TOOL_NAME,
  );
  if (!toolBlock) {
    logAiChat("warn", "tier_judge_triage_empty_response", {
      query: brief.query.slice(0, 120),
      candidateCount: verified.length,
      model,
      attempt: attempt + 1,
    });
    return { ok: false, reason: "empty_response" };
  }

  const triageParsed = parseTriageVerdicts(toolBlock.input, validIds);
  const buyingRules = parseBuyingRules(toolBlock.input);
  let listingAssessments = parseListingAssessments(toolBlock.input, validIds);
  if (!listingAssessments.length) {
    listingAssessments = synthesizeListingAssessments(params.verified);
  }
  const resultText = JSON.stringify(toolBlock.input, null, 2);

  let triage = triageParsed;
  let triageSynthesized = false;
  if (
    !triage.length &&
    buyingRules?.length &&
    listingAssessments.length &&
    params.verified.length >= 2
  ) {
    triage = synthesizeTriageVerdicts(params.verified);
    triageSynthesized = true;
    logAiChat("warn", "tier_judge_triage_synthesized", {
      query: brief.query.slice(0, 120),
      candidateCount: verified.length,
      model,
      attempt: attempt + 1,
      synthesizedCount: triage.length,
    });
  }

  if (!triage.length || !buyingRules?.length || !listingAssessments.length) {
    logAiChat("warn", "tier_judge_triage_parse_failed", {
      query: brief.query.slice(0, 120),
      candidateCount: verified.length,
      model,
      attempt: attempt + 1,
      responsePreview: resultText.slice(0, 400),
      hadBuyingRules: Boolean(buyingRules?.length),
      triageParsedCount: triageParsed.length,
      listingAssessmentCount: listingAssessments.length,
    });
    return { ok: false, reason: "parse_failed" };
  }

  if (triageSynthesized) {
    logAiChat("info", "tier_judge_triage_recovered", {
      query: brief.query.slice(0, 120),
      candidateCount: verified.length,
      model,
      attempt: attempt + 1,
    });
  }

  return {
    ok: true,
    triage,
    buyingRules,
    listingAssessments,
    userPrompt,
    system,
    model: msg.model,
    resultText,
  };
}

function buildCompareUserContent(
  userPrompt: string,
  entries: FinalistImageEntry[],
  images: Map<string, JudgeImage>,
): ContentBlockParam[] | string {
  if (!images.size) return userPrompt;
  const blocks: ContentBlockParam[] = [{ type: "text", text: userPrompt }];
  blocks.push({
    type: "text",
    text:
      "\n[PRODUCT PHOTOS — match each photo to image_ref above. Judge structure, silhouette, material quality, and cheapness from what you see.]",
  });
  for (const { imageRef, productId } of entries) {
    const image = images.get(productId);
    if (!image) continue;
    blocks.push({
      type: "text",
      text: `Photo for ${imageRef} (id=${productId}):`,
    });
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.data,
      },
    });
  }
  return blocks;
}

async function callTierJudgeCompare(params: {
  brief: SearchBrief;
  finalists: VerifiedCandidate[];
  buyingRules: string[];
  memoryXml?: string;
  contextTag?: string | null;
  signal?: AbortSignal;
  timeoutMs: number;
  model: string;
  attempt: number;
  imagePrefetch?: FinalistImagePrefetch;
}): Promise<
  | {
      ok: true;
      placements: TierPlacement[];
      headToHead: HeadToHeadComparison[];
      llmOmissions: JudgeOmissionRow[];
      selfCheckDrops: SelfCheckDrop[];
      listingDrops: TierJudgeOmission[];
      listingAssessments: ListingAssessment[];
      userPrompt: string;
      system: string;
      model: string;
      resultText: string;
    }
  | { ok: false; reason: "timeout" | "error" | "empty_response" | "parse_failed"; error?: string }
> {
  const { brief, finalists, buyingRules, timeoutMs, model, attempt } = params;
  const validIds = new Set(finalists.map((v) => v.detail.id));
  const formatted = formatFinalistsForCompare(finalists);
  const images = params.imagePrefetch
    ? await params.imagePrefetch.resolveFor(formatted.entries)
    : new Map<string, JudgeImage>();
  const userPrompt = buildTierJudgeCompareUserPrompt({
    brief,
    candidatesBlock: formatted.candidatesBlock,
    buyingRules,
    memoryXml: params.memoryXml,
    contextTag: params.contextTag,
  });
  const system = buildTierJudgeSystemPrompt();
  const userContent = buildCompareUserContent(
    userPrompt,
    formatted.entries,
    images,
  );

  const anthropic = getAnthropicClient();
  const reqPromise = anthropic.messages.create(
    {
      model,
      max_tokens: 4096,
      system,
      tools: [tierJudgeTool],
      tool_choice: { type: "tool", name: TIER_JUDGE_TOOL_NAME },
      messages: [{ role: "user", content: userContent }],
    },
    params.signal ? { signal: params.signal } : undefined,
  );

  let msg: Awaited<ReturnType<typeof anthropic.messages.create>>;
  try {
    msg = await withTimeout(reqPromise, timeoutMs, "tier_judge_compare");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const reason = /timed out after/i.test(errorMessage) ? "timeout" : "error";
    logAiChat("warn", reason === "timeout" ? "tier_judge_timeout" : "tier_judge_error", {
      query: brief.query.slice(0, 120),
      candidateCount: finalists.length,
      timeoutMs,
      model,
      attempt: attempt + 1,
      error: errorMessage,
    });
    return { ok: false, reason, error: errorMessage };
  }

  const toolBlock = msg.content.find(
    (b): b is ToolUseBlock =>
      b.type === "tool_use" && b.name === TIER_JUDGE_TOOL_NAME,
  );

  if (!toolBlock) {
    const textFallback = msg.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const fromText = textFallback
      ? parseTierJudgePlacements(textFallback, validIds)
      : [];
    if (fromText.length) {
      const parsed = parseLlmJsonObject(textFallback);
      const checks = parsed?.value
        ? parseTierOneSelfChecks(parsed.value, validIds)
        : [];
      const enforced = enforceTierOneSelfChecks({
        placements: fromText,
        checks,
        verified: finalists,
        brief,
      });
      let listingAssessments = parsed?.value
        ? parseListingAssessments(parsed.value, validIds)
        : [];
      if (!listingAssessments.length) {
        listingAssessments = synthesizeListingAssessments(finalists);
      }
      const listingEnforced = enforceListingQualityOnPlacements(
        enforced.placements,
        listingAssessments,
      );
      return {
        ok: true,
        placements: listingEnforced.placements,
        headToHead: parsed?.value
          ? parseHeadToHeadComparisons(parsed.value, validIds)
          : [],
        llmOmissions: parsed?.value
          ? parseJudgeOmissions(parsed.value, validIds)
          : [],
        selfCheckDrops: enforced.drops,
        listingDrops: listingEnforced.drops,
        listingAssessments,
        userPrompt,
        system,
        model: msg.model,
        resultText: textFallback,
      };
    }
    logAiChat("warn", "tier_judge_empty_response", {
      query: brief.query.slice(0, 120),
      candidateCount: finalists.length,
      model,
      attempt: attempt + 1,
    });
    return { ok: false, reason: "empty_response" };
  }

  const placements = parseTierJudgePlacementRows(toolBlock.input, validIds);
  const headToHead = parseHeadToHeadComparisons(toolBlock.input, validIds);
  const llmOmissions = parseJudgeOmissions(toolBlock.input, validIds);
  const checks = parseTierOneSelfChecks(toolBlock.input, validIds);
  const resultText = JSON.stringify(toolBlock.input, null, 2);

  if (!placements.length) {
    logAiChat("warn", "tier_judge_parse_failed", {
      query: brief.query.slice(0, 120),
      candidateCount: finalists.length,
      model,
      attempt: attempt + 1,
      responsePreview: resultText.slice(0, 400),
      reason: "empty_placements",
    });
    return { ok: false, reason: "parse_failed" };
  }

  if (headToHead.length < 2) {
    logAiChat("warn", "tier_judge_sparse_head_to_head", {
      query: brief.query.slice(0, 120),
      headToHeadCount: headToHead.length,
      placementCount: placements.length,
      attempt: attempt + 1,
    });
  }

  const tierOnes = placements.filter((p) => p.tier === 1);
  const checkIds = new Set(checks.map((c) => c.productId));
  if (tierOnes.length > 0 && tierOnes.some((p) => !checkIds.has(p.productId))) {
    logAiChat("warn", "tier_judge_missing_self_checks", {
      query: brief.query.slice(0, 120),
      tierOneCount: tierOnes.length,
      checkCount: checks.length,
      attempt: attempt + 1,
    });
  }

  const enforced = enforceTierOneSelfChecks({
    placements,
    checks,
    verified: finalists,
    brief,
  });

  if (!enforced.placements.length) {
    logAiChat("warn", "tier_judge_all_self_checks_failed", {
      query: brief.query.slice(0, 120),
      drops: enforced.drops.length,
      attempt: attempt + 1,
    });
    return { ok: false, reason: "parse_failed" };
  }

  if (enforced.drops.length) {
    logAiChat("info", "tier_judge_self_check_drops", {
      query: brief.query.slice(0, 120),
      dropCount: enforced.drops.length,
      reasons: enforced.drops.map((d) => d.reason.slice(0, 80)),
    });
  }

  let listingAssessments = parseListingAssessments(toolBlock.input, validIds);
  if (!listingAssessments.length) {
    listingAssessments = synthesizeListingAssessments(finalists);
  }
  const listingEnforced = enforceListingQualityOnPlacements(
    enforced.placements,
    listingAssessments,
  );
  if (listingEnforced.drops.length) {
    logAiChat("info", "tier_judge_listing_quality_drops", {
      query: brief.query.slice(0, 120),
      dropCount: listingEnforced.drops.length,
    });
  }

  return {
    ok: true,
    placements: listingEnforced.placements,
    headToHead,
    llmOmissions,
    selfCheckDrops: enforced.drops,
    listingDrops: listingEnforced.drops,
    listingAssessments,
    userPrompt,
    system,
    model: msg.model,
    resultText,
  };
}

export type TierJudgeTriagePhaseResult = {
  triage: TriageVerdict[];
  buyingRules: string[];
  listingAssessments: ListingAssessment[];
  promptText: string;
  resultText: string;
  model?: string;
};

export async function runTierJudgeTriagePhase(params: {
  brief: SearchBrief;
  verified: VerifiedCandidate[];
  memoryXml?: string;
  contextTag?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<TierJudgeTriagePhaseResult | null> {
  const { brief, verified } = params;
  if (verified.length < 2) return null;

  const judgeCandidates = verified.slice(0, TIER_JUDGE_CANDIDATE_LIMIT);
  const baseTimeoutMs = params.timeoutMs ?? AI_CHAT_TIER_JUDGE_TIMEOUT_MS;

  for (let attempt = 0; attempt < TIER_JUDGE_ATTEMPTS; attempt++) {
    const model = modelForAttempt(attempt);
    const triageResult = await callTierJudgeTriage({
      ...params,
      verified: judgeCandidates,
      timeoutMs: triageTimeoutMs(baseTimeoutMs, attempt),
      model,
      attempt,
    });
    if (!triageResult.ok) {
      if (attempt < TIER_JUDGE_ATTEMPTS - 1) continue;
      return null;
    }
    return {
      triage: triageResult.triage,
      buyingRules: triageResult.buyingRules,
      listingAssessments: triageResult.listingAssessments,
      promptText: `${triageResult.system}\n\n=== USER ===\n${triageResult.userPrompt}`,
      resultText: triageResult.resultText,
      model: triageResult.model,
    };
  }
  return null;
}

export async function runTierJudgeComparePhase(params: {
  brief: SearchBrief;
  verified: VerifiedCandidate[];
  judgeCandidates: VerifiedCandidate[];
  triage: TriageVerdict[];
  buyingRules: string[];
  memoryXml?: string;
  contextTag?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  triagePromptText?: string;
  triageResultText?: string;
  imagePrefetch?: FinalistImagePrefetch;
}): Promise<TierJudgeResult | null> {
  const { brief, judgeCandidates, triage, buyingRules } = params;
  const baseTimeoutMs = params.timeoutMs ?? AI_CHAT_TIER_JUDGE_TIMEOUT_MS;

  for (let attempt = 0; attempt < TIER_JUDGE_ATTEMPTS; attempt++) {
    const compareTimeoutMs = attemptTimeoutMs(baseTimeoutMs, attempt);
    const model = modelForAttempt(attempt);

    const finalists = selectFinalistsForCompare(judgeCandidates, triage);
    if (finalists.length < 2) {
      if (attempt < TIER_JUDGE_ATTEMPTS - 1) continue;
      return null;
    }

    const compareResult = await callTierJudgeCompare({
      brief,
      finalists,
      buyingRules,
      memoryXml: params.memoryXml,
      contextTag: params.contextTag,
      signal: params.signal,
      timeoutMs: compareTimeoutMs,
      model,
      attempt,
      imagePrefetch: params.imagePrefetch,
    });
    if (!compareResult.ok) {
      if (attempt < TIER_JUDGE_ATTEMPTS - 1) continue;
      return null;
    }

    return {
      placements: enrichPlacementsWithRatingConfidence(
        compareResult.placements,
        finalists,
      ),
      omissions: [
        ...resolveJudgeOmissions(judgeCandidates, compareResult.placements, {
          triage,
          llmOmissions: compareResult.llmOmissions,
          headToHead: compareResult.headToHead,
          finalistIds: new Set(finalists.map((v) => v.detail.id)),
        }),
        ...compareResult.selfCheckDrops,
        ...compareResult.listingDrops,
      ],
      buyingRules,
      headToHeadComparisons: compareResult.headToHead,
      triageVerdicts: triage,
      listingAssessments: compareResult.listingAssessments,
      candidatesWithAttributes: countCandidatesWithAttributes(judgeCandidates),
      fallback: false,
      promptText: [
        params.triagePromptText ? `=== TRIAGE ===\n${params.triagePromptText}` : null,
        "=== COMPARE SYSTEM ===",
        compareResult.system,
        "",
        "=== COMPARE USER ===",
        compareResult.userPrompt,
      ]
        .filter(Boolean)
        .join("\n"),
      resultText: [
        params.triageResultText ? `=== TRIAGE ===\n${params.triageResultText}` : null,
        "=== COMPARE ===",
        compareResult.resultText,
      ]
        .filter(Boolean)
        .join("\n"),
      model: compareResult.model,
    };
  }

  return null;
}

export async function runTierJudge(params: {
  brief: SearchBrief;
  verified: VerifiedCandidate[];
  memoryXml?: string;
  contextTag?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<TierJudgeResult | null> {
  const { brief, verified } = params;
  if (verified.length < 2) return null;

  const judgeCandidates = verified.slice(0, TIER_JUDGE_CANDIDATE_LIMIT);
  const triagePhase = await runTierJudgeTriagePhase(params);
  if (!triagePhase) return null;

  return runTierJudgeComparePhase({
    ...params,
    verified,
    judgeCandidates,
    triage: triagePhase.triage,
    buyingRules: triagePhase.buyingRules,
    triagePromptText: triagePhase.promptText,
    triageResultText: triagePhase.resultText,
  });
}
