export const COOKIE_PREFS_KEY = "shoop.cookie-prefs";

export type CookiePrefs = {
  analytics: boolean;
  preferences: boolean;
  decidedAt: string;
};

export function defaultCookiePrefs(): CookiePrefs {
  return {
    analytics: false,
    preferences: false,
    decidedAt: "",
  };
}

export function parseCookiePrefs(raw: unknown): CookiePrefs {
  const fallback = defaultCookiePrefs();
  if (!raw || typeof raw !== "object") return fallback;
  const row = raw as Record<string, unknown>;
  return {
    analytics: row.analytics === true,
    preferences: row.preferences === true,
    decidedAt: typeof row.decidedAt === "string" ? row.decidedAt : "",
  };
}

export function readCookiePrefs(): CookiePrefs {
  if (typeof window === "undefined") return defaultCookiePrefs();
  try {
    const raw = window.localStorage.getItem(COOKIE_PREFS_KEY);
    if (!raw) return defaultCookiePrefs();
    return parseCookiePrefs(JSON.parse(raw));
  } catch {
    return defaultCookiePrefs();
  }
}

export function writeCookiePrefs(prefs: Omit<CookiePrefs, "decidedAt">): CookiePrefs {
  const next: CookiePrefs = {
    analytics: prefs.analytics,
    preferences: prefs.preferences,
    decidedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(COOKIE_PREFS_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("shoop-cookie-prefs"));
  return next;
}

/** Shoop does not load analytics or advertising scripts today. */
export function analyticsAllowed(prefs: CookiePrefs): boolean {
  return prefs.analytics === true && Boolean(prefs.decidedAt);
}

export function preferencesAllowed(prefs: CookiePrefs): boolean {
  return prefs.preferences === true && Boolean(prefs.decidedAt);
}
