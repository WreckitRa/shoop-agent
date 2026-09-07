"use client";

import { useEffect, useState } from "react";
import {
  ensureFittingTraceId,
  getFittingTraceId,
  isFittingTracePublicEnabled,
} from "./fitting-trace-id";

export function FittingTraceBadge() {
  const [id, setId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isFittingTracePublicEnabled()) return;
    setId(ensureFittingTraceId());
  }, []);

  if (!isFittingTracePublicEnabled() || !id) return null;

  const short = id.slice(0, 8);

  return (
    <button
      type="button"
      title={`Fitting trace ${id} — click to copy`}
      onClick={() => {
        void navigator.clipboard.writeText(id).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="pointer-events-auto absolute bottom-3 left-3 z-[120] max-w-[calc(100%-1.5rem)] truncate rounded-full border border-[var(--fitting-line)] bg-white/95 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wide text-[var(--fitting-quiet)] shadow-[0_8px_24px_-16px_rgba(14,14,17,.5)] hover:text-[var(--fitting-ink)]"
    >
      {copied ? "copied" : `trace ${short}`}
    </button>
  );
}

export function useFittingTraceId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!isFittingTracePublicEnabled()) return;
    setId(ensureFittingTraceId());
  }, []);
  return id ?? getFittingTraceId();
}
