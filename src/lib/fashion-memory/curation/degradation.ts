import { NARRATION_MACHINERY_RE } from "./narration-sanitize";
import type { FashionCurationPresentation } from "./types";
import type { FashionSearchPlan } from "../search-planner/types";

export type DegradationKind =
  | "none"
  | "curation_fallback"
  | "partial_slots"
  | "heavy_unverified";

export type DegradationInfo = {
  kind: DegradationKind;
  user_line: string;
  action?: "recurate";
};

const CURATION_FALLBACK_LINE =
  "I ranked these by fit and quality, but didn't get to hand-finish this set — want me to take another styling pass?";

const PARTIAL_SLOTS_LINE =
  "I couldn't fill every piece you asked for — here's the strongest set I could build with what's in stock.";

const HEAVY_UNVERIFIED_LINE =
  "A few of these still need a sizing check on the product page — I've flagged them so you know before you click through.";

export function passesMachineryGuard(line: string): boolean {
  return !NARRATION_MACHINERY_RE.test(line);
}

export function computeDegradation(params: {
  presentation: FashionCurationPresentation;
  plan: FashionSearchPlan;
  /** Internal lane failures that did NOT change the delivered outcome. */
  invisibleHiccups?: boolean;
}): DegradationInfo {
  if (params.invisibleHiccups) {
    return { kind: "none", user_line: "" };
  }

  if (params.presentation.meta.fallback) {
    return {
      kind: "curation_fallback",
      user_line: CURATION_FALLBACK_LINE,
      action: "recurate",
    };
  }

  const garmentCount = params.plan.brief.garments.length;
  const slotCount = params.plan.slots.length;
  if (
    (params.plan.mode === "outfit" || params.plan.mode === "capsule") &&
    slotCount < Math.min(garmentCount, 5)
  ) {
    return {
      kind: "partial_slots",
      user_line: PARTIAL_SLOTS_LINE,
    };
  }

  const picks = params.presentation.tiers.picks;
  if (picks.length > 0) {
    const unknownCount = picks.filter(
      (p) =>
        p.badges?.some((b) => b.kind === "check_sizing") ||
        (p as { size_status?: string }).size_status === "unknown",
    ).length;
    if (unknownCount / picks.length > 0.5) {
      return {
        kind: "heavy_unverified",
        user_line: HEAVY_UNVERIFIED_LINE,
      };
    }
  }

  return { kind: "none", user_line: "" };
}
