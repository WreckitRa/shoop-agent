import { recordPipelineEvent } from "../observability/trace";
import { extractStatedColors } from "../router/brief-fields";
import type { FashionSearchBrief } from "../router/types";
import { COLOR_WORDS } from "./query-rules";
import type { FashionSearchPlan, FashionSearchPlanSlot } from "./types";

export type PaletteSource =
  | "stated"
  | "profile"
  | "occasion_default"
  | "spread";

const COLOR_WORDS_FROM_PALETTE = [...COLOR_WORDS];

export function expectedPaletteSourceFromBrief(
  brief: FashionSearchBrief,
): Exclude<PaletteSource, "occasion_default"> | "spread" {
  const source = brief.color_direction?.source ?? "none";
  if (source === "stated") return "stated";
  if (source === "profile") return "profile";
  return "spread";
}

/** @deprecated Occasion keyword → palette invent removed. Always null. */
export function inferOccasionDefaultPalette(
  _brief: FashionSearchBrief,
): string | null {
  return null;
}

function statedPaletteConstraint(brief: FashionSearchBrief): string {
  const colors =
    brief.color_direction?.stated_colors ??
    extractStatedColors(brief.must_haves);
  if (!colors.length) return "stated color family";
  return `${colors.join(", ")} and natural companions`;
}

function profilePaletteConstraint(brief: FashionSearchBrief): string {
  const direction = brief.style_direction.toLowerCase();
  if (direction.includes("monochrome")) return "monochrome neutrals";
  if (direction.includes("neutral")) return "neutral palette family";
  return "profile-aligned palette family";
}

export function reconcileSlotPalette(
  slot: FashionSearchPlanSlot,
  brief: FashionSearchBrief,
  currentDate: string,
  traceId?: string | null,
): FashionSearchPlanSlot {
  void currentDate;
  const expected = expectedPaletteSourceFromBrief(brief);
  let palette_source = slot.palette_source;
  let palette_constraint = slot.palette_constraint;

  const briefSource = brief.color_direction?.source ?? "none";
  if (briefSource === "stated" && palette_source !== "stated") {
    palette_source = "stated";
  } else if (briefSource === "profile" && palette_source === "stated") {
    palette_source = "profile";
  } else if (briefSource === "none" && palette_source === "stated") {
    palette_source = expected;
  }

  if (!palette_source) {
    palette_source = expected;
  }

  // Never keep keyword-invented occasion palettes.
  if (palette_source === "occasion_default") {
    palette_source = "spread";
    palette_constraint = null;
  }

  if (palette_source === "spread") {
    palette_constraint = null;
  } else if (palette_constraint == null || !palette_constraint.trim()) {
    if (palette_source === "stated") {
      palette_constraint = statedPaletteConstraint(brief);
    } else if (palette_source === "profile") {
      palette_constraint = profilePaletteConstraint(brief);
    } else {
      palette_source = "spread";
      palette_constraint = null;
    }
  }

  if (palette_constraint == null && palette_source !== "spread") {
    palette_source = "spread";
    recordPipelineEvent({
      traceId,
      stage: "invariant_warning",
      payload: {
        kind: "palette_null_not_spread",
        slot_id: slot.slot_id,
        prior_source: slot.palette_source,
      },
    });
  }

  if (palette_source !== slot.palette_source || palette_constraint !== slot.palette_constraint) {
    recordPipelineEvent({
      traceId,
      stage: "clamp",
      payload: {
        kind: "palette_ladder_reconcile",
        slot_id: slot.slot_id,
        from_source: slot.palette_source,
        to_source: palette_source,
      },
    });
  }

  return {
    ...slot,
    palette_source,
    palette_constraint,
  };
}

export function reconcilePlanPalettes(
  plan: FashionSearchPlan,
  traceId?: string | null,
): FashionSearchPlan {
  return {
    ...plan,
    slots: plan.slots.map((slot) =>
      reconcileSlotPalette(slot, plan.brief, plan.currentDate, traceId),
    ),
  };
}

export function allowedColorWordsForSlot(
  slot: FashionSearchPlanSlot,
  brief: FashionSearchBrief,
): string[] {
  if (slot.palette_source === "spread") return [];
  if (slot.palette_source === "stated") {
    return (
      brief.color_direction?.stated_colors ??
      extractStatedColors(brief.must_haves)
    );
  }
  return [...COLOR_WORDS_FROM_PALETTE];
}
