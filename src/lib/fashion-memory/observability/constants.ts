/** Full trace bodies retained for this many days before redaction. */
export const TRACE_RETENTION_DAYS = 30;

export const TRACE_KIND_SEARCH_TURN = "search_turn";

export type TraceStatus = "open" | "complete" | "error";

export type PipelineEventStage =
  | "gate"
  | "brief_persisted"
  | "brief_resumed"
  | "validator"
  | "clamp"
  | "ucp_query"
  | "fallback_brief"
  | "dedupe"
  | "invariant_warning";

export type LlmCallStage =
  | "router"
  | "router_retry"
  | "planner"
  | "planner_retry"
  | "extraction";
