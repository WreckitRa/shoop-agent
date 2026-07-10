import type { FashionCurationRunView } from "@/lib/ai-chat/agent-debug";
import { fashionCurationDebugFromSse } from "@/lib/fashion-memory/curation/fashion-curation-debug";
import { fashionCurationDebugForPersist } from "@/lib/fashion-memory/curation/fashion-curation-debug";

const CACHE_VERSION = 1;
const KEY_PREFIX = "shoop-fashion-curation-debug/v1/";

function cacheKey(conversationId: string): string {
  return `${KEY_PREFIX}${conversationId}`;
}

export function mergeFashionCurationRuns(
  existing: FashionCurationRunView[],
  incoming: FashionCurationRunView[],
): FashionCurationRunView[] {
  const byKey = new Map<string, FashionCurationRunView>();

  const consider = (run: FashionCurationRunView) => {
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

export function readFashionCurationDebugCache(
  conversationId: string,
): FashionCurationRunView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(cacheKey(conversationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      version?: number;
      runs?: FashionCurationRunView[];
    };
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.runs)) {
      return [];
    }
    return parsed.runs
      .map((run) => {
        const curation = fashionCurationDebugFromSse(run);
        if (!curation) return null;
        return {
          ...curation,
          id: run.id,
          ts: run.ts,
        } satisfies FashionCurationRunView;
      })
      .filter((run): run is FashionCurationRunView => run != null);
  } catch {
    return [];
  }
}

export function writeFashionCurationDebugCache(
  conversationId: string,
  runs: FashionCurationRunView[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      cacheKey(conversationId),
      JSON.stringify({
        version: CACHE_VERSION,
        runs: runs.map((run) => ({
          ...fashionCurationDebugForPersist(run),
          id: run.id,
        })),
      }),
    );
  } catch {
    // Quota exceeded — best-effort only.
  }
}

export function upsertFashionCurationDebugCache(
  conversationId: string,
  run: FashionCurationRunView,
): FashionCurationRunView[] {
  const slim: FashionCurationRunView = {
    ...fashionCurationDebugForPersist(run),
    id: run.id,
    ts: run.ts,
  };
  const merged = mergeFashionCurationRuns(
    readFashionCurationDebugCache(conversationId),
    [slim],
  );
  writeFashionCurationDebugCache(conversationId, merged);
  return merged;
}
