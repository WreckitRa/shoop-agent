import type { FashionCurationPresentation } from "@/lib/fashion-memory/curation/types";
import type {
  RenderCapsuleOutfit,
  RenderContract,
  RenderLook,
} from "@/lib/fashion-memory/types/render-contract";
import { buildRenderContract } from "@/lib/fashion-memory/curation/build-render-contract";
import type { FashionSearchPlan } from "@/lib/fashion-memory/search-planner/types";
import { isSupabaseAuthUserId } from "@/lib/fashion-memory/auth";
import { getPersonById, resolvePersonIdRef } from "@/lib/fashion-memory/people";
import {
  isTryonOutfitsEnabledForUser,
  isTryonEnabledForUser,
} from "./feature-flags";
import { isGarmentTypeSupported } from "./garment-type";
import { hasStoredAvatar } from "./avatar/service";
import { TRYON_DISCLAIMER } from "./types";
import { capsuleLookId } from "./outfit-ids";
import { tryResolveTryonPersonId } from "./resolve-person";

async function isShoppingForSelf(
  userId: string,
  personId: string,
): Promise<boolean> {
  if (!personId?.trim()) return false;
  const resolved = await resolvePersonIdRef(userId, personId);
  if (!resolved) return false;
  const person = await getPersonById(userId, resolved);
  return person?.relation === "self";
}

/** True when the look has at least one dressable garment (skip bags/jewelry). */
function lookHasDressablePiece(
  itemRefs: string[],
  picksByRef: Map<string, { garment: string }>,
): boolean {
  if (!itemRefs.length) return false;
  return itemRefs.some((ref) => {
    const pick = picksByRef.get(ref);
    return Boolean(pick && isGarmentTypeSupported(pick.garment));
  });
}

type LookTryonState = {
  available: boolean;
  cta?: "create_avatar";
};

async function buildLookTryonState(params: {
  userId: string;
  shoppingForSelf: boolean;
  itemRefs: string[];
  picksByRef: Map<string, { garment: string }>;
  hasAvatar: boolean;
}): Promise<LookTryonState> {
  if (!params.shoppingForSelf) return { available: false };
  if (!lookHasDressablePiece(params.itemRefs, params.picksByRef)) {
    return { available: false };
  }
  if (params.hasAvatar) {
    if (!(await isTryonOutfitsEnabledForUser(params.userId))) {
      return { available: false };
    }
    return { available: true };
  }
  return { available: false, cta: "create_avatar" };
}

type PickTryonState = {
  available: boolean;
  cta?: "create_avatar";
};

function buildPickTryonState(params: {
  shoppingForSelf: boolean;
  tryonEnabled: boolean;
  hasAvatar: boolean;
  garment: string;
  isHero: boolean;
}): PickTryonState {
  if (!params.shoppingForSelf || !params.isHero) return { available: false };
  if (!isGarmentTypeSupported(params.garment)) return { available: false };

  if (params.hasAvatar) {
    return { available: params.tryonEnabled };
  }

  return { available: false, cta: "create_avatar" };
}

type TryonFlags = {
  userId: string;
  shoppingForSelf: boolean;
  tryonEnabled: boolean;
  hasAvatar: boolean;
};

async function applyTryonFlags(
  render: RenderContract,
  plan: FashionSearchPlan,
  flags: TryonFlags,
): Promise<RenderContract> {
  const isSingleMode = plan.mode === "single_item" || plan.mode === "multi_item";

  const picksByRef = new Map(
    render.tiers.picks.map((p) => [p.ref, { garment: p.garment }]),
  );

  const picks = render.tiers.picks.map((pick) => {
    const state = buildPickTryonState({
      shoppingForSelf: flags.shoppingForSelf,
      tryonEnabled: flags.tryonEnabled,
      hasAvatar: flags.hasAvatar,
      garment: pick.garment,
      isHero: isSingleMode,
    });
    return {
      ...pick,
      tryon: {
        available: state.available,
        ...(state.cta ? { cta: state.cta } : {}),
        disclaimer: TRYON_DISCLAIMER,
      },
    };
  });

  let looks: RenderLook[] | undefined;
  if (render.looks?.length) {
    looks = await Promise.all(
      render.looks.map(async (look) => {
        const state = await buildLookTryonState({
          userId: flags.userId,
          shoppingForSelf: flags.shoppingForSelf,
          itemRefs: look.item_refs,
          picksByRef,
          hasAvatar: flags.hasAvatar,
        });
        return {
          ...look,
          tryon: {
            available: state.available,
            ...(state.cta ? { cta: state.cta } : {}),
            disclaimer: TRYON_DISCLAIMER,
          },
        };
      }),
    );
  }

  let capsule_outfits: RenderCapsuleOutfit[] | undefined;
  if (render.capsule_outfits?.length) {
    capsule_outfits = await Promise.all(
      render.capsule_outfits.map(async (outfit, index) => {
        const state = await buildLookTryonState({
          userId: flags.userId,
          shoppingForSelf: flags.shoppingForSelf,
          itemRefs: outfit.item_refs,
          picksByRef,
          hasAvatar: flags.hasAvatar,
        });
        return {
          ...outfit,
          look_id: capsuleLookId(index, outfit.label),
          tryon: {
            available: state.available,
            ...(state.cta ? { cta: state.cta } : {}),
            disclaimer: TRYON_DISCLAIMER,
          },
        };
      }),
    );
  }

  return {
    ...render,
    tiers: { ...render.tiers, picks },
    looks,
    capsule_outfits,
  };
}

const NO_AVATAR_FLAGS = {
  shoppingForSelf: true,
  tryonEnabled: false,
  hasAvatar: false,
} as const;

/** Attach per-pick and outfit/capsule try-on availability to a render contract. */
export async function attachTryonToRenderContract(params: {
  render: RenderContract;
  presentation: FashionCurationPresentation;
  plan: FashionSearchPlan;
  userId: string;
}): Promise<RenderContract> {
  try {
    const isAuth = isSupabaseAuthUserId(params.userId);
    if (!isAuth) {
      return applyTryonFlags(params.render, params.plan, {
        userId: params.userId,
        ...NO_AVATAR_FLAGS,
      });
    }

    const personId = await tryResolveTryonPersonId(
      params.userId,
      params.plan.brief.recipient_person_id,
    );
    if (!personId) {
      return applyTryonFlags(params.render, params.plan, {
        userId: params.userId,
        ...NO_AVATAR_FLAGS,
      });
    }

    const shoppingForSelf = await isShoppingForSelf(params.userId, personId);
    const tryonEnabled =
      shoppingForSelf && (await isTryonEnabledForUser(params.userId));
    const hasAvatar = shoppingForSelf
      ? await hasStoredAvatar(params.userId, personId)
      : false;

    return applyTryonFlags(params.render, params.plan, {
      userId: params.userId,
      shoppingForSelf,
      tryonEnabled,
      hasAvatar,
    });
  } catch {
    // Search results must still render — never 500 the turn over a missing twin.
    return applyTryonFlags(params.render, params.plan, {
      userId: params.userId,
      ...NO_AVATAR_FLAGS,
    });
  }
}

export async function buildRenderContractWithTryon(params: {
  presentation: FashionCurationPresentation;
  plan: FashionSearchPlan;
  userId: string;
  invisibleHiccups?: boolean;
  exhausted?: boolean;
  recurateUsed?: boolean;
}): Promise<RenderContract> {
  const base = buildRenderContract(params);
  return attachTryonToRenderContract({
    render: base,
    presentation: params.presentation,
    plan: params.plan,
    userId: params.userId,
  });
}
