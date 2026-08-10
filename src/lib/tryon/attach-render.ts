import type { FashionCurationPresentation } from "@/lib/fashion-memory/curation/types";
import type {
  RenderCapsuleOutfit,
  RenderContract,
  RenderLook,
} from "@/lib/fashion-memory/types/render-contract";
import { buildRenderContract } from "@/lib/fashion-memory/curation/build-render-contract";
import type { FashionSearchPlan } from "@/lib/fashion-memory/search-planner/types";
import { getPersonById, resolvePersonIdRef } from "@/lib/fashion-memory/people";
import {
  isTryonOutfitsEnabledForUser,
  isTryonEnabledForUser,
} from "./feature-flags";
import { isGarmentTypeSupported } from "./garment-type";
import { buildPickTryonAvailability } from "./run-single";
import { getStoredAvatar } from "./avatar/service";
import { TRYON_DISCLAIMER } from "./types";
import { capsuleLookId } from "./outfit-ids";
import { CURATION_HERO_PICKS } from "@/lib/fashion-memory/curation/deliverables";
import { resolveTryonPersonId } from "./resolve-person";

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
  personId: string;
  shoppingForSelf: boolean;
  itemRefs: string[];
  picksByRef: Map<string, { garment: string }>;
  hasAvatar: boolean;
}): Promise<LookTryonState> {
  if (!params.shoppingForSelf) return { available: false };
  // Accessories / bags kill dress APIs — still show try-on if shirt/pants/etc. exist.
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

async function buildPickTryonState(params: {
  userId: string;
  personId: string;
  shoppingForSelf: boolean;
  tryonEnabled: boolean;
  hasAvatar: boolean;
  garment: string;
  isHero: boolean;
}): Promise<PickTryonState> {
  if (!params.shoppingForSelf || !params.isHero) return { available: false };
  if (!isGarmentTypeSupported(params.garment)) return { available: false };

  if (params.hasAvatar) {
    if (!params.tryonEnabled) return { available: false };
    const available = await buildPickTryonAvailability({
      userId: params.userId,
      personId: params.personId,
      garment: params.garment,
    });
    return { available };
  }

  // No avatar yet — invite creation on hero picks so try-on is discoverable.
  return { available: false, cta: "create_avatar" };
}

/** Attach per-pick and outfit/capsule try-on availability to a render contract. */
export async function attachTryonToRenderContract(params: {
  render: RenderContract;
  presentation: FashionCurationPresentation;
  plan: FashionSearchPlan;
  userId: string;
}): Promise<RenderContract> {
  const personId = await resolveTryonPersonId(
    params.userId,
    params.plan.brief.recipient_person_id,
  );
  const shoppingForSelf = await isShoppingForSelf(params.userId, personId);
  const tryonEnabled =
    shoppingForSelf && (await isTryonEnabledForUser(params.userId));
  const hasAvatar = shoppingForSelf
    ? Boolean(await getStoredAvatar(params.userId, personId))
    : false;

  const mode = params.plan.mode;
  const isSingleMode = mode === "single_item" || mode === "multi_item";

  const picksByRef = new Map(
    params.render.tiers.picks.map((p) => [p.ref, { garment: p.garment }]),
  );

  // Single / multi: try-on / create-avatar on hero picks only.
  // Outfit / capsule: try-on lives on the look — not on each piece card.
  const heroCap = isSingleMode ? CURATION_HERO_PICKS : 0;

  const picks = await Promise.all(
    params.render.tiers.picks.map(async (pick, index) => {
      const state = await buildPickTryonState({
        userId: params.userId,
        personId,
        shoppingForSelf,
        tryonEnabled,
        hasAvatar,
        garment: pick.garment,
        isHero: index < heroCap,
      });
      return {
        ...pick,
        tryon: {
          available: state.available,
          ...(state.cta ? { cta: state.cta } : {}),
          disclaimer: TRYON_DISCLAIMER,
        },
      };
    }),
  );

  let looks: RenderLook[] | undefined;
  if (params.render.looks?.length) {
    looks = await Promise.all(
      params.render.looks.map(async (look) => {
        const state = await buildLookTryonState({
          userId: params.userId,
          personId,
          shoppingForSelf,
          itemRefs: look.item_refs,
          picksByRef,
          hasAvatar,
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
  if (params.render.capsule_outfits?.length) {
    capsule_outfits = await Promise.all(
      params.render.capsule_outfits.map(async (outfit, index) => {
        const state = await buildLookTryonState({
          userId: params.userId,
          personId,
          shoppingForSelf,
          itemRefs: outfit.item_refs,
          picksByRef,
          hasAvatar,
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
    ...params.render,
    tiers: { ...params.render.tiers, picks },
    looks,
    capsule_outfits,
  };
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
