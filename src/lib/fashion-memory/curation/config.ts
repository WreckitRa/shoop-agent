export { FASHION_CURATION_MODEL } from "../models";
import {
  CURATION_HARD_MS,
  CURATION_TRIPWIRE_MS,
  CURATION_STAGE_A_HARD_MS,
  CURATION_STAGE_A_TRIPWIRE_MS,
  FASHION_CURATION_SPLIT_ENABLED,
} from "../pipeline-cutoffs";

/**
 * Tool JSON + short stylist lines. Phase 0 shrink from 32k — thinking is OFF,
 * so we no longer need headroom for invisible tokens.
 */
export const FASHION_CURATION_MAX_TOKENS = Number(
  process.env.FASHION_CURATION_MAX_TOKENS ?? "2000",
);

/**
 * Thinking / effort OFF — thinking tokens were silent latency + cost.
 * Set FASHION_CURATION_EFFORT=medium|high only if quality gate demands it.
 */
export const FASHION_CURATION_EFFORT = (
  process.env.FASHION_CURATION_EFFORT?.trim() || "off"
) as "off" | "low" | "medium" | "high";

/**
 * Hard wall-clock for a single curation LLM call.
 * Stage A (split): 25s; Phase 0 single call: 55s.
 */
export const CURATION_LLM_TIMEOUT_MS = Number(
  process.env.CURATION_LLM_TIMEOUT_MS ??
    String(
      FASHION_CURATION_SPLIT_ENABLED
        ? CURATION_STAGE_A_HARD_MS
        : CURATION_HARD_MS,
    ),
);

/** Soft tripwire — log + degrade signal; call continues until hard cutoff. */
export const CURATION_LATENCY_TRIPWIRE_MS = Number(
  process.env.CURATION_LATENCY_TRIPWIRE_MS ??
    String(
      FASHION_CURATION_SPLIT_ENABLED
        ? CURATION_STAGE_A_TRIPWIRE_MS
        : CURATION_TRIPWIRE_MS,
    ),
);

/**
 * Max edge for curator product photos. Phase 0: 512px (~350 tok each)
 * vs prior 768 (~800 tok).
 */
export const CURATION_IMAGE_MAX_PX = Number(
  process.env.CURATION_IMAGE_MAX_PX ?? "512",
);

export {
  CURATION_IMAGE_BUDGET,
  CURATION_HERO_PICKS,
  CURATION_LOOKS_TARGET,
  CURATION_VERIFIED_BENCH,
  CURATION_UNVERIFIED_OVERFLOW,
  imageBudgetForSlot,
  curationPickCap,
} from "./deliverables";

export const CURATION_VETO_TRIPWIRE_RATIO = 0.2;

export const CURATION_TOOL_NAME = "deliver_curation";

/** Stage A pick-only tool (Phase 1 split). */
export const CURATION_PICK_TOOL_NAME = "deliver_curation_picks";

/** Stage B voice tool (Phase 1 split). */
export const CURATION_VOICE_TOOL_NAME = "deliver_curation_voice";

/**
 * Cap on Stage B voice generation.
 * Was 300 — too tight for opening + N stylist lines (trace 0562bba7 truncated
 * mid-tool → empty parse → placeholder shipped). 500 covers 5–6 picks.
 */
export const FASHION_CURATION_VOICE_MAX_TOKENS = Number(
  process.env.FASHION_CURATION_VOICE_MAX_TOKENS ?? "500",
);

/** Stage A placeholder opening — Stage B must replace; never ship to user. */
export const STAGE_A_PLACEHOLDER_OPENING = "Fitting room ready.";

/** Stage A placeholder stylist line — Stage B must replace. */
export const STAGE_A_PLACEHOLDER_STYLIST_LINE = "See card.";
