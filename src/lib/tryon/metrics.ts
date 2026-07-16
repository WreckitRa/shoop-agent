import { prisma } from "@/lib/ai-chat/db";
import { TRYON_GLOBAL_DAILY_SPEND_CAP } from "./config";
import { isGlobalTryonCapTripped } from "./feature-flags";

export type TryonHealthMetrics = {
  generations_today: number;
  success_rate: number;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  tap_rate: number | null;
  estimated_daily_spend_usd: number;
  global_cap_tripped: boolean;
};

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

let testMetrics: TryonHealthMetrics | null = null;

export function setTestTryonMetrics(m: TryonHealthMetrics | null): void {
  testMetrics = m;
}

export async function tryonHealthSnapshot(): Promise<TryonHealthMetrics> {
  if (testMetrics) return testMetrics;

  const since = startOfUtcDay();
  const rows = await prisma.tryonGeneration.findMany({
    where: { createdAt: { gte: since } },
    select: {
      status: true,
      ms: true,
      costEstimate: true,
      kind: true,
    },
  });

  const completed = rows.filter((r) => r.status === "completed");
  const failed = rows.filter((r) => r.status === "failed");
  const finished = completed.length + failed.length;
  const latencies = completed
    .map((r) => r.ms)
    .filter((ms): ms is number => typeof ms === "number")
    .sort((a, b) => a - b);

  const spend = completed.reduce((sum, r) => sum + (r.costEstimate ?? 0), 0);
  const taps = rows.filter((r) => r.kind === "single").length;

  return {
    generations_today: rows.length,
    success_rate: finished ? completed.length / finished : 1,
    latency_p50_ms: percentile(latencies, 50),
    latency_p95_ms: percentile(latencies, 95),
    tap_rate: null,
    estimated_daily_spend_usd: Math.round(spend * 100) / 100,
    global_cap_tripped: isGlobalTryonCapTripped(),
  };
}

export { TRYON_GLOBAL_DAILY_SPEND_CAP };
