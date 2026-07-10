import type { SearchPipelineRunView } from "@/lib/ai-chat/agent-debug";
import { searchPipelineDebugFromSse } from "@/lib/ai-chat/search/pipeline-debug";

const CACHE_VERSION = 1;
const KEY_PREFIX = "shoop-pipeline-debug/v1/";

function cacheKey(conversationId: string): string {
  return `${KEY_PREFIX}${conversationId}`;
}

function isDbBackedRun(run: SearchPipelineRunView): boolean {
  return !run.id.startsWith("sp-");
}

export function mergePipelineRuns(
  existing: SearchPipelineRunView[],
  incoming: SearchPipelineRunView[],
): SearchPipelineRunView[] {
  const bySearchKey = new Map<string, SearchPipelineRunView>();

  const consider = (run: SearchPipelineRunView) => {
    const key = run.searchKey;
    const prev = bySearchKey.get(key);
    if (!prev) {
      bySearchKey.set(key, run);
      return;
    }
    const prevDb = isDbBackedRun(prev);
    const nextDb = isDbBackedRun(run);
    if (nextDb && !prevDb) {
      bySearchKey.set(key, run);
      return;
    }
    if (prevDb && !nextDb) return;
    bySearchKey.set(key, run.ts >= prev.ts ? run : prev);
  };

  for (const run of existing) consider(run);
  for (const run of incoming) consider(run);

  return [...bySearchKey.values()].sort((a, b) => a.ts - b.ts);
}

export function readPipelineDebugCache(
  conversationId: string,
): SearchPipelineRunView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(cacheKey(conversationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      version?: number;
      runs?: SearchPipelineRunView[];
    };
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.runs)) {
      return [];
    }
    return parsed.runs
      .map((run) => {
        const pipeline = searchPipelineDebugFromSse(run);
        if (!pipeline) return null;
        return {
          ...pipeline,
          id: run.id,
          ts: run.ts,
        } satisfies SearchPipelineRunView;
      })
      .filter((run): run is SearchPipelineRunView => run != null);
  } catch {
    return [];
  }
}

export function writePipelineDebugCache(
  conversationId: string,
  runs: SearchPipelineRunView[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      cacheKey(conversationId),
      JSON.stringify({ version: CACHE_VERSION, runs }),
    );
  } catch {
    // Quota exceeded — best-effort only.
  }
}

export function upsertPipelineDebugCache(
  conversationId: string,
  run: SearchPipelineRunView,
): SearchPipelineRunView[] {
  const merged = mergePipelineRuns(readPipelineDebugCache(conversationId), [run]);
  writePipelineDebugCache(conversationId, merged);
  return merged;
}
