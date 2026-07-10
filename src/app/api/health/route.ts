import { curationLatencySnapshot } from "@/lib/fashion-memory/curation/latency-metrics";
import {
  CURATION_LATENCY_TRIPWIRE_MS,
} from "@/lib/fashion-memory/curation/config";
import { pricedLaneJunkSnapshot } from "@/lib/fashion-memory/budget/junk-share-metrics";
import { RELEVANCE_GUARD_MULTIPLIER } from "@/lib/fashion-memory/budget/budgetAllocation";

export async function GET() {
  const curation = curationLatencySnapshot({
    tripwireMs: CURATION_LATENCY_TRIPWIRE_MS,
  });
  const junk = pricedLaneJunkSnapshot();
  return Response.json({
    ok: !curation.tripwire_triggered,
    curation_latency: curation,
    priced_lane_junk: {
      ...junk,
      relevance_guard_multiplier: RELEVANCE_GUARD_MULTIPLIER,
    },
  });
}
