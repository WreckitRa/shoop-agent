"use client";

import { useState } from "react";
import {
  DangerActionModal,
  SettingsActionRow,
  SettingsCard,
  SettingsCardHeader,
} from "@/components/profile/profile-settings-ui";

type Action = "erase" | "delete" | null;

export function ProfileAccountActions() {
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
