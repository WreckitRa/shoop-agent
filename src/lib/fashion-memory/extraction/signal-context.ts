import { KNOWN_SIGNAL_CONTEXTS } from "../router/profile-context-format";

/**
 * Clerk context must be a known context or the occasion family.
 * Free inventions ("general preference shift") become general.
 */
export function normalizeSignalContext(
  raw: string | null | undefined,
): string {
  const t = raw?.trim().toLowerCase() || "general";
  if (KNOWN_SIGNAL_CONTEXTS.has(t)) return t;
  const first = t.split(/[\s/_-]+/).find((p) => p.length > 0);
  if (first && KNOWN_SIGNAL_CONTEXTS.has(first)) return first;
  return "general";
}
