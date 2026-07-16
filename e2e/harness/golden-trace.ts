import type { StructuralTrace } from "../types";

export function buildStructuralTrace(
  events: Array<{ stage: string; payload: Record<string, unknown> }>,
): StructuralTrace {
  const eventCounts: Record<string, number> = {};
  const stages: string[] = [];
  for (const e of events) {
    stages.push(e.stage);
    eventCounts[e.stage] = (eventCounts[e.stage] ?? 0) + 1;
  }
  return { stages, eventCounts };
}

export function diffStructuralTraces(
  expected: StructuralTrace,
  actual: StructuralTrace,
): string[] {
  const issues: string[] = [];
  if (JSON.stringify(expected.stages) !== JSON.stringify(actual.stages)) {
    issues.push(
      `stage sequence mismatch:\n  expected: ${expected.stages.join(" → ")}\n  actual:   ${actual.stages.join(" → ")}`,
    );
  }
  const keys = new Set([
    ...Object.keys(expected.eventCounts),
    ...Object.keys(actual.eventCounts),
  ]);
  for (const k of keys) {
    if ((expected.eventCounts[k] ?? 0) !== (actual.eventCounts[k] ?? 0)) {
      issues.push(
        `event count ${k}: expected ${expected.eventCounts[k] ?? 0}, got ${actual.eventCounts[k] ?? 0}`,
      );
    }
  }
  return issues;
}

const VOLATILE_KEYS = new Set(["trace_id", "traceId", "id", "ms", "duration_ms"]);

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(k)) continue;
      out[k] = stripVolatile(v);
    }
    return out;
  }
  return value;
}

export function diffGoldenPayloads(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): string[] {
  const issues: string[] = [];
  for (const [key, exp] of Object.entries(expected)) {
    const act = actual[key];
    const e = JSON.stringify(stripVolatile(exp));
    const a = JSON.stringify(stripVolatile(act));
    if (e !== a) {
      issues.push(`golden_payload.${key}: expected ${e}, got ${a}`);
    }
  }
  return issues;
}
