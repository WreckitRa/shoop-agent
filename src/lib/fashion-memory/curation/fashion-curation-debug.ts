import { pipelineProductFromSummary } from "@/lib/ai-chat/search/pipeline-debug";
import type { PipelineDebugProduct } from "@/lib/ai-chat/search/pipeline-debug";
import { FASHION_CURATION_MODEL } from "./config";
import type {
  CurationLook,
  CapsuleOutfit,
  CurationRefRegistry,
  DeliverCurationInput,
  DeliverCurationVeto,
  FashionCurationPresentation,
} from "./types";
import type { FashionSearchPlan } from "../search-planner/types";

export type FashionCurationCandidateDebug = PipelineDebugProduct & {
  ref: string;
  slot_id: string;
  garment: string;
  score_rank: number;
  score?: number;
  image_shown: boolean;
  image_url?: string;
  brand_confirmed?: boolean;
  colors?: string;
  size_status?: string;
  suspicions?: string;
  picked: boolean;
  pick_role?: string;
  stylist_line?: string;
  vetoed: boolean;
  veto_reason?: string;
  veto_evidence?: string;
};

export type FashionCurationSlotDebug = {
  slot_id: string;
  garment: string;
  role: string;
  options_wanted: number;
  image_budget: number;
  candidate_count: number;
  picks_count: number;
  candidates: FashionCurationCandidateDebug[];
};

export type FashionCurationDebugV1 = {
  version: 1;
  searchKey: string;
  ts: number;
  timing_ms: number;
  model: string;
  mode: string;
  fallback: boolean;
  retries: number;
  image_count: number;
  validation_issues: string[];
  narration: FashionCurationPresentation["narration"];
  input_text: string;
  slots: FashionCurationSlotDebug[];
  vetoes: DeliverCurationVeto[];
  looks?: CurationLook[];
  capsule_outfits?: CapsuleOutfit[];
  raw_llm_output?: DeliverCurationInput;
  tiers_summary: {
    picks: number;
    verified: number;
    unverified: number;
  };
};

function formatColors(
  candidate: import("../hydration/types").HydratedCandidate,
): string | undefined {
  const buckets = candidate.normalized?.colors?.buckets ?? [];
  if (buckets.length) return buckets.join(", ");
  return undefined;
}

function formatSuspicions(
  candidate: import("../hydration/types").HydratedCandidate,
): string | undefined {
  if (!candidate.suspicions?.length) return undefined;
  return candidate.suspicions.map((s) => `${s.rule}: ${s.evidence}`).join("; ");
}

export function buildFashionCurationDebug(params: {
  plan: FashionSearchPlan;
  registry: CurationRefRegistry;
  presentation: FashionCurationPresentation;
  input_text: string;
  image_count: number;
  curation_ms: number;
  fallback: boolean;
  retries: number;
  validation_issues: string[];
  raw_llm_output?: DeliverCurationInput | null;
  ts?: number;
}): FashionCurationDebugV1 {
  const pickByRef = new Map<
    string,
    { role: string; stylist_line: string }
  >();
  for (const pick of params.presentation.tiers.picks) {
    pickByRef.set(pick.ref, {
      role: pick.role,
      stylist_line: pick.stylist_line,
    });
  }

  const vetoByRef = new Map<string, DeliverCurationVeto>();
  for (const veto of params.raw_llm_output?.vetoes ?? []) {
    vetoByRef.set(veto.ref, veto);
  }

  const garmentBySlot = new Map(
    params.plan.slots.map((slot) => [slot.slot_id, slot.garment]),
  );

  const slotsById = new Map<string, FashionCurationCandidateDebug[]>();
  for (const entry of params.registry.values()) {
    const product = pipelineProductFromSummary(entry.candidate.raw);
    const pick = pickByRef.get(entry.ref);
    const veto = vetoByRef.get(entry.ref);
    const imageUrl =
      entry.candidate.media_urls[0] ?? entry.candidate.image_urls[0];

    const row: FashionCurationCandidateDebug = {
      ...product,
      ref: entry.ref,
      slot_id: entry.slot_id,
      garment: garmentBySlot.get(entry.slot_id) ?? entry.slot_id,
      score_rank: entry.score_rank,
      score: entry.candidate.score?.final,
      image_shown: entry.image_shown,
      image_url: imageUrl,
      brand_confirmed: entry.candidate.brand_confirmed,
      colors: formatColors(entry.candidate),
      size_status: entry.candidate.size_status,
      suspicions: formatSuspicions(entry.candidate),
      picked: Boolean(pick),
      pick_role: pick?.role,
      stylist_line: pick?.stylist_line,
      vetoed: Boolean(veto),
      veto_reason: veto?.reason,
      veto_evidence: veto?.evidence,
    };

    const list = slotsById.get(entry.slot_id) ?? [];
    list.push(row);
    slotsById.set(entry.slot_id, list);
  }

  const slots: FashionCurationSlotDebug[] = params.plan.slots.map((planSlot) => {
    const candidates = (slotsById.get(planSlot.slot_id) ?? []).sort(
      (a, b) => a.score_rank - b.score_rank,
    );
    const imageBudget = candidates.filter((c) => c.image_shown).length;
    return {
      slot_id: planSlot.slot_id,
      garment: planSlot.garment,
      role: planSlot.role,
      options_wanted: planSlot.options_wanted,
      image_budget: imageBudget,
      candidate_count: candidates.length,
      picks_count: candidates.filter((c) => c.picked).length,
      candidates,
    };
  });

  const garmentLabel =
    params.plan.slots.map((slot) => slot.garment).join(", ") || "fashion";
  const ts = params.ts ?? Date.now();

  return {
    version: 1,
    searchKey: `fashion-curation:${garmentLabel}:${ts}`,
    ts,
    timing_ms: params.curation_ms,
    model: FASHION_CURATION_MODEL,
    mode: params.plan.mode,
    fallback: params.fallback,
    retries: params.retries,
    image_count: params.image_count,
    validation_issues: params.validation_issues,
    narration: params.presentation.narration,
    input_text: params.input_text,
    slots,
    vetoes: params.raw_llm_output?.vetoes ?? [],
    looks: params.presentation.looks,
    capsule_outfits: params.presentation.capsule_outfits,
    raw_llm_output: params.raw_llm_output ?? undefined,
    tiers_summary: {
      picks: params.presentation.tiers.picks.length,
      verified: params.presentation.tiers.verified.length,
      unverified: params.presentation.tiers.unverified.length,
    },
  };
}

export function fashionCurationDebugFromSse(
  data: Record<string, unknown>,
): FashionCurationDebugV1 | null {
  if (data.version !== 1) return null;
  if (!Array.isArray(data.slots)) return null;
  return data as FashionCurationDebugV1;
}

export function fashionCurationDebugForPersist(
  run: FashionCurationDebugV1,
): FashionCurationDebugV1 {
  return {
    ...run,
    input_text: run.input_text.slice(0, 12_000),
    raw_llm_output: undefined,
  };
}
