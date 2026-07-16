/** Client-side try-on job polling (safe for "use client" components). */

export const TRYON_CLIENT_POLL_MS = 1500;

/**
 * How long the UI keeps polling a dress job. FASHN tryon-max is typically
 * 10–55s; default 6 minutes covers slow runs and retries.
 */
export const TRYON_CLIENT_POLL_MAX_MS = Number(
  process.env.NEXT_PUBLIC_TRYON_POLL_MAX_MS ?? "360000",
);
