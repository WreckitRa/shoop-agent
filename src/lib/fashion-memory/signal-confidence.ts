import type { StyleSignalRow } from "./types";

const MS_PER_MONTH = 30.44 * 24 * 60 * 60 * 1000;
const HALF_LIFE_MONTHS = 9;
const DEFAULT_MIN_EFFECTIVE = 0.15;

/** 9-month half-life decay for taste signals; facts never decay. */
export function effectiveSignalConfidence(
  signal: Pick<StyleSignalRow, "confidence" | "last_seen_at">,
  now: Date = new Date(),
): number {
  const lastSeen = Date.parse(signal.last_seen_at);
  if (!Number.isFinite(lastSeen)) return signal.confidence;
  const months = Math.max(0, (now.getTime() - lastSeen) / MS_PER_MONTH);
  return signal.confidence * 0.5 ** (months / HALF_LIFE_MONTHS);
}

export function signalAboveEffectiveThreshold(
  signal: Pick<StyleSignalRow, "confidence" | "last_seen_at">,
  minEffective = DEFAULT_MIN_EFFECTIVE,
  now?: Date,
): boolean {
  return effectiveSignalConfidence(signal, now) >= minEffective;
}

export function filterSignalsByEffectiveConfidence<T extends StyleSignalRow>(
  signals: T[],
  minEffective = DEFAULT_MIN_EFFECTIVE,
  now?: Date,
): T[] {
  return signals.filter((s) => signalAboveEffectiveThreshold(s, minEffective, now));
}
