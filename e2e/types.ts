import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import type { FashionSearchBrief, FashionRouterResult } from "@/lib/fashion-memory/router/types";
import type { FashionSearchPlan } from "@/lib/fashion-memory/search-planner/types";
import type { FashionCatalogSearchResult } from "@/lib/fashion-memory/catalog-search/types";
import type { RenderContract } from "@/lib/fashion-memory/types/render-contract";
import type { GuestFashionMemorySnapshot } from "@/lib/fashion-memory/local/store";
import type { FakeUcpCatalogConfig } from "../../test/fake-ucp/types";
import type { LlmCallCounter } from "./harness/llm-mock";
import type { SseEvent } from "./harness/sse-turn";

export type E2eMode = "mocked" | "live";

export type LlmRecording = {
  stage: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type E2eSeed = {
  profile_state?: {
    genderPresentation?: string;
    preferredName?: string;
    sizeLines?: string[];
  };
  prior_signals?: Array<{
    attribute_type: string;
    attribute_value: string;
    polarity: number;
  }>;
  shop_departments?: Record<string, "mens" | "womens" | "mixed" | "unknown">;
  guest_facts?: Array<{
    person_id: string;
    fact_type: string;
    value: unknown;
  }>;
};

export type StageMatchers = {
  move?: string;
  slotCountMin?: number;
  slotCountMax?: number;
  mode?: string;
  questionsGapOrder?: string[];
  noReaskGaps?: string[];
  perPieceMax?: number;
  setTotal?: number;
  brandNotePresent?: boolean;
  brandMentioned?: string;
  brandTranslateCalls?: number;
  tension?: string;
  dropRules?: Array<{ rule: string; min?: number; max?: number }>;
  survivorsMin?: number;
  survivorsMax?: number;
  hydrationKills?: string[];
  picksMin?: number;
  picksMax?: number;
  hasCapsuleGrid?: boolean;
  paletteSource?: string;
  plannerProfileContains?: string;
  signalCountMin?: number;
  factCountMin?: number;
  invariantWarningsEmpty?: boolean;
  pipelineStages?: string[];
  hasMarketPrices?: boolean;
  noBudgetLiftRetry?: boolean;
  sseEvents?: string[];
  /** Second (or later) router call must show cache_read_input_tokens > 0. */
  routerCacheReadOnTurn2?: boolean;
};

export type StageExpectations = {
  route?: StageMatchers;
  brief?: Record<string, unknown>;
  plan?: StageMatchers;
  queries?: Array<(q: string) => boolean>;
  funnel?: StageMatchers;
  hydration?: StageMatchers;
  curation?: StageMatchers;
  render?: StageMatchers;
  signals?: StageMatchers;
  memory?: StageMatchers;
  events?: StageMatchers;
  sse?: StageMatchers;
};

export type UserStep = {
  user: string;
  expect?: StageExpectations;
};

export type InteractStep = {
  interact: {
    kind: "reject" | "promote" | "look_swap" | "show_more" | "verify" | "recurate";
    ref?: string;
    demotedRef?: string;
    lookIndex?: number;
    slotId?: string;
  };
  expect?: StageExpectations;
};

export type SimulateStep = {
  simulate: "restart" | "advance_clock";
  args?: { hours?: number };
  expect?: StageExpectations;
};

export type E2eStep = UserStep | InteractStep | SimulateStep;

export type E2eScenario = {
  name: string;
  description: string;
  seed: E2eSeed;
  catalog: FakeUcpCatalogConfig;
  llm_recordings?: {
    router?: LlmRecording[];
    planner?: LlmRecording[];
    extraction?: LlmRecording[];
    curation?: LlmRecording[];
  };
  /** Use ref-aligned curation from hydrated pool (default true). */
  ref_aligned_curation?: boolean;
  curation_options?: {
    brandNote?: string;
    capsuleOutfits?: boolean;
    opening?: string;
  };
  /** Drive createFashionChatSseStream instead of direct pipeline calls. */
  use_sse?: boolean;
  /** Optional per-scenario golden payload fingerprints. */
  golden_payloads?: Record<string, unknown>;
  steps: E2eStep[];
};

export type TurnArtifacts = {
  routerResult?: FashionRouterResult;
  brief?: FashionSearchBrief;
  plan?: FashionSearchPlan;
  catalog?: FashionCatalogSearchResult;
  render?: RenderContract;
  guestSnapshot: GuestFashionMemorySnapshot;
  traceId: string;
  searchId: string;
  conversationId?: string;
  pipelineEvents: Array<{ stage: string; payload: Record<string, unknown> }>;
  signals: Array<{ signalType: string; value: string; polarity: number }>;
  llmCounter?: LlmCallCounter;
  sseEvents?: SseEvent[];
};

export type ScenarioRunResult = {
  scenario: string;
  ok: boolean;
  failures: string[];
  traceId: string;
  artifacts: TurnArtifacts;
  structuralTrace: StructuralTrace;
  payloadFingerprint?: Record<string, unknown>;
};

export type StructuralTrace = {
  stages: string[];
  eventCounts: Record<string, number>;
};
