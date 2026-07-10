"use client";

import { create } from "zustand";
import {
  isAgentDebugUiEnabled,
  pipelineDebugForPersist,
  queryPlannerRunFromDto,
  queryPlannerRunFromSseData,
  searchPipelineRunFromDto,
  searchPipelineRunFromSse,
  fashionCatalogRunFromSse,
  fashionCurationRunFromSse,
  type AgentDebugRunsResponse,
  type FashionCatalogRunView,
  type FashionCurationRunView,
  type QueryPlannerRunView,
  type SearchPipelineRunView,
} from "@/lib/ai-chat/agent-debug";
import {
  mergeFashionCatalogRuns,
  readFashionCatalogDebugCache,
  writeFashionCatalogDebugCache,
} from "@/lib/client/fashion-catalog-debug-cache";
import {
  mergeFashionCurationRuns,
  readFashionCurationDebugCache,
  writeFashionCurationDebugCache,
} from "@/lib/client/fashion-curation-debug-cache";
import {
  mergePipelineRuns,
  readPipelineDebugCache,
  upsertPipelineDebugCache,
  writePipelineDebugCache,
} from "@/lib/client/pipeline-debug-cache";
import { fashionCatalogDebugForPersist } from "@/lib/fashion-memory/catalog-search/fashion-catalog-debug";
import { fashionCurationDebugForPersist } from "@/lib/fashion-memory/curation/fashion-curation-debug";
import { guestFetch } from "@/lib/client/guest-fetch";

export type AgentDebugTab =
  | "pipeline"
  | "query_planner"
  | "fashion_catalog"
  | "fashion_curation";

export type AgentDebugState = {
  enabled: boolean;
  open: boolean;
  activeTab: AgentDebugTab;
  conversationId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  queryPlannerRuns: QueryPlannerRunView[];
  pipelineRuns: SearchPipelineRunView[];
  fashionCatalogRuns: FashionCatalogRunView[];
  fashionCurationRuns: FashionCurationRunView[];
  loadingRuns: boolean;
  runsError: string | null;
  selectedRunId: string | null;
  selectedPipelineId: string | null;
  selectedFashionCatalogId: string | null;
  selectedFashionCurationId: string | null;

  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setActiveTab: (tab: AgentDebugTab) => void;
  beginTurn: (args: {
    conversationId?: string | null;
    userMessageId?: string | null;
    assistantMessageId?: string | null;
  }) => void;
  addQueryPlannerRun: (run: QueryPlannerRunView) => void;
  addPipelineRun: (run: SearchPipelineRunView, conversationId?: string | null) => void;
  addFashionCatalogRun: (
    run: FashionCatalogRunView,
    conversationId?: string | null,
  ) => void;
  addFashionCurationRun: (
    run: FashionCurationRunView,
    conversationId?: string | null,
  ) => void;
  hydratePipelineFromCache: (conversationId: string) => void;
  hydrateFashionCatalogFromCache: (conversationId: string) => void;
  hydrateFashionCurationFromCache: (conversationId: string) => void;
  ingestQueryPlannerSse: (data: Record<string, unknown>, ts?: number) => void;
  ingestPipelineSse: (
    data: Record<string, unknown>,
    ts?: number,
    conversationId?: string | null,
  ) => void;
  ingestFashionCatalogSse: (
    data: Record<string, unknown>,
    ts?: number,
    conversationId?: string | null,
  ) => void;
  ingestFashionCurationSse: (
    data: Record<string, unknown>,
    ts?: number,
    conversationId?: string | null,
  ) => void;
  fetchRuns: (args?: {
    conversationId?: string | null;
    userMessageId?: string | null;
    assistantMessageId?: string | null;
  }) => Promise<void>;
  setSelectedRunId: (id: string | null) => void;
  setSelectedPipelineId: (id: string | null) => void;
  setSelectedFashionCatalogId: (id: string | null) => void;
  setSelectedFashionCurationId: (id: string | null) => void;
  clear: () => void;
};

function selectLatestFashionCatalogId(
  runs: FashionCatalogRunView[],
  fallback: string | null,
): string | null {
  return runs[runs.length - 1]?.id ?? fallback;
}

function selectLatestFashionCurationId(
  runs: FashionCurationRunView[],
  fallback: string | null,
): string | null {
  return runs[runs.length - 1]?.id ?? fallback;
}

function selectLatestPipelineId(
  runs: SearchPipelineRunView[],
  fallback: string | null,
): string | null {
  return runs[runs.length - 1]?.id ?? fallback;
}

export const useAgentDebugStore = create<AgentDebugState>((set, get) => ({
  enabled: isAgentDebugUiEnabled(),
  open: isAgentDebugUiEnabled(),
  activeTab: "pipeline",
  conversationId: null,
  userMessageId: null,
  assistantMessageId: null,
  queryPlannerRuns: [],
  pipelineRuns: [],
  fashionCatalogRuns: [],
  fashionCurationRuns: [],
  loadingRuns: false,
  runsError: null,
  selectedRunId: null,
  selectedPipelineId: null,
  selectedFashionCatalogId: null,
  selectedFashionCurationId: null,

  toggleOpen: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  beginTurn: (args) =>
    set((s) => ({
      queryPlannerRuns: [],
      runsError: null,
      selectedRunId: null,
      conversationId: args.conversationId ?? s.conversationId,
      userMessageId: args.userMessageId ?? s.userMessageId,
      assistantMessageId: args.assistantMessageId ?? s.assistantMessageId,
    })),

  addQueryPlannerRun: (run) =>
    set((s) => ({
      queryPlannerRuns: [...s.queryPlannerRuns, run],
      selectedRunId: s.selectedRunId ?? run.id,
    })),

  addPipelineRun: (run, conversationId) => {
    const cid = conversationId ?? get().conversationId;
    const slim: SearchPipelineRunView = {
      ...pipelineDebugForPersist(run),
      id: run.id,
      ts: run.ts,
    };
    const pipelineRuns =
      cid != null ? upsertPipelineDebugCache(cid, slim) : [...get().pipelineRuns, slim];
    set({
      pipelineRuns,
      selectedPipelineId: slim.id,
      activeTab: "pipeline",
    });
  },

  addFashionCatalogRun: (run, conversationId) => {
    const cid = conversationId ?? get().conversationId;
    let fashionCatalogRuns: FashionCatalogRunView[];

    if (cid != null) {
      const cached = readFashionCatalogDebugCache(cid);
      const slim: FashionCatalogRunView = {
        ...fashionCatalogDebugForPersist(run),
        id: run.id,
        ts: run.ts,
      };
      const merged = mergeFashionCatalogRuns(cached, [slim]);
      writeFashionCatalogDebugCache(cid, merged);
      fashionCatalogRuns = merged.map((cachedRun) =>
        cachedRun.searchKey === run.searchKey ? run : cachedRun,
      );
    } else {
      fashionCatalogRuns = [...get().fashionCatalogRuns, run];
    }

    set({
      fashionCatalogRuns,
      selectedFashionCatalogId: run.id,
      activeTab: "fashion_catalog",
    });
  },

  hydratePipelineFromCache: (conversationId) => {
    const pipelineRuns = readPipelineDebugCache(conversationId);
    if (!pipelineRuns.length) return;
    set((state) => ({
      conversationId,
      pipelineRuns,
      selectedPipelineId: selectLatestPipelineId(
        pipelineRuns,
        state.selectedPipelineId,
      ),
    }));
  },

  hydrateFashionCatalogFromCache: (conversationId) => {
    const fashionCatalogRuns = readFashionCatalogDebugCache(conversationId);
    if (!fashionCatalogRuns.length) return;
    set((state) => ({
      conversationId,
      fashionCatalogRuns,
      selectedFashionCatalogId: selectLatestFashionCatalogId(
        fashionCatalogRuns,
        state.selectedFashionCatalogId,
      ),
    }));
  },

  ingestQueryPlannerSse: (data, ts = Date.now()) => {
    const run = queryPlannerRunFromSseData(data, ts);
    if (!run) return;
    get().addQueryPlannerRun(run);
  },

  ingestPipelineSse: (data, ts = Date.now(), conversationId) => {
    const run = searchPipelineRunFromSse(data, ts);
    if (!run) return;
    get().addPipelineRun(run, conversationId ?? get().conversationId);
  },

  ingestFashionCatalogSse: (data, ts = Date.now(), conversationId) => {
    const run = fashionCatalogRunFromSse(data, ts);
    if (!run) return;
    get().addFashionCatalogRun(run, conversationId ?? get().conversationId);
  },

  addFashionCurationRun: (run, conversationId) => {
    const cid = conversationId ?? get().conversationId;
    let fashionCurationRuns: FashionCurationRunView[];

    if (cid != null) {
      const cached = readFashionCurationDebugCache(cid);
      const slim: FashionCurationRunView = {
        ...fashionCurationDebugForPersist(run),
        id: run.id,
        ts: run.ts,
      };
      const merged = mergeFashionCurationRuns(cached, [slim]);
      writeFashionCurationDebugCache(cid, merged);
      fashionCurationRuns = merged.map((cachedRun) =>
        cachedRun.searchKey === run.searchKey ? run : cachedRun,
      );
    } else {
      fashionCurationRuns = [...get().fashionCurationRuns, run];
    }

    set({
      fashionCurationRuns,
      selectedFashionCurationId: run.id,
      activeTab: "fashion_curation",
    });
  },

  hydrateFashionCurationFromCache: (conversationId) => {
    const fashionCurationRuns = readFashionCurationDebugCache(conversationId);
    if (!fashionCurationRuns.length) return;
    set((state) => ({
      conversationId,
      fashionCurationRuns,
      selectedFashionCurationId: selectLatestFashionCurationId(
        fashionCurationRuns,
        state.selectedFashionCurationId,
      ),
    }));
  },

  ingestFashionCurationSse: (data, ts = Date.now(), conversationId) => {
    const run = fashionCurationRunFromSse(data, ts);
    if (!run) return;
    get().addFashionCurationRun(run, conversationId ?? get().conversationId);
  },

  fetchRuns: async (args) => {
    const s = get();
    const conversationId = args?.conversationId ?? s.conversationId;
    const userMessageId = args?.userMessageId ?? s.userMessageId;
    const assistantMessageId = args?.assistantMessageId ?? s.assistantMessageId;
    if (!conversationId) return;

    const cached = readPipelineDebugCache(conversationId);
    const fashionCached = readFashionCatalogDebugCache(conversationId);
    const fashionCurationCached = readFashionCurationDebugCache(conversationId);
    set({
      loadingRuns: true,
      runsError: null,
      conversationId,
      pipelineRuns: cached.length ? cached : s.pipelineRuns,
      fashionCatalogRuns: fashionCached.length
        ? fashionCached
        : s.fashionCatalogRuns,
      fashionCurationRuns: fashionCurationCached.length
        ? fashionCurationCached
        : s.fashionCurationRuns,
      selectedPipelineId: selectLatestPipelineId(cached, s.selectedPipelineId),
      selectedFashionCatalogId: selectLatestFashionCatalogId(
        fashionCached,
        s.selectedFashionCatalogId,
      ),
      selectedFashionCurationId: selectLatestFashionCurationId(
        fashionCurationCached,
        s.selectedFashionCurationId,
      ),
    });

    try {
      const params = new URLSearchParams({ conversationId });
      if (userMessageId) params.set("userMessageId", userMessageId);
      if (assistantMessageId) params.set("assistantMessageId", assistantMessageId);

      const res = await guestFetch(`/api/debug/agent-runs?${params.toString()}`);
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? "Debug API unavailable (set AGENT_DEBUG=1)."
            : "Failed to load debug runs.",
        );
      }
      const body = (await res.json()) as AgentDebugRunsResponse;
      const runs = body.promptRuns.map(queryPlannerRunFromDto);
      const fromDb = body.pipelineRuns
        .map(searchPipelineRunFromDto)
        .filter((run): run is SearchPipelineRunView => run != null);
      const pipelineRuns = mergePipelineRuns(cached, fromDb);
      writePipelineDebugCache(conversationId, pipelineRuns);
      set((state) => ({
        queryPlannerRuns: runs,
        pipelineRuns,
        loadingRuns: false,
        selectedRunId: runs[0]?.id ?? state.selectedRunId,
        selectedPipelineId: selectLatestPipelineId(
          pipelineRuns,
          state.selectedPipelineId,
        ),
      }));
    } catch (e) {
      set({
        loadingRuns: false,
        runsError:
          e instanceof Error ? e.message : "Failed to load debug runs.",
        pipelineRuns: cached.length ? cached : get().pipelineRuns,
        selectedPipelineId: selectLatestPipelineId(
          cached,
          get().selectedPipelineId,
        ),
      });
    }
  },

  setSelectedRunId: (id) => set({ selectedRunId: id }),
  setSelectedPipelineId: (id) => set({ selectedPipelineId: id }),
  setSelectedFashionCatalogId: (id) => set({ selectedFashionCatalogId: id }),
  setSelectedFashionCurationId: (id) => set({ selectedFashionCurationId: id }),
  clear: () =>
    set({
      queryPlannerRuns: [],
      pipelineRuns: [],
      fashionCatalogRuns: [],
      fashionCurationRuns: [],
      runsError: null,
      selectedRunId: null,
      selectedPipelineId: null,
      selectedFashionCatalogId: null,
      selectedFashionCurationId: null,
      userMessageId: null,
      assistantMessageId: null,
    }),
}));

export function ingestAgentDebugFromSse(payload: Record<string, unknown>) {
  const debug = useAgentDebugStore.getState();
  if (!debug.enabled) return;

  const conversationId =
    typeof payload.conversationId === "string" ? payload.conversationId : null;

  if (conversationId) {
    useAgentDebugStore.setState({ conversationId });
  }
  if (typeof payload.userMessageId === "string") {
    useAgentDebugStore.setState({ userMessageId: payload.userMessageId });
  }
  if (typeof payload.assistantMessageId === "string") {
    useAgentDebugStore.setState({ assistantMessageId: payload.assistantMessageId });
  }

  if (payload.stage === "query_planner" && payload.data && typeof payload.data === "object") {
    debug.ingestQueryPlannerSse(
      payload.data as Record<string, unknown>,
      typeof payload.ts === "number" ? payload.ts : Date.now(),
    );
  }

  if (payload.stage === "search_pipeline" && payload.data && typeof payload.data === "object") {
    debug.ingestPipelineSse(
      payload.data as Record<string, unknown>,
      typeof payload.ts === "number" ? payload.ts : Date.now(),
      conversationId,
    );
  }

  if (payload.stage === "fashion_catalog" && payload.data && typeof payload.data === "object") {
    debug.ingestFashionCatalogSse(
      payload.data as Record<string, unknown>,
      typeof payload.ts === "number" ? payload.ts : Date.now(),
      conversationId,
    );
  }

  if (payload.stage === "fashion_curation" && payload.data && typeof payload.data === "object") {
    debug.ingestFashionCurationSse(
      payload.data as Record<string, unknown>,
      typeof payload.ts === "number" ? payload.ts : Date.now(),
      conversationId,
    );
  }
}
