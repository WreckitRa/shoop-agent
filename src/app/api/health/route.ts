import {
  curationLatencySnapshot,
  curationLlmCallLatencySnapshot,
} from "@/lib/fashion-memory/curation/latency-metrics";
import {
  CURATION_LATENCY_TRIPWIRE_MS,
} from "@/lib/fashion-memory/curation/config";
import { pricedLaneJunkSnapshot } from "@/lib/fashion-memory/budget/junk-share-metrics";
import { RELEVANCE_GUARD_MULTIPLIER } from "@/lib/fashion-memory/budget/budgetAllocation";
import { familyCoverageSnapshot } from "@/lib/fashion-memory/catalog-search/family-coverage";
import { routerEscalationSnapshot } from "@/lib/fashion-memory/router/escalation-metrics";
import { promptCacheSnapshot } from "@/lib/fashion-memory/observability/prompt-cache-metrics";
import { preSearchMetricsSnapshot } from "@/lib/fashion-memory/observability/pre-search-metrics";
import { voiceMetricsSnapshot } from "@/lib/fashion-memory/observability/voice-metrics";
import { tryonHealthSnapshot } from "@/lib/tryon/metrics";

export async function GET() {
  const curation = curationLatencySnapshot({
    tripwireMs: CURATION_LATENCY_TRIPWIRE_MS,
  });
  const curationLlmCalls = curationLlmCallLatencySnapshot({
    tripwireMs: CURATION_LATENCY_TRIPWIRE_MS,
  });
  const junk = pricedLaneJunkSnapshot();
  const family_coverage = familyCoverageSnapshot();
  const router_escalation = routerEscalationSnapshot();
  const prompt_cache = promptCacheSnapshot();
  const pre_search = preSearchMetricsSnapshot();
  const voice = voiceMetricsSnapshot();
  const tryon = await tryonHealthSnapshot();
  return Response.json({
    ok: !curation.tripwire_triggered && !tryon.global_cap_tripped,
    curation_latency: curation,
    curation_llm_call_latency: curationLlmCalls,
    priced_lane_junk: {
      ...junk,
      relevance_guard_multiplier: RELEVANCE_GUARD_MULTIPLIER,
    },
    /** Rolling chart: searches vs thin/empty-after-drops by garment family. */
    family_coverage,
    /** Opus-class router re-runs (weird ~5%); rate visible for cost ops. */
    router_escalation,
    /**
     * Anthropic ephemeral prompt-cache by stage.
     * hit_rate is null when expected_cacheable=false (under-threshold → n/a).
     */
    prompt_cache,
    /** Clarification efficiency + gate path + occasion inference. */
    pre_search,
    /** Stage B voice reliability — voice_fallback_rate is the natural experiment. */
    voice,
    tryon,
  });
}
