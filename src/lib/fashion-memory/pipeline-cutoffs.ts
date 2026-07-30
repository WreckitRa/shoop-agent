/**
 * Fashion find-pipeline latency cutoffs.
 *
 * Sizing law: cutoff ≈ 2× measured p50; if p50 grows past half the cutoff,
 * shrink the call — never raise the cutoff.
 *
 * Budget law (v1.1): BUDGETS PROTECT DELIVERABLES, NOT CLOCKS.
 * Stage A is REQUIRED for outfit/capsule — earmarked at t=0, never skipped,
 * only shrunk down the degraded ladder.
 */
function envMs(key: string, fallback: number): number {
  const n = Number(process.env[key] ?? "");
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** Catalog query: tripwire fires hedge spare; hard takes best-so-far. */
export const CATALOG_QUERY_HEDGE_MS = envMs("FASHION_CATALOG_HEDGE_MS", 3_000);
export const CATALOG_QUERY_HARD_MS = envMs("FASHION_CATALOG_QUERY_HARD_MS", 10_000);

export const PLANNER_TRIPWIRE_MS = envMs("FASHION_PLANNER_TRIPWIRE_MS", 5_000);
export const PLANNER_HARD_MS = envMs("FASHION_PLANNER_HARD_MS", 8_000);

export const NORMALIZE_TRIPWIRE_MS = envMs("FASHION_NORMALIZE_TRIPWIRE_MS", 6_000);
export const NORMALIZE_HARD_MS = envMs("FASHION_NORMALIZE_HARD_MS", 10_000);

export const HYDRATION_WAVE_TRIPWIRE_MS = envMs(
  "FASHION_HYDRATION_WAVE_TRIPWIRE_MS",
  8_000,
);
export const HYDRATION_WAVE_HARD_MS = envMs("FASHION_HYDRATION_WAVE_HARD_MS", 12_000);

/** Phase 0 interim single curation call (pre Stage A/B split still uses these as outer bounds). */
export const CURATION_TRIPWIRE_MS = envMs("FASHION_CURATION_TRIPWIRE_MS", 40_000);
export const CURATION_HARD_MS = envMs("FASHION_CURATION_HARD_MS", 55_000);
export const CURATION_SHRINK_RETRY_MS = envMs(
  "FASHION_CURATION_SHRINK_RETRY_MS",
  25_000,
);

/** Phase 1 Stage A (picks) / Stage B (voice). */
export const CURATION_STAGE_A_TRIPWIRE_MS = envMs(
  "FASHION_CURATION_STAGE_A_TRIPWIRE_MS",
  18_000,
);
export const CURATION_STAGE_A_HARD_MS = envMs(
  "FASHION_CURATION_STAGE_A_HARD_MS",
  25_000,
);
export const CURATION_STAGE_A_SHRINK_MS = envMs(
  "FASHION_CURATION_STAGE_A_SHRINK_MS",
  15_000,
);
/** Rung 3 — text-only pick (no images). */
export const CURATION_STAGE_A_TEXT_ONLY_MS = envMs(
  "FASHION_CURATION_STAGE_A_TEXT_ONLY_MS",
  6_000,
);
export const CURATION_STAGE_B_HARD_MS = envMs(
  "FASHION_CURATION_STAGE_B_HARD_MS",
  20_000,
);

/**
 * Pocket budgets (Phase 1). Stage A earmark is untouchable by upstream.
 * Pre-curation overruns starve hydration/reformulation — never Stage A.
 */
export const STAGE_A_EARMARK_MS = envMs("FASHION_STAGE_A_EARMARK_MS", 15_000);
export const PRE_CURATION_POCKET_MS = envMs(
  "FASHION_PRE_CURATION_POCKET_MS",
  30_000,
);

/** Legacy flat turn budgets (Phase 0 / reporting only). */
export const TURN_BUDGET_PHASE0_MS = envMs("FASHION_TURN_BUDGET_PHASE0_MS", 60_000);
export const TURN_BUDGET_PHASE1_MS = envMs(
  "FASHION_TURN_BUDGET_PHASE1_MS",
  STAGE_A_EARMARK_MS + PRE_CURATION_POCKET_MS,
);

/** Feature flag: split pick vs voice (Phase 1). Default on. */
export const FASHION_CURATION_SPLIT_ENABLED =
  process.env.FASHION_CURATION_SPLIT_ENABLED !== "0" &&
  process.env.FASHION_CURATION_SPLIT_ENABLED !== "false";

/** Feature flag: emit provisional rack before curation. Default on. */
export const FASHION_PROVISIONAL_RACK_ENABLED =
  process.env.FASHION_PROVISIONAL_RACK_ENABLED !== "0" &&
  process.env.FASHION_PROVISIONAL_RACK_ENABLED !== "false";

/** Stage A rung when remaining earmark is tight. */
export type StageARung =
  | "full"
  | "half_images"
  | "text_only"
  | "deterministic";

export function chooseStageARung(earmarkRemainingMs: number): StageARung {
  if (earmarkRemainingMs >= CURATION_STAGE_A_HARD_MS) return "full";
  if (earmarkRemainingMs >= CURATION_STAGE_A_SHRINK_MS) return "half_images";
  if (earmarkRemainingMs >= CURATION_STAGE_A_TEXT_ONLY_MS) return "text_only";
  return "deterministic";
}
