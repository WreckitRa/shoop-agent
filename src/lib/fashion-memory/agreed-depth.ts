import type { FashionSearchBrief } from "./router/types";
import type { SearchPlanSlotRole } from "./search-planner/types";

export const DEPTH_CEILING = 8;
/** What a stylist shows an undecided client. Used only when the brief carries no number. */
const DEFAULT_PICKS = 3;
const DEFAULT_LOOKS = 3;

export type AgreedDepth = {
  /** single/multi: picks per slot. outfit/capsule: anchor-slot depth (= looks). */
  picks: number;
  /** outfit/capsule: looks to compose. single/multi: 1. */
  looks: number;
  /** True when the number came from the brief (stated / you_decide / assumed), not our default. */
  fromBrief: boolean;
};

const clamp = (n: number) =>
  Math.max(1, Math.min(DEPTH_CEILING, Math.round(n)));

export function agreedDepth(
  brief: Pick<FashionSearchBrief, "request_type" | "depth">,
): AgreedDepth {
  const d = brief.depth;
  const isLooks =
    brief.request_type === "outfit" || brief.request_type === "capsule";
  if (isLooks) {
    const n = d?.looks_wanted;
    return n
      ? { looks: clamp(n), picks: clamp(n), fromBrief: true }
      : { looks: DEFAULT_LOOKS, picks: DEFAULT_LOOKS, fromBrief: false };
  }
  const n = d?.options_per_item;
  return n
    ? { picks: clamp(n), looks: 1, fromBrief: true }
    : { picks: DEFAULT_PICKS, looks: 1, fromBrief: false };
}

/**
 * Per-slot options_wanted for outfit/capsule from the agreed look count.
 * anchor = N; support = ceil(N × 0.75), min 2 — unmeasured, keep until goldens exist.
 */
export function slotDepthForLooks(
  looks: number,
  role: SearchPlanSlotRole,
): number {
  return role === "anchor"
    ? clamp(looks)
    : clamp(Math.max(2, Math.ceil(looks * 0.75)));
}
