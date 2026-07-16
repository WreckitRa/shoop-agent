/** Rolling router-escalation rate for GET /api/health. */

const MAX_SAMPLES = 200;

type Sample = { escalated: boolean; ts: number };

const samples: Sample[] = [];

export function recordRouterEscalation(escalated: boolean): void {
  samples.push({ escalated, ts: Date.now() });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export function routerEscalationSnapshot(): {
  samples: number;
  escalated: number;
  rate: number;
  enabled: boolean;
} {
  const escalated = samples.filter((s) => s.escalated).length;
  return {
    samples: samples.length,
    escalated,
    rate: samples.length ? escalated / samples.length : 0,
    enabled:
      process.env.FASHION_ROUTER_ESCALATION_ENABLED === "1" ||
      process.env.FASHION_ROUTER_ESCALATION_ENABLED === "true",
  };
}

export function resetRouterEscalationForTests(): void {
  samples.length = 0;
}
