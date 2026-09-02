"use client";

import { useState } from "react";
import {
  DangerActionModal,
  SettingsActionRow,
  SettingsCard,
  SettingsCardHeader,
} from "@/components/profile/profile-settings-ui";
import { profileSettingsAccess } from "@/components/profile/profile-settings-access";
import { openAuthModal } from "@/hooks/useGuestMode";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useAppSessionStore } from "@/lib/client/app-session";
import { prepareClientForSignedOut } from "@/lib/client/identity-sync";

type Action = "erase" | "delete" | null;

export function ProfileAccountActions() {
  const mode = useAppSessionStore((s) => s.mode);
  const access = profileSettingsAccess(mode);
  const [active, setActive] = useState<Action>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(action: Action) {
    setActive(action);
    setPassword("");
    setError(null);
  }

  function close() {
    if (busy) return;
    setActive(null);
    setPassword("");
    setError(null);
  }

  async function confirm() {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eraseDataOnly: active === "erase",
          password,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Something went wrong. Try again.");
        return;
      }
      if (active === "erase") {
        window.location.reload();
        return;
      }
      window.dispatchEvent(new Event("shoop-auth-changed"));
      window.location.href = "/";
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function clearGuestVisit() {
    if (
      !window.confirm(
        "Clear this visit? The photo, measurements, and picks on this device will be deleted. This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await guestFetch("/api/privacy/guest-abandon", { method: "POST" });
      await prepareClientForSignedOut();
      window.dispatchEvent(new Event("shoop-auth-changed"));
      window.location.href = "/";
    } catch {
      setError("Could not clear this visit. Try again.");
      setBusy(false);
    }
  }

  if (mode === "loading" || mode === "anonymous") return null;

  if (access.isGuest) {
    return (
      <SettingsCard>
        <SettingsCardHeader
          title="This visit"
          description="You're browsing as a guest. Sign up to keep your Fitting on any device."
        />
        <div className="divide-y divide-hairline-soft">
          <SettingsActionRow
            title="Sign up to save"
            subtitle="Keep your twin, chats, and picks after this device."
            onClick={() => openAuthModal("signup")}
          />
          <SettingsActionRow
            title="Sign in"
            subtitle="Use an existing account."
            onClick={() => openAuthModal("login")}
          />
          <SettingsActionRow
            title="Clear this visit"
            subtitle="Deletes the photo and measurements from this device."
            destructive
            onClick={() => void clearGuestVisit()}
          />
        </div>
        {error ? (
          <p className="border-t border-hairline-soft px-5 py-3 text-xs text-error-deep sm:px-6">
            {error}
          </p>
        ) : null}
      </SettingsCard>
    );
  }

  return (
    <>
      <SettingsCard>
        <SettingsCardHeader
          title="Data & privacy"
          description="Manage stored data and your account."
        />
        <div className="divide-y divide-hairline-soft">
          <SettingsActionRow
            title="Erase all content"
            subtitle="Chats, memory, cart, and profile data."
            onClick={() => open("erase")}
          />
          <SettingsActionRow
            title="Delete account"
            subtitle="Permanently removes your account."
            destructive
            onClick={() => open("delete")}
          />
        </div>
      </SettingsCard>

      <DangerActionModal
        open={active === "erase"}
        variant="erase"
        password={password}
        onPasswordChange={setPassword}
        error={error}
        busy={busy}
        onClose={close}
        onConfirm={() => void confirm()}
      />

      <DangerActionModal
        open={active === "delete"}
        variant="delete"
        password={password}
        onPasswordChange={setPassword}
        error={error}
        busy={busy}
        onClose={close}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
