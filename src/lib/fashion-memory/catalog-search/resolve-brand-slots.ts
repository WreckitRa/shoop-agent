import { logAiChat } from "@/lib/ai-chat/observability";
import type { AbortScope } from "@/lib/ai-chat/abort-scope";
import {
  BRAND_MIN_POOL,
  buildBrandNarration,
  buildTranslatedQueryVariants,
  decideBrandStatus,
  markBrandConfirmedOnProducts,
  statedBrands,
  translateBrandStyle,
  type BrandTranslation,
} from "../brand/brand-handling";
import type { FashionSearchBrief } from "../router/types";
import type { FashionSearchPlan, FashionSearchPlanSlot } from "../search-planner/types";
import { searchCatalogForSlot } from "./search-catalog-for-slot";
import type {
  FashionSearchProfile,
  FashionSlotCatalogProduct,
  FashionSlotCatalogResult,
} from "./types";

function mergeProductsPreferConfirmed(
  existing: FashionSlotCatalogProduct[],
  incoming: FashionSlotCatalogProduct[],
): FashionSlotCatalogProduct[] {
  const byId = new Map<string, FashionSlotCatalogProduct>();
  for (const p of [...existing, ...incoming]) {
    const prev = byId.get(p.id);
    if (!prev) {
      byId.set(p.id, p);
      continue;
    }
    byId.set(p.id, {
      ...prev,
      ...p,
      brand_confirmed: Boolean(prev.brand_confirmed || p.brand_confirmed),
      matched_by: [...new Set([...(prev.matched_by ?? []), ...(p.matched_by ?? [])])],
    });
  }
  return [...byId.values()];
}

/**
 * After initial fan-out: verify brand matches, decide mode, optionally
 * translate + re-retrieve. Confirmed brand hits are never discarded.
 */
export async function resolveBrandForCatalogSlots(params: {
  plan: FashionSearchPlan;
  slots: FashionSlotCatalogResult[];
  profile: FashionSearchProfile;
  accessToken: string;
  signal?: AbortSignal;
  abortScope?: AbortScope;
  traceId?: string | null;
  createMessage?: Parameters<typeof translateBrandStyle>[0]["createMessage"];
  /** Prefetched during catalog fan-out so brand LLM overlaps retrieval. */
  preTranslations?: Map<string, BrandTranslation>;
}): Promise<{
  plan: FashionSearchPlan;
  slots: FashionSlotCatalogResult[];
  brandNarration: string | null;
}> {
  const brands = statedBrands(params.plan.brief);
  if (!brands.length) {
    return { plan: params.plan, slots: params.slots, brandNarration: null };
  }

  const updatedSlots: FashionSlotCatalogResult[] = [];
  const updatedPlanSlots: FashionSearchPlanSlot[] = [];
  let primaryTranslation: BrandTranslation | null = null;
  let primaryStatus: ReturnType<typeof decideBrandStatus> = "confirmed";
  let primaryConfirmed = 0;

  for (let i = 0; i < params.slots.length; i++) {
    const slotResult = params.slots[i]!;
    const planSlot = params.plan.slots[i] ?? params.plan.slots.find((s) => s.slot_id === slotResult.slot_id);
    if (!planSlot) {
      updatedSlots.push(slotResult);
      continue;
    }

    const marked = markBrandConfirmedOnProducts(slotResult.products, brands);
    let products = marked.products;
    let confirmedCount = marked.confirmedCount;
    let status = decideBrandStatus(confirmedCount, BRAND_MIN_POOL);
    let translation: BrandTranslation | null = null;

    if (status !== "confirmed") {
      translation =
        params.preTranslations?.get(planSlot.slot_id) ??
        (await translateBrandStyle({
          brand: brands[0]!,
          garment: planSlot.garment,
          brief: params.plan.brief,
          signal: params.signal,
          traceId: params.traceId,
          createMessage: params.createMessage,
        }));
      primaryTranslation = primaryTranslation ?? translation;

      const translatedVariants = buildTranslatedQueryVariants({
        slot: planSlot,
        brief: params.plan.brief,
        translation,
        brands,
      });

      // Keep probe as variant 0; replace fallbacks with translated DNA queries.
      const probe = planSlot.query_variants[0];
      const nextSlot: FashionSearchPlanSlot = {
        ...planSlot,
        query_variants: probe
          ? [probe, ...translatedVariants.filter((v) => v !== probe)].slice(0, 3)
          : translatedVariants,
      };

      logAiChat("info", "fashion_brand_translation_rerun", {
        traceId: params.traceId,
        slot_id: planSlot.slot_id,
        brand: brands[0],
        confirmed_before: confirmedCount,
        status,
        descriptors: translation.style_descriptors,
      });

      const rerun = await searchCatalogForSlot({
        slot: nextSlot,
        brief: params.plan.brief,
        profile: params.profile,
        accessToken: params.accessToken,
        signal: params.signal,
        abortScope: params.abortScope,
        traceId: params.traceId,
      });

      const rerunMarked = markBrandConfirmedOnProducts(rerun.products, brands);
      products = mergeProductsPreferConfirmed(products, rerunMarked.products);
      confirmedCount = products.filter((p) => p.brand_confirmed).length;
      status = decideBrandStatus(confirmedCount, BRAND_MIN_POOL);
      // After translation we still label as translated/partial for narration.
      if (confirmedCount < BRAND_MIN_POOL) {
        status = confirmedCount > 0 ? "partial" : "translated";
      }

      updatedPlanSlots.push({
        ...nextSlot,
        brand_status: status,
        brand_sanity_note: translation.sanity_note,
        brand_confirmed_count: confirmedCount,
        brand_style_descriptors: translation.style_descriptors,
      });

      updatedSlots.push({
        ...slotResult,
        ...rerun,
        products,
        brand_status: status,
        brand_sanity_note: translation.sanity_note,
        brand_confirmed_count: confirmedCount,
        counts: {
          ...rerun.counts,
          unique_products: products.length,
        },
        query_variants_used: [
          ...slotResult.query_variants_used,
          ...rerun.query_variants_used,
        ],
        query_logs: [...slotResult.query_logs, ...rerun.query_logs],
      });
    } else {
      updatedPlanSlots.push({
        ...planSlot,
        brand_status: status,
        brand_confirmed_count: confirmedCount,
      });
      updatedSlots.push({
        ...slotResult,
        products,
        brand_status: status,
        brand_confirmed_count: confirmedCount,
      });
    }

    if (i === 0 || confirmedCount > primaryConfirmed) {
      primaryStatus = status;
      primaryConfirmed = confirmedCount;
      if (translation) primaryTranslation = translation;
    }
  }

  // Fill any missing plan slots
  while (updatedPlanSlots.length < params.plan.slots.length) {
    const idx = updatedPlanSlots.length;
    updatedPlanSlots.push(params.plan.slots[idx]!);
  }

  const brandNarration = buildBrandNarration({
    brands,
    status: primaryStatus,
    translation: primaryTranslation,
    confirmedCount: primaryConfirmed,
  });

  return {
    plan: { ...params.plan, slots: updatedPlanSlots },
    slots: updatedSlots,
    brandNarration,
  };
}

export function briefHasStatedBrand(brief: FashionSearchBrief): boolean {
  return statedBrands(brief).length > 0;
}
