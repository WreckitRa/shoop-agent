"use client";

import { useEffect, useState } from "react";
import {
  BiometricConsentSheet,
  notifyBiometricConsent,
} from "@/components/legal/BiometricConsentSheet";
import { guestFetch } from "@/lib/client/guest-fetch";

export function BiometricReconsentGate({
  enabled,
}: {
  enabled: boolean;
}) {
  const [needed, setNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setNeeded(false);
      return;
    }
    let cancelled = false;
    void guestFetch("/api/privacy/biometric-consent", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { needsReconsent?: boolean };
        if (!cancelled) setNeeded(Boolean(json.needsReconsent));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  async function post(action: "accept" | "withdraw") {
    setBusy(true);
    setError(null);
    try {
      const res = await guestFetch("/api/privacy/biometric-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("failed");
      setNeeded(false);
      notifyBiometricConsent(action === "accept");
    } catch {
      setError(
        action === "accept"
          ? "Could not save consent."
          : "Could not withdraw consent.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!enabled || !needed) return null;

  return (
    <BiometricConsentSheet
      busy={busy}
      error={error}
      skipLabel="No thanks — delete my twin"
      onSkip={() => void post("withdraw")}
      onAccept={() => void post("accept")}
    />
  );
}
