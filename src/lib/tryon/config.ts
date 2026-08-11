export const TRYON_PROVIDER_TIMEOUT_MS = 30_000;
export const TRYON_PROVIDER_RETRIES = 1;

/** FASHN try-on (run + poll). Docs: 10–55s for tryon-max. */
export const FASHN_TIMEOUT_MS = Number(
  process.env.FASHN_TIMEOUT_MS ?? "120000",
);

/** Per-user daily generation cap (avatar + single + outfit steps). */
export const TRYON_USER_DAILY_CAP = Number(
  process.env.TRYON_USER_DAILY_CAP ?? "30",
);

/** Global daily spend cap in USD — flips tryon off when exceeded. */
export const TRYON_GLOBAL_DAILY_SPEND_CAP = Number(
  process.env.TRYON_GLOBAL_DAILY_SPEND_CAP ?? "50",
);

export const TRYON_PRIVATE_BUCKET =
  process.env.TRYON_STORAGE_BUCKET ?? "tryon-private";

/** Estimated cost per provider call (USD) for guardrails. */
export const TRYON_COST_ESTIMATES = {
  fashn_tryon_max_1k: 0.08,
  fashn_tryon_v16: 0.05,
  /** quality + 1k face-to-model (~3 credits). */
  fashn_face_to_model: 0.12,
  /** fast + 1k edit normalize (~1 credit). */
  fashn_edit_fast_1k: 0.04,
  mock: 0,
} as const;

export const FASHN_API_BASE =
  process.env.FASHN_API_BASE ?? "https://api.fashn.ai/v1";

export const FASHN_MODEL =
  process.env.FASHN_TRYON_MODEL ?? "tryon-max";
