/** Public legal document version. Logged with biometric consent ticks. */
export const LEGAL_DOC_VERSION = "2026-08-24";

export const LEGAL_LAST_UPDATED = "August 24, 2026";

export const LEGAL_CONTACT_EMAIL = "hello@shoop.email";

export const MIN_ACCOUNT_AGE = 13;

/** Source face photograph must be destroyed within this window. */
export const PHOTO_MAX_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Share links become permanently unavailable after this. */
export const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** BIPA outer bound: biometric data destroyed after this much inactivity. */
export const BIOMETRIC_INACTIVITY_MS = 3 * 365 * 24 * 60 * 60 * 1000;

/**
 * FASHN's public API is run + status only. There is no deletion instruction
 * we can call or verify. Their docs: CDN outputs expire after 3 days;
 * request history stays in their dashboard until deleted by hand.
 */
export const FASHN_DELETION_NOTE =
  "FASHN has no deletion API. CDN outputs expire after 3 days. Request history may remain in their dashboard. Our copies are deleted.";

export const TERMS_NOTICE_DAYS = 30;

export const LEGAL_PATHS = {
  terms: "/legal/terms",
  privacy: "/legal/privacy",
  biometric: "/legal/biometric",
  sharing: "/legal/sharing",
  cookies: "/legal/cookies",
} as const;

export type LegalSlug = keyof typeof LEGAL_PATHS;

export const LEGAL_NAV: Array<{
  slug: LegalSlug;
  href: (typeof LEGAL_PATHS)[LegalSlug];
  label: string;
  short: string;
}> = [
  { slug: "terms", href: LEGAL_PATHS.terms, label: "Terms of Service", short: "Terms" },
  { slug: "privacy", href: LEGAL_PATHS.privacy, label: "Privacy Policy", short: "Privacy" },
  {
    slug: "biometric",
    href: LEGAL_PATHS.biometric,
    label: "Biometric Consent",
    short: "Biometric",
  },
  {
    slug: "sharing",
    href: LEGAL_PATHS.sharing,
    label: "Sharing & Community",
    short: "Sharing",
  },
  { slug: "cookies", href: LEGAL_PATHS.cookies, label: "Cookie Policy", short: "Cookies" },
];
