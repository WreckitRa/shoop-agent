import type { FashionCatalogRunView } from "@/lib/ai-chat/agent-debug";
import { fashionCatalogDebugFromSse } from "@/lib/fashion-memory/catalog-search/fashion-catalog-debug";
import { fashionCatalogDebugForPersist } from "@/lib/fashion-memory/catalog-search/fashion-catalog-debug";

const CACHE_VERSION = 1;
const KEY_PREFIX = "shoop-fashion-catalog-debug/v1/";

function cacheKey(conversationId: string): string {
  return `${KEY_PREFIX}${conversationId}`;
}

export function mergeFashionCatalogRuns(
  existing: FashionCatalogRunView[],
  incoming: FashionCatalogRunView[],
): FashionCatalogRunView[] {
  const byKey = new Map<string, FashionCatalogRunView>();

  const consider = (run: FashionCatalogRunView) => {
    const key = run.searchKey;
    const prev = byKey.get(key);
    if (!prev || run.ts >= prev.ts) {
      byKey.set(key, run);
    }
  };

  for (const run of existing) consider(run);
  for (const run of incoming) consider(run);

  return [...byKey.values()].sort((a, b) => a.ts - b.ts);
}

export function readFashionCatalogDebugCache(
  conversationId: string,
): FashionCatalogRunView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(cacheKey(conversationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      version?: number;
      runs?: FashionCatalogRunView[];
    };
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.runs)) {
      return [];
    }
    return parsed.runs
      .map((run) => {
        const catalog = fashionCatalogDebugFromSse(run);
        if (!catalog) return null;
        return {
          ...catalog,
          id: run.id,
          ts: run.ts,
        } satisfies FashionCatalogRunView;
      })
      .filter((run): run is FashionCatalogRunView => run != null);
  } catch {
    return [];
  }
}

export function writeFashionCatalogDebugCache(
  conversationId: string,
  runs: FashionCatalogRunView[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      cacheKey(conversationId),
      JSON.stringify({
        version: CACHE_VERSION,
        runs: runs.map((run) => ({
          ...fashionCatalogDebugForPersist(run),
          id: run.id,
        })),
      }),
    );
  } catch {
    // Quota exceeded — best-effort only.
  }
}

export function upsertFashionCatalogDebugCache(
  conversationId: string,
  run: FashionCatalogRunView,
): FashionCatalogRunView[] {
  const slim: FashionCatalogRunView = {
    ...fashionCatalogDebugForPersist(run),
    id: run.id,
    ts: run.ts,
  };
  const merged = mergeFashionCatalogRuns(
    readFashionCatalogDebugCache(conversationId),
    [slim],
  );
  writeFashionCatalogDebugCache(conversationId, merged);
  return merged;
}
