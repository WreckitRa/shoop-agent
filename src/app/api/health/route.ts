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
    tryon,
  });
}
