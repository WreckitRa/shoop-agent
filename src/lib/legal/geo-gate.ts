export const SIGNUP_COUNTRY = "US" as const;

export type SignupRegionDecision =
  | { ok: true; countryCode: string | null }
  | { ok: false; countryCode: string; reason: string };

/**
 * Account creation is US-only. Unknown country (local/dev, missing proxy)
 * is allowed so we do not block when geo headers are absent.
 */
export function decideSignupRegion(
  countryCode: string | null | undefined,
): SignupRegionDecision {
  const code = countryCode?.trim().toUpperCase() || null;
  if (!code) return { ok: true, countryCode: null };
  if (code === SIGNUP_COUNTRY) return { ok: true, countryCode: code };
  return {
    ok: false,
    countryCode: code,
    reason:
      "Shoop is available in the United States only. Account creation from other countries is not available.",
  };
}
