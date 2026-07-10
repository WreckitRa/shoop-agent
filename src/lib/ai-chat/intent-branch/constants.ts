/** Minimum classifier confidence to create a new branch. */
export const INTENT_SHIFT_CONFIDENCE_THRESHOLD = 0.75;

/** Max new branches per conversation per hour. */
export const MAX_INTENT_BRANCHES_PER_HOUR = 8;

/**
 * Minimum ms between branch splits in one conversation.
 * 8s — tight enough to not block rapid topic switches, long enough to
 * prevent duplicate splits on near-simultaneous messages.
 */
export const INTENT_BRANCH_COOLDOWN_MS = 8_000;

export const INTENT_PIPELINE_TIMEOUT_MS = 45_000;

/**
 * Delay before the background worker runs Haiku classification. Keeps intent
 * detection off the hot path while the user reads the reply or sends again.
 */
export const INTENT_WORKER_DEFER_MS = 4_000;

/** Max jobs processed per deferred worker wake (keeps CPU/API quota low). */
export const INTENT_JOBS_PER_KICK = 1;

export function isIntentBranchEnabled(): boolean {
  return process.env.AI_CHAT_INTENT_BRANCH_ENABLED !== "0";
}

export function isIntentBranchDryRun(): boolean {
  return process.env.AI_CHAT_INTENT_BRANCH_DRY_RUN === "1";
}
