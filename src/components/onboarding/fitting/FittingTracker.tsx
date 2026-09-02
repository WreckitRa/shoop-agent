"use client";

import { ShoopLogo } from "@/components/brand/ShoopBrand";
import { cn } from "@/lib/ai-chat/cn";
import {
  STITCH_KNOTS,
  TRACKER_GROUPS,
  knotNowIndex,
  sewnThroughIndex,
  type FittingStep,
  type MirrorState,
} from "./types";

const BUILD_FACT: Record<NonNullable<MirrorState["build"]>, string> = {
  slim: "Slim",
  average: "Average",
  athletic: "Athletic",
  broad: "Broad",
  plus: "Full figured",
};

function factsForKnot(
  id: (typeof STITCH_KNOTS)[number]["id"],
  mirror: MirrorState,
): Array<{ text: string; no?: boolean }> {
  switch (id) {
    case "photo":
      return mirror.photoUrl ? [{ text: "Face in" }] : [];
    case "name": {
      const out: Array<{ text: string; no?: boolean }> = [];
      if (mirror.name) out.push({ text: mirror.name });
      if (mirror.eraLabel) out.push({ text: mirror.eraLabel });
      return out;
    }
    case "spend":
      return mirror.spendLabel && mirror.spendLabel !== "—"
        ? [{ text: mirror.spendLabel }]
        : [];
    case "fit": {
      const out: Array<{ text: string; no?: boolean }> = [];
      if (mirror.build) out.push({ text: BUILD_FACT[mirror.build] });
      if (mirror.heightCm != null) out.push({ text: `${mirror.heightCm} cm` });
      return out;
    }
    case "worn":
      return mirror.leanLabel && mirror.leanLabel !== "—"
        ? [{ text: mirror.leanLabel }]
        : [];
    case "corner":
      return mirror.cornerLabel && mirror.cornerLabel !== "—"
        ? [{ text: mirror.cornerLabel }]
        : [];
    case "nolist":
      return mirror.noListLabel && mirror.noListLabel !== "—"
        ? [{ text: mirror.noListLabel, no: true }]
        : [];
    case "circle":
      return mirror.circleLabel && mirror.circleLabel !== "—"
        ? [{ text: mirror.circleLabel }]
        : [];
    case "mint":
      return mirror.developPct >= 100 ? [{ text: "Reading ready" }] : [];
    default:
      return [];
  }
}

type Props = {
  step: FittingStep;
  mirror: MirrorState;
  progressPct: number;
};

export function FittingTracker({ step, mirror, progressPct }: Props) {
  const nowIdx = knotNowIndex(step);
  const sewnIdx = sewnThroughIndex(step);

  return (
    <nav
      aria-label="Fitting progress"
      className="flex h-full min-h-0 flex-col overflow-y-auto bg-gradient-to-b from-[#FCFCFD] to-[#F6F6F8] px-3.5 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:w-0"
    >
      <ShoopLogo className="mb-4 h-[15px]" />
      {TRACKER_GROUPS.map((group, gi) => (
        <div key={group.label}>
          <div
            className={cn(
              "mb-1.5 font-display text-[8.5px] font-black tracking-[0.16em] text-[#C4C4CC]",
              gi === 0 ? "mt-0" : "mt-3.5",
            )}
          >
            {group.label}
          </div>
          {group.knotIds.map((id) => {
            const knotIdx = STITCH_KNOTS.findIndex((k) => k.id === id);
            const knot = STITCH_KNOTS[knotIdx];
            if (!knot) return null;
            const done = sewnIdx >= knotIdx;
            const act = nowIdx === knotIdx && !done;
            const facts = factsForKnot(knot.id, mirror);
            return (
              <div
                key={knot.id}
                className={cn(
                  "flex flex-wrap items-start gap-2 py-1 text-[11px] text-[#B4B4BC] transition-colors duration-300",
                  act && "font-semibold text-[var(--fitting-ink)]",
                  done && "text-[var(--fitting-quiet)]",
                )}
              >
                <i
                  className={cn(
                    "mt-0.5 size-[11px] shrink-0 rounded-full border-2 border-[var(--fitting-g3)] transition-all duration-300",
                    act &&
                      "border-[var(--fitting-red)] shadow-[0_0_0_3px_rgba(228,40,49,0.13)]",
                    done &&
                      "border-[var(--fitting-red)] bg-[var(--fitting-red)]",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 leading-tight">{knot.label}</span>
                {facts.length ? (
                  <div className="flex w-full flex-col gap-0.5 pl-[19px]">
                    {facts.map((f) => (
                      <div
                        key={f.text}
                        className="flex gap-1.5 text-[10.5px] leading-[1.4] text-[var(--fitting-quiet)]"
                      >
                        <s
                          className={cn(
                            "mt-0.5 text-[8px] no-underline",
                            f.no
                              ? "text-[var(--fitting-red)]"
                              : "text-[var(--fitting-good)]",
                          )}
                        >
                          {f.no ? "✕" : "✓"}
                        </s>
                        <span>
                          <b className="font-semibold text-[var(--fitting-ink)]">
                            {f.text}
                          </b>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
      <div className="mt-auto pt-4">
        <div className="h-1 overflow-hidden rounded-full bg-[var(--fitting-g3)]">
          <i
            className="fitting-motion block h-full rounded-full bg-[var(--fitting-red)]"
            style={{
              width: `${progressPct}%`,
              transition: "width 0.7s cubic-bezier(.4,0,.2,1)",
            }}
          />
        </div>
      </div>
    </nav>
  );
}
