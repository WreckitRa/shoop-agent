import type { PromptRunKind } from "@prisma/client";
import type { FashionCatalogDebugV1 } from "@/lib/fashion-memory/catalog-search/fashion-catalog-debug";
import { fashionCatalogDebugFromSse } from "@/lib/fashion-memory/catalog-search/fashion-catalog-debug";
import type { FashionCurationDebugV1 } from "@/lib/fashion-memory/curation/fashion-curation-debug";
import { fashionCurationDebugFromSse } from "@/lib/fashion-memory/curation/fashion-curation-debug";
import type { SearchPipelineDebugV1 } from "./search/pipeline-debug";
import { searchPipelineDebugFromSse } from "./search/pipeline-debug";

export type { SearchPipelineDebugV1 } from "./search/pipeline-debug";
export {
  pipelineDebugForPersist,
  searchPipelineDebugFromSse,
} from "./search/pipeline-debug";

/** Server-side gate — emit debug SSE + persist query-planner audit. */
export function isAgentDebugEnabled(): boolean {
  return (
    process.env.AGENT_DEBUG === "1" ||
    process.env.NEXT_PUBLIC_AGENT_DEBUG === "1"
  );
}

/** Client-side gate — show the debug panel UI. */
export function isAgentDebugUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AGENT_DEBUG === "1";
}

export const QUERY_PLANNER_PROMPT_KIND: PromptRunKind = "search_query_planner";
export const SEARCH_PIPELINE_PROMPT_KIND: PromptRunKind = "search_pipeline";

export type QueryPlannerStep =
  | "budget_angles"
  | "portfolio"
  | "gift_portfolio"
  | "gift_portfolio_retry";

export type QueryPlannerRunView = {
  id: string;
  step: QueryPlannerStep | string;
  model: string;
  promptText: string;
  resultText: string;
  ts: number;
  sequence?: number;
};

export type AgentPromptRunDto = {
  id: string;
  kind: PromptRunKind;
  model: string | null;
  sequence: number;
  iteration: number | null;
  promptText: string;
  resultText: string;
  metadata: unknown;
  createdAt: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
};

export type AgentDebugRunsResponse = {
  promptRuns: AgentPromptRunDto[];
  pipelineRuns: AgentPromptRunDto[];
};

export type SearchPipelineRunView = SearchPipelineDebugV1 & {
  id: string;
};

export type FashionCatalogRunView = FashionCatalogDebugV1 & {
  id: string;
};

export type FashionCurationRunView = FashionCurationDebugV1 & {
  id: string;
};

export function searchPipelineRunFromSse(
  data: Record<string, unknown>,
  ts: number,
): SearchPipelineRunView | null {
  const pipeline = searchPipelineDebugFromSse(data);
  if (!pipeline) return null;
  return {
    ...pipeline,
    id: `sp-${pipeline.searchKey}-${ts}`,
    ts: typeof pipeline.ts === "number" ? pipeline.ts : ts,
  };
}

export function queryPlannerRunFromSseData(
  data: Record<string, unknown>,
  ts: number,
): QueryPlannerRunView | null {
  const promptText =
    typeof data.promptText === "string" ? data.promptText : null;
  const resultText =
    typeof data.resultText === "string" ? data.resultText : null;
  if (!promptText || !resultText) return null;

  return {
    id: `qp-${ts}-${typeof data.step === "string" ? data.step : "run"}`,
    step: typeof data.step === "string" ? data.step : "planner",
    model: typeof data.model === "string" ? data.model : "unknown",
    promptText,
    resultText,
    ts,
  };
}

export function searchPipelineRunFromDto(
  run: AgentPromptRunDto,
): SearchPipelineRunView | null {
  try {
    const parsed = JSON.parse(run.resultText) as SearchPipelineDebugV1;
    const pipeline = searchPipelineDebugFromSse(parsed);
    if (!pipeline) return null;
    return {
      ...pipeline,
      id: run.id,
      ts: new Date(run.createdAt).getTime(),
    };
  } catch {
    return null;
  }
}

export function queryPlannerRunFromDto(
  run: AgentPromptRunDto,
): QueryPlannerRunView {
  const meta =
    run.metadata && typeof run.metadata === "object"
      ? (run.metadata as Record<string, unknown>)
      : null;
  const step =
    typeof meta?.step === "string" ? meta.step : run.kind;

  return {
    id: run.id,
    step,
    model: run.model ?? "unknown",
    promptText: run.promptText,
    resultText: run.resultText,
    ts: new Date(run.createdAt).getTime(),
    sequence: run.sequence,
  };
}

export function fashionCatalogRunFromSse(
  data: Record<string, unknown>,
  ts: number,
): FashionCatalogRunView | null {
  const run = fashionCatalogDebugFromSse(data);
  if (!run) return null;
  return {
    ...run,
    id: `fc-${run.searchKey}-${ts}`,
    ts: typeof run.ts === "number" ? run.ts : ts,
  };
}

export function fashionCurationRunFromSse(
  data: Record<string, unknown>,
  ts: number,
): FashionCurationRunView | null {
  const run = fashionCurationDebugFromSse(data);
  if (!run) return null;
  return {
    ...run,
    id: `fcur-${run.searchKey}-${ts}`,
    ts: typeof run.ts === "number" ? run.ts : ts,
  };
}
