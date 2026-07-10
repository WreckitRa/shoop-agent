"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { adminFetch, useAdminToken } from "@/components/admin/AdminGate";
import { FashionAdminTraceView } from "@/components/admin/fashion/FashionAdminTraceView";
import type { FashionCatalogRunDetail } from "@/lib/admin/fashion-types";

export default function FashionAdminTracePage() {
  const params = useParams<{ traceId: string }>();
  const token = useAdminToken();
  const [detail, setDetail] = useState<FashionCatalogRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const traceId = params.traceId;

  const load = useCallback(async () => {
    if (!token || !traceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `/api/admin/fashion/traces/${encodeURIComponent(traceId)}`,
        token,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Trace not found (${res.status})`);
      }
      setDetail((await res.json()) as FashionCatalogRunDetail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trace");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [token, traceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-ink-muted">Loading trace…</p>;
  }

  if (error || !detail) {
    return (
      <div className="card border-red-200 bg-red-50/50 px-6 py-8 text-sm text-red-900">
        {error ?? "Trace not found."}
      </div>
    );
  }

  return <FashionAdminTraceView detail={detail} />;
}
