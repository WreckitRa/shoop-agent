import type { ProductCard } from "@/lib/ai-chat/types";
import {
  writeFashionPickAcceptance,
  writeFashionPickRejection,
} from "../direct-writes";
import type {
  FashionCurationPresentation,
  FashionCuratedPick,
  FashionVerifiedTierItem,
} from "./types";

export type CurationState = FashionCurationPresentation;

export function promotePick(params: {
  state: CurationState;
  ref: string;
  demotedRef?: string;
}): CurationState {
  const verifiedIdx = params.state.tiers.verified.findIndex(
    (v) => v.ref === params.ref,
  );
  if (verifiedIdx < 0) return params.state;

  const promoted = params.state.tiers.verified[verifiedIdx]!;
  const newPick: FashionCuratedPick = {
    ...promoted,
    role: "safe",
    stylist_line: "Promoted from verified bench — still a strong match.",
    badges: [],
  };

  let picks = [...params.state.tiers.picks];
  if (params.demotedRef) {
    const demotedIdx = picks.findIndex((p) => p.ref === params.demotedRef);
    if (demotedIdx >= 0) {
      const demoted = picks[demotedIdx]!;
      picks = picks.filter((p) => p.ref !== params.demotedRef);
      const backToVerified: FashionVerifiedTierItem = {
        id: demoted.id,
        title: demoted.title,
        imageUrl: demoted.imageUrl,
        displayPrice: demoted.displayPrice,
        featuredVariant: demoted.featuredVariant,
        ref: demoted.ref,
        slot_id: demoted.slot_id,
        garment: demoted.garment,
        score_rank: demoted.score_rank,
        brand_confirmed: demoted.brand_confirmed,
      };
      params.state.tiers.verified.push(backToVerified);
    }
  }

  picks.push(newPick);
  const verified = params.state.tiers.verified.filter(
    (v) => v.ref !== params.ref,
  );

  return {
    ...params.state,
    tiers: {
      ...params.state.tiers,
      picks,
      verified,
    },
  };
}

export function rejectPick(params: {
  state: CurationState;
  ref: string;
}): { state: CurationState; replacement?: FashionVerifiedTierItem } {
  const pickIdx = params.state.tiers.picks.findIndex((p) => p.ref === params.ref);
  if (pickIdx < 0) return { state: params.state };

  const rejected = params.state.tiers.picks[pickIdx]!;
  const slotId = rejected.slot_id;

  const verifiedSameSlot = params.state.tiers.verified
    .filter((v) => v.slot_id === slotId)
    .sort((a, b) => a.score_rank - b.score_rank);

  const replacement = verifiedSameSlot[0];
  let picks = params.state.tiers.picks.filter((p) => p.ref !== params.ref);
  let verified = params.state.tiers.verified;

  if (replacement) {
    picks.push({
      ...replacement,
      role: rejected.role,
      stylist_line: "Swapped in from verified bench after your pass.",
      badges: [],
    });
    verified = verified.filter((v) => v.ref !== replacement.ref);
  }

  return {
    state: {
      ...params.state,
      tiers: { ...params.state.tiers, picks, verified },
    },
    replacement,
  };
}

export async function writePromoteSignals(params: {
  userId: string;
  promoted: ProductCard;
  demoted?: ProductCard;
  conversationId?: string;
}): Promise<void> {
  await writeFashionPickAcceptance({
    userId: params.userId,
    product: params.promoted,
    conversationId: params.conversationId,
  });
  if (params.demoted) {
    await writeFashionPickRejection({
      userId: params.userId,
      product: params.demoted,
      reason: "demoted_for_promote",
    });
  }
}

export async function writeRejectSignal(params: {
  userId: string;
  product: ProductCard;
  reason?: string;
}): Promise<void> {
  await writeFashionPickRejection({
    userId: params.userId,
    product: params.product,
    reason: params.reason ?? "user_rejected_pick",
  });
}

export function collectExcludedRefs(state: CurationState): string[] {
  return [
    ...state.tiers.picks.map((p) => p.ref),
    ...state.tiers.verified.map((v) => v.ref),
  ];
}
