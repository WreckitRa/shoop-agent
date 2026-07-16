/**
 * Shared pipeline event payload shapes — emitter and readers import these
 * so key names cannot drift (hydration `killed` vs `deaths_by_cause` etc.).
 */

import type { HydrationMetrics } from "../hydration/types";

/** Payload for stage:"hydration" — matches HydrationMetrics + slot ids. */
export type HydrationPipelinePayload = {
  slot_id: string;
  garment: string;
} & HydrationMetrics;

/** Payload for stage:"hard_drops". */
export type HardDropsPipelinePayload = {
  slot_id?: string;
  garment?: string;
  drops_by_rule?: Record<string, number>;
  survivors?: number;
  market_prices?: {
    p10: number;
    p50: number;
    p90: number;
    min_viable: number;
    sample_size: number;
  };
  guard_band_count?: number;
  enforced_max?: number;
  guard_max?: number;
};

/** Payload for stage:"curator_veto". */
export type CuratorVetoPipelinePayload = {
  ref: string;
  reason: string;
  evidence?: string;
  product_id?: string;
  slot_id?: string;
};

/** Payload for stage:"style_signal_written". */
export type StyleSignalWrittenPayload = {
  signal_type: string;
  value: string;
  polarity: number;
  source: string;
  interaction_kind?: string;
  person_id?: string;
  search_id?: string;
  ref?: string;
};

/** Compact chat-bound event (truncated payload). */
export type CompactPipelineEvent = {
  stage: string;
  payload: Record<string, unknown>;
  truncated?: boolean;
};

export const PIPELINE_EVENT_CHAT_MAX = 80;
export const PIPELINE_EVENT_PAYLOAD_MAX_CHARS = 1800;

export function compactPipelineEventPayload(
  payload: Record<string, unknown>,
): { payload: Record<string, unknown>; truncated: boolean } {
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    return { payload: { _error: "unserializable" }, truncated: true };
  }
  if (json.length <= PIPELINE_EVENT_PAYLOAD_MAX_CHARS) {
    return { payload, truncated: false };
  }
  return {
    payload: {
      _truncated: true,
      _hint: "view in admin",
      preview: json.slice(0, PIPELINE_EVENT_PAYLOAD_MAX_CHARS),
    },
    truncated: true,
  };
}
