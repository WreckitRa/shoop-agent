"use client";

import type { AvatarCompareVariant } from "@/lib/tryon/types";
import { cn } from "@/lib/ai-chat/cn";
import { Loader2 } from "lucide-react";

type AvatarComparePanelProps = {
  variants: AvatarCompareVariant[];
  selectedKey: AvatarCompareVariant["provider_key"];
  onSelect: (key: AvatarCompareVariant["provider_key"]) => void;
};

function formatMs(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AvatarComparePanel({
  variants,
  selectedKey,
  onSelect,
}: AvatarComparePanelProps) {
  const sorted = [...variants].sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0));

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        Compare providers — pick one to save
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {sorted.map((variant) => {
          const ready = Boolean(variant.preview_url);
          const failed = variant.status === "failed" || Boolean(variant.error);
          const pending =
            !ready &&
            !failed &&
            (variant.status === "pending" || variant.status === "processing");
          const selected = variant.provider_key === selectedKey;
          return (
            <button
              key={variant.provider_key}
              type="button"
              disabled={!ready}
              className={cn(
                "rounded-xl border p-2 text-left transition",
                selected && ready && "border-ink ring-1 ring-ink/20",
                !selected && ready && "border-hairline hover:border-ink/30",
                !ready && "cursor-default border-hairline",
                failed && "cursor-not-allowed opacity-60",
              )}
              onClick={() => {
                if (ready) onSelect(variant.provider_key);
              }}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink">{variant.label}</span>
                <span className="font-mono text-[10px] text-ink-muted">
                  {formatMs(variant.ms)}
                </span>
              </div>
              {ready ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={variant.preview_url}
                  alt={`${variant.label} avatar`}
                  className="aspect-[2/3] w-full rounded-lg object-cover"
                />
              ) : pending ? (
                <div className="flex aspect-[2/3] flex-col items-center justify-center gap-2 rounded-lg bg-surface-subtle text-xs text-ink-muted">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Generating…
                </div>
              ) : (
                <p className="text-xs text-ink-muted">
                  {variant.error ?? "Generation failed."}
                </p>
              )}
              <p className="mt-1 font-mono text-[10px] text-ink-muted">
                {variant.provider}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
