"use client";

import { memo } from "react";
import { cn } from "@/lib/ai-chat/cn";
import type { FashionCurationRunView } from "@/lib/ai-chat/agent-debug";
import {
  CATALOG_IMAGE_PX,
  catalogDisplayImageUrl,
} from "@/lib/shopify/catalog-display-image";

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function CandidateRow({
  candidate,
}: {
  candidate: FashionCurationRunView["slots"][number]["candidates"][number];
}) {
  const imageUrl = candidate.image_url ?? candidate.imageUrl;

  return (
    <li
      className={cn(
        "flex gap-2 rounded-md border p-2",
        candidate.picked && "border-emerald-500/40 bg-emerald-500/10",
        candidate.vetoed && "border-red-500/30 bg-red-500/5",
        !candidate.picked && !candidate.vetoed && "border-border/60 bg-surface-subtle/50",
      )}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={catalogDisplayImageUrl(imageUrl, CATALOG_IMAGE_PX.debug)}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "size-14 shrink-0 rounded object-cover",
            candidate.image_shown && "ring-2 ring-sky-500/70",
          )}
        />
      ) : (
        <div className="size-14 shrink-0 rounded bg-surface-subtle" />
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1">
          <span className="rounded bg-surface-subtle px-1 py-0.5 font-mono text-[10px] text-ink">
            {candidate.ref}
          </span>
          {candidate.image_shown ? (
            <span className="rounded bg-sky-500/15 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-900 dark:text-sky-100">
              image sent
            </span>
          ) : (
            <span className="text-[10px] text-ink-muted">text only</span>
          )}
          {candidate.picked ? (
            <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:text-emerald-100">
              pick · {candidate.pick_role}
            </span>
          ) : null}
          {candidate.vetoed ? (
            <span className="rounded bg-red-500/20 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-100">
              veto · {candidate.veto_reason}
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs font-medium text-ink">{candidate.title}</p>
        <p className="truncate text-[10px] text-ink-muted">
          {[
            candidate.store,
            candidate.priceLabel,
            candidate.colors,
            candidate.size_status,
            candidate.score != null ? `score ${candidate.score.toFixed(3)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {candidate.stylist_line ? (
          <p className="mt-1 text-[11px] text-ink-muted">{candidate.stylist_line}</p>
        ) : null}
        {candidate.veto_evidence ? (
          <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">
            {candidate.veto_evidence}
          </p>
        ) : null}
        {candidate.suspicions ? (
          <p className="mt-1 text-[10px] text-amber-800 dark:text-amber-200">
            {candidate.suspicions}
          </p>
        ) : null}
        <p className="truncate font-mono text-[10px] text-ink-muted">{candidate.id}</p>
      </div>
    </li>
  );
}

export const FashionCurationDebugPanel = memo(function FashionCurationDebugPanel({
  run,
}: {
  run: FashionCurationRunView;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-3 flex flex-wrap gap-2 text-[10px] text-ink-muted">
        <span className="rounded bg-fuchsia-500/15 px-1.5 py-0.5 font-mono uppercase tracking-wide text-fuchsia-900 dark:text-fuchsia-100">
          {run.mode}
        </span>
        <span className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono">
          {run.model}
        </span>
        {run.fallback ? (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-50">
            fallback — not live Opus curation
          </span>
        ) : null}
        <span>{run.image_count} images to model</span>
        <span>
          tiers {run.tiers_summary.picks}/{run.tiers_summary.verified}/
          {run.tiers_summary.unverified}
        </span>
        <span>{run.timing_ms}ms</span>
        {run.retries > 0 ? <span>{run.retries} retries</span> : null}
      </div>

      {run.validation_issues.length ? (
        <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-950 dark:text-amber-50">
          Validation: {run.validation_issues.join(", ")}
        </p>
      ) : null}

      {run.narration.opening ? (
        <section className="mb-4 rounded-lg border border-border/70 bg-page/40 p-2.5">
          <h3 className="mb-1 text-xs font-semibold text-ink">Narration</h3>
          <p className="text-xs text-ink-muted">{run.narration.opening}</p>
          {run.narration.brand_note ? (
            <p className="mt-1 text-[11px] text-ink-muted">{run.narration.brand_note}</p>
          ) : null}
          {run.narration.budget_note ? (
            <p className="mt-1 text-[11px] text-ink-muted">{run.narration.budget_note}</p>
          ) : null}
        </section>
      ) : null}

      {run.slots.map((slot) => (
        <section key={slot.slot_id} className="mb-6">
          <h3 className="text-sm font-semibold text-ink">
            {slot.garment}{" "}
            <span className="font-normal text-ink-muted">
              ({slot.candidate_count} checked · {slot.picks_count} picks ·{" "}
              {slot.image_budget} images)
            </span>
          </h3>

          <ul className="mt-2 max-h-[28rem] space-y-1 overflow-y-auto">
            {slot.candidates.map((candidate) => (
              <CandidateRow key={candidate.ref} candidate={candidate} />
            ))}
          </ul>
        </section>
      ))}

      {run.vetoes.length ? (
        <details className="mb-4">
          <summary className="cursor-pointer text-xs font-medium text-ink">
            Vetoes ({run.vetoes.length})
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-surface-subtle p-2 font-mono text-[10px] text-ink-muted">
            {formatJson(run.vetoes)}
          </pre>
        </details>
      ) : null}

      {run.looks?.length ? (
        <details className="mb-4">
          <summary className="cursor-pointer text-xs font-medium text-ink">
            Looks ({run.looks.length})
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-surface-subtle p-2 font-mono text-[10px] text-ink-muted">
            {formatJson(run.looks)}
          </pre>
        </details>
      ) : null}

      {run.capsule_outfits?.length ? (
        <details className="mb-4">
          <summary className="cursor-pointer text-xs font-medium text-ink">
            Capsule outfits ({run.capsule_outfits.length})
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-surface-subtle p-2 font-mono text-[10px] text-ink-muted">
            {formatJson(run.capsule_outfits)}
          </pre>
        </details>
      ) : null}

      <details>
        <summary className="cursor-pointer text-xs font-medium text-ink">
          Curator input ({run.input_text.length.toLocaleString()} chars)
        </summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-surface-subtle p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-ink-muted">
          {run.input_text}
        </pre>
      </details>

      {run.raw_llm_output ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-ink">
            Raw deliver_curation output
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-surface-subtle p-2 font-mono text-[10px] text-ink-muted">
            {formatJson(run.raw_llm_output)}
          </pre>
        </details>
      ) : null}
    </div>
  );
});
