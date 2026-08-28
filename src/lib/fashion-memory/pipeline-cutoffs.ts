/**
 * Fashion find-pipeline latency cutoffs.
 *
 * Quality law: never abort a required LLM/vision stage early just to hit a
 * clock. Short cutoffs that force deterministic fallback / text-only / half
 * images destroy department vetoes and taste — that is how Meshki landed as
 * look #1 on cmsod35.
 *
 * Hang-safety law: every LLM call still has a long outer abort so a wedged
 * provider cannot hold the SSE stream forever. Prefer waiting over shipping
 * a blind rack.
 */
function envMs(key: string, fallback: number): number {
  const n = Number(process.env[key] ?? "");
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** Catalog query: tripwire fires hedge spare; hard takes best-so-far. */
export const CATALOG_QUERY_HEDGE_MS = envMs("FASHION_CATALOG_HEDGE_MS", 3_000);
export const CATALOG_QUERY_HARD_MS = envMs("FASHION_CATALOG_QUERY_HARD_MS", 20_000);

export const PLANNER_TRIPWIRE_MS = envMs("FASHION_PLANNER_TRIPWIRE_MS", 12_000);
/** Hang-safety only — deterministic builder runs if this fires. */
export const PLANNER_HARD_MS = envMs("FASHION_PLANNER_HARD_MS", 45_000);

export const NORMALIZE_TRIPWIRE_MS = envMs("FASHION_NORMALIZE_TRIPWIRE_MS", 12_000);
export const NORMALIZE_HARD_MS = envMs("FASHION_NORMALIZE_HARD_MS", 45_000);

/** Taste rerank hang-safety — fail-open to prior score. */
export const TASTE_RERANK_HARD_MS = envMs("FASHION_TASTE_RERANK_HARD_MS", 20_000);

export const HYDRATION_WAVE_TRIPWIRE_MS = envMs(
  "FASHION_HYDRATION_WAVE_TRIPWIRE_MS",
  20_000,
);
/** Hang-safety — unverified items must not pad the live rail. */
export const HYDRATION_WAVE_HARD_MS = envMs("FASHION_HYDRATION_WAVE_HARD_MS", 60_000);

/**
 * Outer hang-safety for a single curation (Stage A / monophase) LLM attempt.
 * Not a quality budget — do not lower this to "feel snappy."
 */
export const CURATION_SAFETY_MS = envMs("FASHION_CURATION_SAFETY_MS", 180_000);

/** @deprecated Use CURATION_SAFETY_MS — kept as alias for older env keys. */
export const CURATION_TRIPWIRE_MS = envMs(
  "FASHION_CURATION_TRIPWIRE_MS",
  CURATION_SAFETY_MS,
);
/** @deprecated Use CURATION_SAFETY_MS. */
export const CURATION_HARD_MS = envMs(
  "FASHION_CURATION_HARD_MS",
  CURATION_SAFETY_MS,
);
/** @deprecated Shrink retries no longer use a shorter clock. */
export const CURATION_SHRINK_RETRY_MS = envMs(
  "FASHION_CURATION_SHRINK_RETRY_MS",
  CURATION_SAFETY_MS,
);

/** Stage A tripwire is log-only (never aborts). */
export const CURATION_STAGE_A_TRIPWIRE_MS = envMs(
  "FASHION_CURATION_STAGE_A_TRIPWIRE_MS",
  60_000,
);
/** Stage A hang-safety — same ceiling as CURATION_SAFETY_MS unless overridden. */
export const CURATION_STAGE_A_HARD_MS = envMs(
  "FASHION_CURATION_STAGE_A_HARD_MS",
  CURATION_SAFETY_MS,
);
/** @deprecated Time-pressure half-image rung removed; alias kept for env compat. */
export const CURATION_STAGE_A_SHRINK_MS = envMs(
  "FASHION_CURATION_STAGE_A_SHRINK_MS",
  CURATION_SAFETY_MS,
);
/** @deprecated Text-only rung removed; alias kept for env compat. */
export const CURATION_STAGE_A_TEXT_ONLY_MS = envMs(
  "FASHION_CURATION_STAGE_A_TEXT_ONLY_MS",
  CURATION_SAFETY_MS,
);
/** Stage B voice hang-safety — picks already locked; copy may fall back. */
export const CURATION_STAGE_B_HARD_MS = envMs(
  "FASHION_CURATION_STAGE_B_HARD_MS",
  60_000,
);

/**
 * Observability pockets only — no longer starve or degrade Stage A vision.
 */
export const STAGE_A_EARMARK_MS = envMs("FASHION_STAGE_A_EARMARK_MS", 15_000);
export const PRE_CURATION_POCKET_MS = envMs(
  "FASHION_PRE_CURATION_POCKET_MS",
  30_000,
);

/** Feature flag: split pick vs voice (Phase 1). Default on. */
export const FASHION_CURATION_SPLIT_ENABLED =
  process.env.FASHION_CURATION_SPLIT_ENABLED !== "0" &&
  process.env.FASHION_CURATION_SPLIT_ENABLED !== "false";

/** Feature flag: emit provisional rack before curation. Default on. */
export const FASHION_PROVISIONAL_RACK_ENABLED =
  process.env.FASHION_PROVISIONAL_RACK_ENABLED !== "0" &&
  process.env.FASHION_PROVISIONAL_RACK_ENABLED !== "false";

/**
 * Stage A always runs full vision. Time pressure must not strip images or
 * force deterministic fallback — that path ships unmarked inventory.
 */
export type StageARung =
  | "full"
  | "half_images"
  | "text_only"
  | "deterministic";

export function chooseStageARung(_earmarkRemainingMs: number): StageARung {
  return "full";
}
