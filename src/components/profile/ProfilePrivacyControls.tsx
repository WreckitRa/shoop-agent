"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  SettingsActionRow,
  SettingsCard,
  SettingsCardHeader,
} from "@/components/profile/profile-settings-ui";
import { LEGAL_CONTACT_EMAIL, LEGAL_PATHS, MIN_ACCOUNT_AGE } from "@/lib/legal/constants";
import {
  readCookiePrefs,
  writeCookiePrefs,
} from "@/lib/legal/cookie-prefs";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useAppSessionStore } from "@/lib/client/app-session";

type SizingForm = {
  heightCm: string;
  bodyType: string;
  shoulderWidth: string;
};

export function ProfilePrivacyControls() {
  const mode = useAppSessionStore((s) => s.mode);
  const signedIn = mode === "authenticated" || mode === "local";
  const [prefs, setPrefs] = useState(readCookiePrefs);
  const [biometricOn, setBiometricOn] = useState(false);
  const [sizing, setSizing] = useState<SizingForm>({
    heightCm: "",
    bodyType: "",
    shoulderWidth: "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onPrefs = () => setPrefs(readCookiePrefs());
    window.addEventListener("shoop-cookie-prefs", onPrefs);
    return () => window.removeEventListener("shoop-cookie-prefs", onPrefs);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void guestFetch("/api/privacy/biometric-consent", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { accepted?: boolean };
        setBiometricOn(Boolean(json.accepted));
      })
      .catch(() => undefined);
    void guestFetch("/api/profile", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as {
          sizing?: {
            heightCm?: number | null;
            bodyType?: string | null;
            shoulderWidth?: string | null;
          };
        };
        const s = json.sizing;
        if (!s) return;
        setSizing({
          heightCm: s.heightCm != null ? String(s.heightCm) : "",
          bodyType: s.bodyType ?? "",
          shoulderWidth: s.shoulderWidth ?? "",
        });
      })
      .catch(() => undefined);
  }, [signedIn]);

  async function exportData() {
    setBusy("export");
    setMessage(null);
    try {
      const res = await guestFetch("/api/privacy/export");
      if (!res.ok) throw new Error("Could not export.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "shoop-data.json";
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Download started.");
    } catch {
      setMessage("Could not export your data.");
    } finally {
      setBusy(null);
    }
  }

  async function withdrawBiometric() {
    if (
      !window.confirm(
        "Withdraw biometric consent? Your twin, measurements from the photo, and renders will be deleted. Your account stays open.",
      )
    ) {
      return;
    }
    setBusy("withdraw");
    setMessage(null);
    try {
      const res = await guestFetch("/api/privacy/biometric-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw" }),
      });
      if (!res.ok) throw new Error("failed");
      setBiometricOn(false);
      setMessage("Biometric data deleted. Your account is still here.");
    } catch {
      setMessage("Could not withdraw consent.");
    } finally {
      setBusy(null);
    }
  }

  async function saveSizing() {
    setBusy("sizing");
    setMessage(null);
    try {
      const height = Number(sizing.heightCm);
      const res = await guestFetch("/api/profile/sizing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          heightCm:
            Number.isFinite(height) && height > 0 ? Math.round(height) : null,
          bodyType: sizing.bodyType.trim() || null,
          shoulderWidth: sizing.shoulderWidth.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setMessage("Measurements saved.");
    } catch {
      setMessage("Could not save measurements.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <SettingsCard>
        <SettingsCardHeader
          title="Fit measurements"
          description="Inferred from your face photo and questionnaire. Correct anything that's wrong. Weight is optional and never used for styling."
        />
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-3 sm:px-6">
          <label className="block text-xs font-semibold text-ink-muted">
            Height (cm)
            <input
              value={sizing.heightCm}
              onChange={(e) =>
                setSizing((s) => ({ ...s, heightCm: e.target.value }))
              }
              inputMode="numeric"
              className="input mt-1.5 w-full rounded-xl"
            />
          </label>
          <label className="block text-xs font-semibold text-ink-muted">
            Build
            <input
              value={sizing.bodyType}
              onChange={(e) =>
                setSizing((s) => ({ ...s, bodyType: e.target.value }))
              }
              className="input mt-1.5 w-full rounded-xl"
            />
          </label>
          <label className="block text-xs font-semibold text-ink-muted">
            Shoulder
            <input
              value={sizing.shoulderWidth}
              onChange={(e) =>
                setSizing((s) => ({ ...s, shoulderWidth: e.target.value }))
              }
              className="input mt-1.5 w-full rounded-xl"
            />
          </label>
        </div>
        <div className="border-t border-hairline-soft px-5 py-3 sm:px-6">
          <button
            type="button"
            disabled={busy === "sizing" || !signedIn}
            onClick={() => void saveSizing()}
            className="text-sm font-semibold text-ink underline underline-offset-2 disabled:opacity-50"
          >
            {busy === "sizing" ? "Saving…" : "Save measurements"}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard>
        <SettingsCardHeader
          title="Cookies"
          description="Essential cookies keep you signed in. We do not run advertising cookies."
        />
        <label className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <span>
            <span className="block text-sm font-medium text-ink">
              Preference cookies
            </span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              Remember region and display choices. We do not set these today.
            </span>
          </span>
          <input
            type="checkbox"
            checked={prefs.preferences}
            onChange={(e) =>
              setPrefs(
                writeCookiePrefs({
                  analytics: prefs.analytics,
                  preferences: e.target.checked,
                }),
              )
            }
            className="size-4"
          />
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-4 border-t border-hairline-soft px-5 py-4 sm:px-6">
          <span>
            <span className="block text-sm font-medium text-ink">
              Analytics cookies
            </span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              Product usage. Off unless you turn this on. We do not set these today.
            </span>
          </span>
          <input
            type="checkbox"
            checked={prefs.analytics}
            onChange={(e) =>
              setPrefs(
                writeCookiePrefs({
                  analytics: e.target.checked,
                  preferences: prefs.preferences,
                }),
              )
            }
            className="size-4"
          />
        </label>
        <p className="border-t border-hairline-soft px-5 py-3 text-xs text-ink-muted sm:px-6">
          Advertising cookies are not used.{" "}
          <Link href={LEGAL_PATHS.cookies} className="underline underline-offset-2">
            Cookie Policy
          </Link>
        </p>
      </SettingsCard>

      <SettingsCard>
        <SettingsCardHeader
          title="Your rights"
          description="See, correct, export, or delete what we hold. Same controls for everyone in the US."
        />
        <div className="divide-y divide-hairline-soft">
          <SettingsActionRow
            title="Download a copy of your data"
            subtitle="JSON export of profile, chats, consents, and shares."
            onClick={() => void exportData()}
          />
          {biometricOn ? (
            <SettingsActionRow
              title="Withdraw biometric consent"
              subtitle="Deletes your twin, photo-derived measurements, and renders. Account stays."
              destructive
              onClick={() => void withdrawBiometric()}
            />
          ) : null}
          <SettingsActionRow
            title="Opt out of arbitration"
            subtitle={`Email ${LEGAL_CONTACT_EMAIL} within 30 days of signup.`}
            onClick={() => {
              window.location.href = `mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent("arbitration opt-out")}`;
            }}
          />
          <SettingsActionRow
            title={`Report an under-${MIN_ACCOUNT_AGE} account`}
            subtitle="We delete that account and all associated data."
            onClick={() => {
              window.location.href = `mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent("under-13 report")}`;
            }}
          />
        </div>
        {message ? (
          <p className="border-t border-hairline-soft px-5 py-3 text-xs text-ink-muted sm:px-6">
            {busy === "export" ? "Preparing…" : message}
          </p>
        ) : null}
      </SettingsCard>
    </>
  );
}
