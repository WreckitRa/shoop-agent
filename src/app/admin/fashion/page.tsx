"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch, useAdminToken } from "@/components/admin/AdminGate";
import { FashionAdminRunList } from "@/components/admin/fashion/FashionAdminRunList";
import type { FashionCatalogRunSummary } from "@/lib/admin/fashion-types";

export default function FashionAdminPage() {
  const token = useAdminToken();
  const [runs, setRuns] = useState<FashionCatalogRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/fashion/runs?limit=50", token);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Failed to load runs (${res.status})`);
      }
      const data = (await res.json()) as { runs: FashionCatalogRunSummary[] };
      setRuns(data.runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load runs");
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

  return <FashionAdminRunList runs={runs} loading={loading} onRefresh={() => void load()} />;
}
