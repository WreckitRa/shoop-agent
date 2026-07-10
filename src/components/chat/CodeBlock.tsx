"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";

export function CodeBlock({
  language,
  children,
}: {
  language?: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [children]);

  const label = useMemo(() => language || "code", [language]);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-950/90 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-1.5 text-xs text-neutral-400">
        <span className="font-mono capitalize">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-neutral-300 hover:bg-neutral-800 hover:text-white"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-[480px] overflow-x-auto p-3 text-sm leading-relaxed text-neutral-100">
        <code className={cn("font-mono")}>{children}</code>
      </pre>
    </div>
  );
}
