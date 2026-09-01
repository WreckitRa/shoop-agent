"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch, useAdminToken } from "@/components/admin/AdminGate";

type AlertRow = {
  id: string;
  code: string;
  severity: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export default function PilotHealthPage() {
  const token = useAdminToken();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [p0, setP0] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        "/api/admin/pilot-alerts?sinceHours=24&limit=50",
        token,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const data = (await res.json()) as {
        alerts: AlertRow[];
        p0_count: number;
      };
      setAlerts(data.alerts);
      setP0(data.p0_count);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50/50 px-6 py-8 text-sm text-red-900">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink">Pilot health</h1>
          <p className="text-sm text-ink-muted">
            Last 24h P0s. Empty is the only acceptable number on day one.
          </p>
        </div>
        <p className="text-sm font-medium text-ink">
          P0 last 24h: <span className="tabular-nums">{loading ? "…" : p0}</span>
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-ink-muted">No alerts in the last 24 hours.</p>
      ) : (
        <ul className="divide-y divide-hairline rounded-lg border border-hairline">
          {alerts.map((a) => (
            <li key={a.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono font-medium text-ink">
                  [{a.severity}] {a.code}
                </span>
                <time className="text-xs text-ink-muted" dateTime={a.created_at}>
                  {new Date(a.created_at).toISOString()}
                </time>
              </div>
              <pre className="mt-1 overflow-x-auto text-xs text-ink-muted">
                {JSON.stringify(a.payload)}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
