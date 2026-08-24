"use client";

import { useEffect, useState } from "react";
import { FittingBiometricConsent } from "@/components/onboarding/fitting/FittingBiometricConsent";
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

  if (!enabled || !needed) return null;

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-white px-6 py-10">
      <div className="mx-auto max-w-[560px]">
        <FittingBiometricConsent
          busy={busy}
          skipLabel="No thanks — delete my twin and keep the account"
          onSkip={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await guestFetch("/api/privacy/biometric-consent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "withdraw" }),
              });
              if (!res.ok) throw new Error("failed");
              setNeeded(false);
            } catch {
              setError("Could not withdraw consent.");
            } finally {
              setBusy(false);
            }
          }}
          onAccept={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await guestFetch("/api/privacy/biometric-consent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "accept" }),
              });
              if (!res.ok) throw new Error("failed");
              setNeeded(false);
            } catch {
              setError("Could not save consent.");
            } finally {
              setBusy(false);
            }
          }}
        />
        {error ? (
          <p className="mt-4 text-sm font-semibold text-[var(--fitting-red)]">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
