import type { FashionCurationPresentation } from "./types";
import type {
  RenderContract,
  RenderPickBadge,
} from "../types/render-contract";
import { RENDER_CONTRACT_VERSION } from "../types/render-contract";
import { computeDegradation } from "./degradation";
import type { FashionSearchPlan } from "../search-planner/types";
import type { FashionCuratedPickBadge } from "./types";

function mapBadge(badge: FashionCuratedPickBadge): RenderPickBadge {
  switch (badge.kind) {
    case "converted_size":
      return {
        kind: "size_converted",
        from: badge.from,
        merchant_label: badge.label,
      };
    case "check_sizing":
      return { kind: "size_unknown" };
    case "material_suspected":
      return {
        kind: "material_suspected",
        material: badge.material,
      };
    case "photo_color":
      return {
        kind: "photo_color",
        color: badge.color,
        listed: badge.listed,
      };
    case "near_budget_lifted":
      return { kind: "near_budget_lifted" };
    case "brand_unconfirmed":
      return { kind: "brand_unconfirmed" };
    default: {
      const _exhaustive: never = badge;
      void _exhaustive;
      return { kind: "size_unknown" };
    }
  }
}

export function buildRenderContract(params: {
  presentation: FashionCurationPresentation;
  plan: FashionSearchPlan;
  invisibleHiccups?: boolean;
  exhausted?: boolean;
  recurateUsed?: boolean;
}): RenderContract {
  const degradation = computeDegradation({
    presentation: params.presentation,
    plan: params.plan,
    invisibleHiccups: params.invisibleHiccups,
  });

  return {
    contract_version: RENDER_CONTRACT_VERSION,
    narration: {
      ...params.presentation.narration,
      degradation,
    },
    tiers: {
      picks: params.presentation.tiers.picks.map((p) => ({
        ref: p.ref,
        slot_id: p.slot_id,
        garment: p.garment,
        id: p.id,
        title: p.title,
        imageUrl: p.imageUrl,
        displayPrice: p.displayPrice,
        preferredOptions: p.preferredOptions,
        featuredVariant: p.featuredVariant,
        role: p.role,
        stylist_line: p.stylist_line,
        badges: p.badges.map(mapBadge),
        look_names: p.look_names,
        corrected_color: p.corrected_color,
        score_rank: p.score_rank,
        product_url: (p as { product_url?: string }).product_url,
      })),
      verified: params.presentation.tiers.verified.map((v) => ({
        ref: v.ref,
        slot_id: v.slot_id,
        garment: v.garment,
        id: v.id,
        title: v.title,
        imageUrl: v.imageUrl,
        displayPrice: v.displayPrice,
        preferredOptions: v.preferredOptions,
        featuredVariant: v.featuredVariant,
        score_rank: v.score_rank,
        size_status: v.size_status,
        product_url: (v as { product_url?: string }).product_url,
      })),
      unverified: params.presentation.tiers.unverified.map((u) => ({
        product_id: u.product_id,
        slot_id: u.slot_id,
        garment: u.garment,
        title: u.title,
        price: u.price,
        image_url: u.image_url,
        score_rank: u.score_rank,
        verification: u.verification,
        size_note: u.size_note,
      })),
    },
    looks: params.presentation.looks,
    capsule_outfits: params.presentation.capsule_outfits,
    meta: {
      mode: params.presentation.meta.mode,
      thin_slots: params.presentation.meta.thin_slots,
      set_total: params.presentation.meta.set_total,
      budget_tension: params.presentation.meta.budget_tension,
      fallback: params.presentation.meta.fallback,
    },
    affordances: {
      can_recurate:
        degradation.kind === "curation_fallback" && !params.recurateUsed,
      exhausted: params.exhausted ?? false,
      suggest_new_search: params.exhausted ?? false,
    },
  };
}
