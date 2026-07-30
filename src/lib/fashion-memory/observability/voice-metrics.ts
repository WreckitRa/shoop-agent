/** Rolling Stage B voice outcomes for GET /api/health. */

const MAX_SAMPLES = 400;

export type VoiceOutcome = "ok" | "retry_ok" | "fallback";

type Sample = { outcome: VoiceOutcome; ts: number };

const samples: Sample[] = [];

export function recordVoiceOutcome(outcome: VoiceOutcome): void {
  samples.push({ outcome, ts: Date.now() });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export function voiceMetricsSnapshot(): {
  samples: number;
  ok: number;
  retry_ok: number;
  fallback: number;
  /** Share of Stage B runs that landed on templated copy (0–1). */
  voice_fallback_rate: number;
} {
  const n = samples.length;
  let ok = 0;
  let retry_ok = 0;
  let fallback = 0;
  for (const s of samples) {
    if (s.outcome === "ok") ok += 1;
    else if (s.outcome === "retry_ok") retry_ok += 1;
    else fallback += 1;
  }
  return {
    samples: n,
    ok,
    retry_ok,
    fallback,
    voice_fallback_rate: n ? fallback / n : 0,
  };
}

export function resetVoiceMetricsForTests(): void {
  samples.length = 0;
}
