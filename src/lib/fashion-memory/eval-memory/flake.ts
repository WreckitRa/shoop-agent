import type { CaseResult, StoreDump } from "./types";

export function dumpStateKey(dump: StoreDump): string {
  return JSON.stringify({
    people: dump.people
      .map((p) => `${p.relation}|${p.name ?? ""}`)
      .sort(),
    facts: dump.facts
      .map(
        (f) =>
          `${f.person}|${f.fact_type}|${f.garment_type ?? ""}|${f.status}|${JSON.stringify(f.value)}`,
      )
      .sort(),
    signals: dump.signals
      .map(
        (s) =>
          `${s.person}|${s.signal_type}|${s.value}|${s.polarity}|${s.source}|${s.status}|${s.context}`,
      )
      .sort(),
    events: dump.request_events.length,
    picks: dump.recent_picks_line,
  });
}

export function hasHardZeroViolation(result: CaseResult): boolean {
  return (
    result.counts.wrong_person > 0 ||
    result.counts.forbidden > 0 ||
    result.diff.wrong_person.length > 0 ||
    result.diff.forbidden.length > 0
  );
}

export function shouldRetryCase(result: CaseResult): boolean {
  if (result.skipped || result.pass) return false;
  return !hasHardZeroViolation(result);
}

/** Second attempt decides: recovered flake pass, or stable/unstable fail. */
export function mergeFlakeAttempt(
  first: CaseResult,
  second: CaseResult,
): CaseResult {
  const attempts = 2;
  if (hasHardZeroViolation(first) || hasHardZeroViolation(second)) {
    const worse = hasHardZeroViolation(second) ? second : first;
    return { ...worse, attempts, flake: false };
  }
  if (second.pass) {
    return { ...second, attempts, flake: true };
  }
  const identical = first.stateKey === second.stateKey;
  return {
    ...second,
    attempts,
    flake: false,
    flake_unstable: !identical,
  };
}
