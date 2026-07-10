/**
 * Terminal trace for the find-similar pipeline.
 *
 * Enabled when FIND_SIMILAR_DEBUG=1, or in non-production by default.
 * Set FIND_SIMILAR_DEBUG=0 to silence in dev.
 */
type FindSimilarLogPayload = Record<string, unknown>;

export function isFindSimilarDebugEnabled(): boolean {
  return process.env.FIND_SIMILAR_DEBUG === "1";
}

export function logFindSimilar(
  phase: string,
  payload?: FindSimilarLogPayload,
): void {
  if (!isFindSimilarDebugEnabled()) return;
  const stamp = new Date().toISOString().slice(11, 23);
  if (!payload || Object.keys(payload).length === 0) {
    console.info(`[find_similar ${stamp}] ${phase}`);
    return;
  }
  console.info(`[find_similar ${stamp}] ${phase}`);
  console.info(JSON.stringify(payload, null, 2));
}

export function logFindSimilarBanner(title: string): void {
  if (!isFindSimilarDebugEnabled()) return;
  console.info(`\n[find_similar] ── ${title} ──`);
}
