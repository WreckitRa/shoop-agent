"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LEGAL_PATHS } from "@/lib/legal/constants";
import {
  readCookiePrefs,
  writeCookiePrefs,
  type CookiePrefs,
} from "@/lib/legal/cookie-prefs";

const btnClass =
  "h-10 min-w-[140px] rounded-[12px] border border-[#D6D6DE] bg-white px-4 text-[12.5px] font-extrabold text-[var(--fitting-ink)]";

export function CookieBanner() {
  const [prefs, setPrefs] = useState<CookiePrefs | null>(null);
  const [preferences, setPreferences] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    setPrefs(readCookiePrefs());
  }, []);

  if (!prefs || prefs.decidedAt) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] p-4">
      <div className="pointer-events-auto mx-auto max-w-[640px] rounded-[20px] border border-[var(--fitting-line)] bg-white p-4 shadow-[0_18px_40px_-18px_rgba(14,14,17,0.45)]">
        <p className="text-[13px] leading-[1.5] text-[#3A3A44]">
          We use essential cookies to keep you signed in and remember this
          choice. No advertising cookies. Read the{" "}
          <Link
            href={LEGAL_PATHS.cookies}
            className="font-semibold text-[var(--fitting-ink)] underline underline-offset-2"
          >
            Cookie Policy
          </Link>
          .
        </p>
        <ul className="mt-3 space-y-2 text-[12.5px] text-[#3A3A44]">
          <li className="flex items-start justify-between gap-3">
            <span>
              <span className="font-semibold text-[var(--fitting-ink)]">
                Essential
              </span>
              <span className="mt-0.5 block text-[11px] text-[var(--fitting-quiet)]">
                Sign-in, security, cart. Always on.
              </span>
            </span>
            <span className="pt-0.5 text-[11px] font-semibold text-[var(--fitting-quiet)]">
              On
            </span>
          </li>
          <li>
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <span>
                <span className="font-semibold text-[var(--fitting-ink)]">
                  Preferences
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--fitting-quiet)]">
                  Region and display. Optional. None set today.
                </span>
              </span>
              <input
                type="checkbox"
                checked={preferences}
                onChange={(e) => setPreferences(e.target.checked)}
                className="mt-1 size-4 shrink-0"
              />
            </label>
          </li>
          <li>
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <span>
                <span className="font-semibold text-[var(--fitting-ink)]">
                  Analytics
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--fitting-quiet)]">
                  Product usage. Optional. None set today.
                </span>
              </span>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                className="mt-1 size-4 shrink-0"
              />
            </label>
          </li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={btnClass}
            onClick={() =>
              setPrefs(
                writeCookiePrefs({ analytics: false, preferences: false }),
              )
            }
          >
            Essential only
          </button>
          <button
            type="button"
            className={btnClass}
            onClick={() =>
              setPrefs(writeCookiePrefs({ analytics, preferences }))
            }
          >
            Save choices
          </button>
        </div>
      </div>
    </div>
  );
}
