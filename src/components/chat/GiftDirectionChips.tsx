"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { ClarificationOptionCard } from "@/components/chat/ClarificationOptionCard";
import { OptionPreviewCarousel } from "@/components/chat/OptionPreviewCarousel";
import { useChatStore } from "@/components/chat/chat-store";
import { ensureGiftDirectionPreviewQueries } from "@/lib/ai-chat/search/gift-directions";
import type { MessageGiftDirectionsV1 } from "@/lib/ai-chat/types";

/**
 * Multi-select gift-direction cards (docs/search-improvements.md §5 Step B).
 * Shares the unified visual preview path with clarification option chips.
 */
export const GiftDirectionChips = memo(function GiftDirectionChips({
  messageId,
  giftDirections,
}: {
  messageId: string;
  giftDirections: MessageGiftDirectionsV1;
}) {
  const submit = useChatStore((s) => s.submitGiftDirections);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const [selected, setSelected] = useState<string[]>([]);

  const max = Math.min(3, Math.max(1, giftDirections.pickCount || 2));

  const toggle = useCallback(
    (id: string) => {
      setSelected((cur) => {
        if (cur.includes(id)) return cur.filter((x) => x !== id);
        if (cur.length >= max) return cur;
        return [...cur, id];
      });
    },
    [max],
  );

  const selectedLabels = useMemo(
    () =>
      selected
        .map((id) => giftDirections.directions.find((d) => d.id === id)?.label)
        .filter((l): l is string => Boolean(l)),
    [selected, giftDirections.directions],
  );

  const busy = isStreaming;
  const canSubmit = selected.length >= 1 && !busy;

  const directions = useMemo(
    () => ensureGiftDirectionPreviewQueries(giftDirections).directions,
    [giftDirections],
  );

  if (giftDirections.status !== "pending") {
    if (giftDirections.selected?.length) {
      return (
        <div className="mt-3 rounded-2xl border border-hairline bg-surface-tint px-4 py-3 text-xs text-ink-soft">
          <p className="font-medium text-ink">Exploring</p>
          <p className="mt-1">{giftDirections.selected.join(", ")}</p>
        </div>
      );
    }
    return null;
  }

  const recipient = giftDirections.recipientLabel?.trim();
  const lead = max === 1
    ? `Pick a direction${recipient ? ` for ${recipient}` : ""}.`
    : `Pick up to ${max} directions${recipient ? ` for ${recipient}` : ""}.`;

  return (
    <div className="shoop-option-preview-panel">
      <p className="shoop-option-preview-panel__lead">{lead}</p>
      {giftDirections.contextSummary ? (
        <p className="text-xs leading-relaxed text-ink-muted">
          {giftDirections.contextSummary}
        </p>
      ) : null}

      <OptionPreviewCarousel title="Explore ideas">
        {directions.map((d) => {
          const on = selected.includes(d.id);
          const atCap = !on && selected.length >= max;
          return (
            <ClarificationOptionCard
              key={d.id}
              optionId={d.id}
              label={d.label}
              selected={on}
              disabled={busy || atCap}
              previewQuery={d.previewQuery}
              previewImages={d.previewImages}
              onToggle={() => toggle(d.id)}
            />
          );
        })}
      </OptionPreviewCarousel>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit(messageId, selectedLabels)}
          className="shoop-quiz-apply"
        >
          Explore {selected.length ? `(${selected.length})` : ""}
          <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden />
        </button>
      </div>
    </div>
  );
});
