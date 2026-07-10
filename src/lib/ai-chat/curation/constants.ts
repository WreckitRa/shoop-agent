/** Hard cap on a single curator job (model + DB persist). */
export const CURATION_PIPELINE_TIMEOUT_MS = 120_000;

/** Brief defer so the worker does not compete with the final stream persist. */
export const CURATION_WORKER_DEFER_MS = 500;

/** Max jobs processed per worker wake. */
export const CURATION_JOBS_PER_KICK = 2;
