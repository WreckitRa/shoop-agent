"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import type { FashionCatalogRunSummary } from "@/lib/admin/fashion-types";

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function FashionAdminRunList({
  runs,
  loading,
  onRefresh,
}: {
  runs: FashionCatalogRunSummary[];
  loading?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Fashion catalog runs
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Hard drops, scoring breakdowns, and pipeline events from production searches.
          </p>
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="btn-secondary inline-flex gap-2"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Refresh
          </button>
        ) : null}
      </div>

      {runs.length === 0 ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-muted">
          No fashion catalog runs found yet. Run a search in chat to populate
          this list.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-hairline bg-surface-tint/60 text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Garments</th>
                  <th className="px-4 py-3 font-medium">Survivors</th>
                  <th className="px-4 py-3 font-medium">Dropped</th>
                  <th className="px-4 py-3 font-medium">Timing</th>
                  <th className="px-4 py-3 font-medium">Conversation</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {runs.map((run) => {
                  const href = run.traceId
                    ? `/admin/fashion/${run.traceId}`
                    : `/admin/fashion/message/${run.messageId}`;
                  return (
                    <tr key={run.messageId} className="hover:bg-surface-tint/40">
                      <td className="whitespace-nowrap px-4 py-3 text-ink">
                        {formatWhen(run.createdAt)}
                        {run.flagged ? (
                          <span
                            className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900"
                            title="Invariant warning in pipeline"
                          >
                            <AlertTriangle className="size-3" />
                            Flagged
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-ink">
                        {run.garments.join(", ") || "—"}
                        <span className="ml-2 text-xs text-ink-muted">
                          {run.slotCount} slot{run.slotCount === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-ink">{run.survivorCount}</td>
                      <td className="px-4 py-3 font-mono text-ink">
                        <span className={run.droppedCount > 0 ? "text-red-700" : ""}>
                          {run.droppedCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                        {run.timingMs}ms
                      </td>
                      <td className="max-w-[12rem] truncate px-4 py-3 text-xs text-ink-muted">
                        {run.conversationTitle || run.conversationId}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={href}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                        >
                          Inspect
                          <ArrowRight className="size-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
