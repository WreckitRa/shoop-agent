import type { FashionSearchPlan } from "../search-planner/types";
import type { HydratedCandidate } from "../hydration/types";
import { isDegradedOutfitPlan } from "./validate";
import type {
  CurationRefRegistry,
  DeliverCurationInput,
  DeliverCurationVeto,
  PickRole,
} from "./types";
import { refsForSlot } from "./refs";
import { sanitizeCurationNarration } from "./narration-sanitize";

const ROLE_CYCLE: PickRole[] = ["safe", "stretch", "value", "reach", "safe"];

type FallbackPool = {
  verified: HydratedCandidate[];
};

/**
 * CHOKE POINT: every path that produces user-visible picks must read from the
 * same pool state (verified minus deaths/vetoes) and pass the same output
 * validator. Do not re-filter ad hoc from a stale registry snapshot.
 */
function templateLine(
  garment: string,
  role: PickRole,
  styleDirection: string,
): string {
  const base = styleDirection.split(".")[0]?.trim() || garment;
  switch (role) {
    case "stretch":
      return `A premium ${garment} option that pushes ${base} without leaving your brief.`;
    case "value":
      return `Strong ${garment} value — ${base} done honestly, not cheap-looking.`;
    case "reach":
      return `A bolder ${garment} take on ${base} if you want something with more character.`;
    case "anchor":
      return `The ${garment} that anchors this look — ${base} with clear intent.`;
    case "support":
      return `Pairs cleanly with the anchor — ${base} in a supporting role.`;
    default:
      return `Solid ${garment} pick for ${base} — reliable and on-brief.`;
  }
}

function recipientLabel(plan: FashionSearchPlan): string {
  const name = plan.brief.recipient_person_id?.trim();
  // Prefer occasion/style framing over raw person ids.
  if (plan.brief.occasion_context?.trim()) {
    return plan.brief.occasion_context.trim();
  }
  if (name && !name.startsWith("p") && name.length < 40) return name;
  return "this look";
}

export function buildDeterministicFallback(params: {
  plan: FashionSearchPlan;
  registry: CurationRefRegistry;
  /** Live pools after veto deaths — preferred source of truth for picks. */
  pools?: Map<string, FallbackPool>;
  /** Refs already vetoed (belt-and-suspenders with pool.dead). */
  vetoedRefs?: Set<string>;
  harvestedVetoes?: DeliverCurationVeto[];
  thinSlots: string[];
  brandNote?: string;
  budgetNote?: string;
  traceId?: string | null;
}): DeliverCurationInput {
  const vetoed = params.vetoedRefs ?? new Set<string>();

  const slots = params.plan.slots.map((planSlot) => {
    const pool = params.pools?.get(planSlot.slot_id);
    const verifiedIds = pool
      ? new Set(pool.verified.map((c) => c.id))
      : null;

    const entries = refsForSlot(params.registry, planSlot.slot_id).filter(
      (entry) => {
        if (vetoed.has(entry.ref)) return false;
        if (verifiedIds && !verifiedIds.has(entry.product_id)) return false;
        return true;
      },
    );

    const count = Math.min(planSlot.options_wanted, entries.length);
    const picks = entries.slice(0, count).map((entry, idx) => ({
      ref: entry.ref,
      role:
        planSlot.role === "anchor" && idx === 0
          ? ("anchor" as const)
          : planSlot.role === "support"
            ? ("support" as const)
            : ROLE_CYCLE[idx % ROLE_CYCLE.length]!,
      stylist_line: templateLine(
        planSlot.garment,
        ROLE_CYCLE[idx % ROLE_CYCLE.length]!,
        planSlot.style_direction,
      ),
    }));

    return { slot_id: planSlot.slot_id, picks };
  });

  const emptySlots = slots.filter((s) => s.picks.length === 0).map((s) => s.slot_id);
  const degraded = isDegradedOutfitPlan(params.plan);
  const thinParts = [
    ...params.thinSlots,
    ...emptySlots.filter((id) => !params.thinSlots.includes(id)),
  ];

  const label = recipientLabel(params.plan);
  const garmentList = params.plan.slots.map((s) => s.garment).join(", ");

  const plainThin =
    degraded
      ? `You asked for ${params.plan.brief.garments.join(", ")}; I only locked ${garmentList} this round — the set is incomplete.`
      : thinParts.length > 0
        ? `Fewer solid options than I'd like for ${thinParts.join(", ")} — here's what's genuinely in stock.`
        : `I couldn't finish a full stylist pass — these are the strongest verified picks for ${label}.`;

  const plainOpening =
    degraded || emptySlots.length > 0
      ? `Partial set only — ${params.plan.slots.length} of ${Math.min(params.plan.brief.garments.length, 5)} pieces made it through with verified stock.`
      : thinParts.length > 0
        ? `Thin on ${thinParts.join(", ")} — showing what actually works, not a full spread.`
        : `Here are the strongest verified picks for ${label}.`;

  const thinNote =
    degraded || thinParts.length > 0 || params.plan.plan_source === "fallback"
      ? plainThin
      : undefined;

  const narration = sanitizeCurationNarration({
    opening: plainOpening,
    thin_note: thinNote,
    brand_note: params.brandNote,
    budget_note: params.budgetNote,
    plainOpening,
    plainThin,
    traceId: params.traceId,
  });

  return {
    slots,
    vetoes: params.harvestedVetoes ?? [],
    narration,
  };
}
