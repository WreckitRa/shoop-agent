"use client";

import { memo, useCallback, useState } from "react";
import { ClipboardCopy, Check } from "lucide-react";
import type { QaDebugCriteriaModel } from "@/lib/qa/debug-criteria";

function CopyTraceId({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(traceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [traceId]);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-900 dark:text-sky-100">
        trace_id
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
        {traceId}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-sky-900 hover:bg-sky-500/20 dark:text-sky-100"
      >
        {copied ? <Check className="size-3" /> : <ClipboardCopy className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export const QaDebugCriteriaPanel = memo(function QaDebugCriteriaPanel({
  model,
}: {
  model: QaDebugCriteriaModel;
}) {
  return (
    <div className="space-y-4">
      {model.traceId ? <CopyTraceId traceId={model.traceId} /> : null}
      {model.sections.map((section) => (
        <section key={section.title}>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {section.title}
          </h4>
          <dl className="space-y-1.5">
            {section.rows.map((r) => (
              <div
                key={`${section.title}-${r.label}`}
                className="rounded-md border border-border/50 bg-surface-subtle/40 px-2 py-1.5"
              >
                <dt className="font-mono text-[10px] text-ink-muted">{r.label}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[11px] text-ink">
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
});
