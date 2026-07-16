"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Bug,
  ChevronRight,
  ClipboardCopy,
  Download,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import type { QueryPlannerRunView } from "@/lib/ai-chat/agent-debug";
import { useAgentDebugStore } from "@/components/chat/agent-debug-store";
import { useChatStore } from "@/components/chat/chat-store";
import { SearchPipelinePanel } from "@/components/chat/SearchPipelinePanel";
import { FashionCatalogDebugPanel } from "@/components/chat/FashionCatalogDebugPanel";
import { FashionCurationDebugPanel } from "@/components/chat/FashionCurationDebugPanel";
import {
  buildChatDebugExportForAi,
  copyChatDebugExport,
  downloadChatDebugExport,
} from "@/lib/client/chat-debug-export";
import { QaDebugCriteriaPanel } from "@/components/qa/QaDebugCriteriaPanel";
import { buildQaDebugCriteria } from "@/lib/qa/debug-criteria";

const PANEL_WIDTH = 560;

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function stepLabel(step: string) {
  return step.replace(/_/g, " ");
}

function QueryPlannerRunDetail({ run }: { run: QueryPlannerRunView }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-ink-muted">
        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 font-mono uppercase tracking-wide text-violet-800 dark:text-violet-200">
          {stepLabel(run.step)}
        </span>
        <span className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono">
          {run.model}
        </span>
        {run.sequence != null ? (
          <span className="font-mono">seq {run.sequence}</span>
        ) : null}
        <span>{formatTime(run.ts)}</span>
      </div>

      <details open className="mb-3">
        <summary className="cursor-pointer text-xs font-medium text-ink">
          Prompt sent ({run.promptText.length.toLocaleString()} chars)
        </summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-surface-subtle p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-muted">
          {run.promptText}
        </pre>
      </details>

      <details open>
        <summary className="cursor-pointer text-xs font-medium text-ink">
          Model output ({run.resultText.length.toLocaleString()} chars)
        </summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-surface-subtle p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-muted">
          {run.resultText}
        </pre>
      </details>
    </div>
  );
}

export const AgentDebugPanel = memo(function AgentDebugPanel() {
  const enabled = useAgentDebugStore((s) => s.enabled);
  const open = useAgentDebugStore((s) => s.open);
  const toggleOpen = useAgentDebugStore((s) => s.toggleOpen);
  const setOpen = useAgentDebugStore((s) => s.setOpen);
  const activeTab = useAgentDebugStore((s) => s.activeTab);
  const setActiveTab = useAgentDebugStore((s) => s.setActiveTab);
  const runs = useAgentDebugStore((s) => s.queryPlannerRuns);
  const pipelineRuns = useAgentDebugStore((s) => s.pipelineRuns);
  const fashionCatalogRuns = useAgentDebugStore((s) => s.fashionCatalogRuns);
  const fashionCurationRuns = useAgentDebugStore((s) => s.fashionCurationRuns);
  const loadingRuns = useAgentDebugStore((s) => s.loadingRuns);
  const runsError = useAgentDebugStore((s) => s.runsError);
  const selectedRunId = useAgentDebugStore((s) => s.selectedRunId);
  const selectedPipelineId = useAgentDebugStore((s) => s.selectedPipelineId);
  const selectedFashionCatalogId = useAgentDebugStore(
    (s) => s.selectedFashionCatalogId,
  );
  const selectedFashionCurationId = useAgentDebugStore(
    (s) => s.selectedFashionCurationId,
  );
  const setSelectedRunId = useAgentDebugStore((s) => s.setSelectedRunId);
  const setSelectedPipelineId = useAgentDebugStore((s) => s.setSelectedPipelineId);
  const setSelectedFashionCatalogId = useAgentDebugStore(
    (s) => s.setSelectedFashionCatalogId,
  );
  const setSelectedFashionCurationId = useAgentDebugStore(
    (s) => s.setSelectedFashionCurationId,
  );
  const fetchRuns = useAgentDebugStore((s) => s.fetchRuns);
  const hydratePipelineFromCache = useAgentDebugStore(
    (s) => s.hydratePipelineFromCache,
  );
  const hydrateFashionCatalogFromCache = useAgentDebugStore(
    (s) => s.hydrateFashionCatalogFromCache,
  );
  const hydrateFashionCurationFromCache = useAgentDebugStore(
    (s) => s.hydrateFashionCurationFromCache,
  );
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const messages = useChatStore((s) => s.messages);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const qaCriteria = useMemo(() => {
    const assistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.metadata?.fashionCatalogSearch);
    if (!assistant?.metadata) return null;
    const meta = assistant.metadata;
    const catalogRun = fashionCatalogRuns[fashionCatalogRuns.length - 1];
    const compactEvents = meta.fashionPipelineEvents ?? [];
    const pipelineEvents = compactEvents.map((e, i) => ({
      id: `chat-${i}`,
      stage: e.stage,
      payload: e.payload,
      created_at: "",
    }));
    return buildQaDebugCriteria({
      traceId:
        catalogRun?.trace_id ??
        meta.fashionCatalogSearch?.trace_id ??
        meta.fashionSearchPlan?.trace_id ??
        null,
      fashionRouter: meta.fashionRouter,
      fashionSearchPlan: meta.fashionSearchPlan,
      catalogSearch: meta.fashionCatalogSearch,
      pipelineEvents,
      curationDebug: fashionCurationRuns[fashionCurationRuns.length - 1] ?? null,
    });
  }, [messages, fashionCatalogRuns, fashionCurationRuns]);

  useEffect(() => {
    if (!enabled || !activeConversationId) return;
    hydratePipelineFromCache(activeConversationId);
    hydrateFashionCatalogFromCache(activeConversationId);
    hydrateFashionCurationFromCache(activeConversationId);
    void fetchRuns({ conversationId: activeConversationId });
  }, [
    enabled,
    activeConversationId,
    fetchRuns,
    hydratePipelineFromCache,
    hydrateFashionCatalogFromCache,
    hydrateFashionCurationFromCache,
  ]);

  const buildExport = useCallback(
    () =>
      buildChatDebugExportForAi({
        conversationId: activeConversationId,
        messages,
        pipelineRuns,
        fashionCatalogRuns,
        fashionCurationRuns,
        queryPlannerRuns: runs,
      }),
    [
      activeConversationId,
      messages,
      pipelineRuns,
      fashionCatalogRuns,
      fashionCurationRuns,
      runs,
    ],
  );

  const handleDownloadExport = useCallback(() => {
    downloadChatDebugExport(buildExport());
    setExportStatus("Downloaded");
    window.setTimeout(() => setExportStatus(null), 2000);
  }, [buildExport]);

  const handleCopyExport = useCallback(() => {
    void copyChatDebugExport(buildExport()).then((ok) => {
      setExportStatus(ok ? "Copied" : "Copy failed");
      window.setTimeout(() => setExportStatus(null), 2000);
    });
  }, [buildExport]);

  const selectedPlanner =
    runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null;
  const selectedPipeline =
    pipelineRuns.find((r) => r.id === selectedPipelineId) ??
    pipelineRuns[pipelineRuns.length - 1] ??
    null;
  const selectedFashionCatalog =
    fashionCatalogRuns.find((r) => r.id === selectedFashionCatalogId) ??
    fashionCatalogRuns[fashionCatalogRuns.length - 1] ??
    null;
  const selectedFashionCuration =
    fashionCurationRuns.find((r) => r.id === selectedFashionCurationId) ??
    fashionCurationRuns[fashionCurationRuns.length - 1] ??
    null;

  if (!enabled) return null;

  return (
    <>
      {!open ? (
        <div className="fixed bottom-20 right-4 z-40 hidden items-center gap-1.5 md:flex">
          <button
            type="button"
            onClick={handleDownloadExport}
            className="rounded-full border border-border/80 bg-surface p-2 text-ink shadow-md hover:bg-surface-subtle"
            title="Download minimized chat+pipeline dump for AI review"
          >
            <Download className="size-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={toggleOpen}
            className="flex items-center gap-1.5 rounded-full border border-border/80 bg-surface px-3 py-2 text-xs font-medium text-ink shadow-md hover:bg-surface-subtle"
            title="Open search debug panel"
          >
            <Bug className="size-3.5" strokeWidth={2} />
            Search debug
          </button>
        </div>
      ) : null}

      <aside
        className={cn(
          "hidden h-full max-h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-border/60 bg-surface md:flex",
          open ? "w-[var(--agent-debug-width)]" : "w-0 border-l-0",
        )}
        style={{ "--agent-debug-width": `${PANEL_WIDTH}px` } as React.CSSProperties}
        aria-hidden={!open}
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Search debug</h2>
            <p className="text-[10px] text-ink-muted">
              Pipeline stages, fashion catalog, curation, and query planner
            </p>
          </div>
          <div className="flex items-center gap-1">
            {exportStatus ? (
              <span className="mr-1 text-[10px] font-medium text-ink-muted">
                {exportStatus}
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleCopyExport}
              className="rounded-md p-1 text-ink-muted hover:bg-surface-subtle hover:text-ink"
              title="Copy minimized chat+pipeline dump for AI review"
            >
              <ClipboardCopy className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleDownloadExport}
              className="rounded-md p-1 text-ink-muted hover:bg-surface-subtle hover:text-ink"
              title="Download minimized chat+pipeline dump for AI review"
            >
              <Download className="size-4" />
            </button>
            {activeTab === "query_planner" ||
            activeTab === "pipeline" ||
            activeTab === "fashion_catalog" ||
            activeTab === "fashion_curation" ? (
              <button
                type="button"
                onClick={() => void fetchRuns()}
                disabled={loadingRuns}
                className="rounded-md p-1 text-ink-muted hover:bg-surface-subtle hover:text-ink disabled:opacity-50"
                title="Refresh debug runs from database"
              >
                {loadingRuns ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-ink-muted hover:bg-surface-subtle hover:text-ink"
              aria-label="Close debug panel"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        {qaCriteria ? (
          <div className="max-h-48 shrink-0 overflow-y-auto border-b border-border/60 p-3">
            <QaDebugCriteriaPanel model={qaCriteria} />
          </div>
        ) : null}

        <div className="flex shrink-0 gap-1 border-b border-border/60 p-2">
          <button
            type="button"
            onClick={() => setActiveTab("pipeline")}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-medium",
              activeTab === "pipeline"
                ? "bg-surface-subtle text-ink"
                : "text-ink-muted hover:bg-surface-subtle/60",
            )}
          >
            Pipeline
            {pipelineRuns.length ? (
              <span className="ml-1 text-[10px] text-ink-muted">
                ({pipelineRuns.length})
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("fashion_catalog")}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-medium",
              activeTab === "fashion_catalog"
                ? "bg-surface-subtle text-ink"
                : "text-ink-muted hover:bg-surface-subtle/60",
            )}
          >
            Fashion catalog
            {fashionCatalogRuns.length ? (
              <span className="ml-1 text-[10px] text-ink-muted">
                ({fashionCatalogRuns.length})
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("fashion_curation")}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-medium",
              activeTab === "fashion_curation"
                ? "bg-surface-subtle text-ink"
                : "text-ink-muted hover:bg-surface-subtle/60",
            )}
          >
            Curation
            {fashionCurationRuns.length ? (
              <span className="ml-1 text-[10px] text-ink-muted">
                ({fashionCurationRuns.length})
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("query_planner")}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-medium",
              activeTab === "query_planner"
                ? "bg-surface-subtle text-ink"
                : "text-ink-muted hover:bg-surface-subtle/60",
            )}
          >
            Query planner
            {runs.length ? (
              <span className="ml-1 text-[10px] text-ink-muted">({runs.length})</span>
            ) : null}
          </button>
        </div>

        {runsError && activeTab === "query_planner" ? (
          <p className="shrink-0 px-3 py-2 text-xs text-red-600 dark:text-red-300">
            {runsError}
          </p>
        ) : null}

        {activeTab === "fashion_curation" ? (
          fashionCurationRuns.length === 0 ? (
            <p className="shrink-0 px-3 py-8 text-center text-xs text-ink-muted">
              Run a fashion search through hydration to see every candidate the
              curator checked, which images were sent to Opus, picks, vetoes, and
              the full curator input.
            </p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {fashionCurationRuns.length > 1 ? (
                <ul className="max-h-28 shrink-0 list-none overflow-y-auto border-b border-border/60">
                  {fashionCurationRuns.map((run) => (
                    <li key={run.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedFashionCurationId(run.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-surface-subtle",
                          selectedFashionCuration?.id === run.id && "bg-surface-subtle",
                        )}
                      >
                        <span className="min-w-0 truncate font-medium text-ink">
                          {run.slots.map((s) => s.garment).join(", ") || run.mode}
                        </span>
                        <time className="shrink-0 font-mono text-[10px] text-ink-muted">
                          {formatTime(run.ts)}
                        </time>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {selectedFashionCuration ? (
                <FashionCurationDebugPanel run={selectedFashionCuration} />
              ) : null}
            </div>
          )
        ) : activeTab === "fashion_catalog" ? (
          fashionCatalogRuns.length === 0 ? (
            <p className="shrink-0 px-3 py-8 text-center text-xs text-ink-muted">
              Run a fashion search (ready_to_search) to see every search_catalog
              call, full request payloads, and up to 100 products per query.
            </p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {fashionCatalogRuns.length > 1 ? (
                <ul className="max-h-28 shrink-0 list-none overflow-y-auto border-b border-border/60">
                  {fashionCatalogRuns.map((run) => (
                    <li key={run.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedFashionCatalogId(run.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-surface-subtle",
                          selectedFashionCatalog?.id === run.id && "bg-surface-subtle",
                        )}
                      >
                        <span className="min-w-0 truncate font-medium text-ink">
                          {run.slots.map((s) => s.garment).join(", ") || run.mode}
                        </span>
                        <time className="shrink-0 font-mono text-[10px] text-ink-muted">
                          {formatTime(run.ts)}
                        </time>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {selectedFashionCatalog ? (
                <FashionCatalogDebugPanel run={selectedFashionCatalog} />
              ) : null}
            </div>
          )
        ) : activeTab === "pipeline" ? (
          pipelineRuns.length === 0 ? (
            <p className="shrink-0 px-3 py-8 text-center text-xs text-ink-muted">
              Run a product search to see fetched products, verify drops, triage
              verdicts, head-to-head comparisons, and slot assignments.
            </p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {pipelineRuns.length > 1 ? (
                <ul className="max-h-28 shrink-0 list-none overflow-y-auto border-b border-border/60">
                  {pipelineRuns.map((run) => (
                    <li key={run.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedPipelineId(run.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-surface-subtle",
                          selectedPipeline?.id === run.id && "bg-surface-subtle",
                        )}
                      >
                        <span className="min-w-0 truncate font-medium text-ink">
                          {run.query}
                        </span>
                        <time className="shrink-0 font-mono text-[10px] text-ink-muted">
                          {formatTime(run.ts)}
                        </time>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {selectedPipeline ? (
                <SearchPipelinePanel run={selectedPipeline} />
              ) : null}
            </div>
          )
        ) : runs.length === 0 && !loadingRuns ? (
          <p className="px-3 py-8 text-center text-xs text-ink-muted">
            Run a product search to see query-planner prompts (budget angles,
            portfolio, gift planner).
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ul className="max-h-36 shrink-0 list-none overflow-y-auto border-b border-border/60">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-surface-subtle",
                      selectedPlanner?.id === run.id && "bg-surface-subtle",
                    )}
                  >
                    <span className="font-medium capitalize text-ink">
                      {stepLabel(run.step)}
                    </span>
                    <time className="shrink-0 font-mono text-[10px] text-ink-muted">
                      {formatTime(run.ts)}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
            {selectedPlanner ? <QueryPlannerRunDetail run={selectedPlanner} /> : null}
          </div>
        )}

        <footer className="shrink-0 border-t border-border/60 px-3 py-2 text-[10px] text-ink-muted">
          Set{" "}
          <code className="rounded bg-surface-subtle px-1">NEXT_PUBLIC_AGENT_DEBUG=1</code>{" "}
          and <code className="rounded bg-surface-subtle px-1">AGENT_DEBUG=1</code>.
        </footer>
      </aside>
    </>
  );
});

export const AgentDebugToggleRail = memo(function AgentDebugToggleRail() {
  const enabled = useAgentDebugStore((s) => s.enabled);
  const open = useAgentDebugStore((s) => s.open);
  const toggleOpen = useAgentDebugStore((s) => s.toggleOpen);

  if (!enabled || open) return null;

  return (
    <button
      type="button"
      onClick={toggleOpen}
      className="absolute right-0 top-1/2 z-20 hidden -translate-y-1/2 rounded-l-md border border-r-0 border-border/60 bg-surface px-1 py-3 text-ink-muted shadow-sm hover:bg-surface-subtle hover:text-ink md:flex"
      title="Open search debug panel"
      aria-label="Open search debug panel"
    >
      <ChevronRight className="size-4" />
    </button>
  );
});
