/**
 * Near-duplicate detection for query strings and product titles (MMR, slotting).
 */
import { sanitizeQueryText } from "./query-hygiene";

function tokensFrom(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

/** Jaccard similarity on word tokens (for near-synonym dedupe). */
export function titleTokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokensFrom(a));
  const tb = new Set(tokensFrom(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

/** Drop phrases that are near-duplicates of an earlier entry. */
export function dedupeNearSynonyms(types: string[], threshold = 0.55): string[] {
  const out: string[] = [];
  for (const t of types) {
    const clean = sanitizeQueryText(t);
    if (!clean) continue;
    if (out.some((prev) => titleTokenSimilarity(prev, clean) >= threshold)) continue;
    out.push(clean);
  }
  return out;
}
