/**
 * Memory hygiene: dedupe, expiry, scope conflict resolution.
 * Priority: session > category > global (recency breaks ties within scope).
 */
import type { ShoppingMemoryRow } from "../prisma-types";

const SCOPE_RANK: Record<string, number> = {
  session: 3,
  category: 2,
  global: 1,
};

export function dedupeCanonicalMemories(
  rows: ShoppingMemoryRow[],
): ShoppingMemoryRow[] {
  const seen = new Set<string>();
  const out: ShoppingMemoryRow[] = [];
  for (const r of rows) {
    const key = r.value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function resolveMemoryScopeConflicts(
  rows: ShoppingMemoryRow[],
): ShoppingMemoryRow[] {
  const byKey = new Map<string, ShoppingMemoryRow>();
  for (const r of rows) {
    const key = `${r.category ?? ""}:${r.subcategory ?? ""}:${r.value.trim().toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, r);
      continue;
    }
    const prevRank = SCOPE_RANK[prev.scope] ?? 0;
    const nextRank = SCOPE_RANK[r.scope] ?? 0;
    if (nextRank > prevRank) {
      byKey.set(key, r);
    } else if (nextRank === prevRank && r.updatedAt > prev.updatedAt) {
      byKey.set(key, r);
    }
  }
  return [...byKey.values()];
}

export function filterStaleIntents<
  T extends { intentName: string; neededBy: Date | null; status?: string },
>(rows: T[], now = new Date()): T[] {
  return rows.filter((r) => {
    if (r.neededBy && r.neededBy < now) return false;
    const name = r.intentName.toLowerCase();
    if (/\bbirthday\b/.test(name) && r.neededBy && r.neededBy < now) return false;
    return true;
  });
}

export function filterNonemptyRecipients<
  T extends {
    label: string;
    name: string | null;
    knownPreferences: string[];
    dislikes: string[];
    favoriteBrands: string[];
    sizes: unknown;
  },
>(rows: T[]): T[] {
  return rows.filter((r) => {
    const sizes = r.sizes as Record<string, unknown> | null;
    const hasSizes =
      sizes &&
      Object.values(sizes).some((v) => v != null && String(v).trim() !== "");
    const hasData =
      Boolean(r.name?.trim()) ||
      r.knownPreferences.length > 0 ||
      r.dislikes.length > 0 ||
      r.favoriteBrands.length > 0 ||
      hasSizes;
    return hasData;
  });
}

export function hygieneCanonicalMemories(
  rows: ShoppingMemoryRow[],
): ShoppingMemoryRow[] {
  return resolveMemoryScopeConflicts(dedupeCanonicalMemories(rows));
}
