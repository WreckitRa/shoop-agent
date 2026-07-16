import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { buildRefRegistry } from "@/lib/fashion-memory/curation/refs";
import { CURATION_TOOL_NAME } from "@/lib/fashion-memory/curation/config";
import type { DeliverCurationInput } from "@/lib/fashion-memory/curation/types";
import type { FashionCatalogSearchResult } from "@/lib/fashion-memory/catalog-search/types";
import type { FashionSearchPlan } from "@/lib/fashion-memory/search-planner/types";
import { toolMessage } from "./llm-mock";

export function buildCurationToolInput(params: {
  catalog: FashionCatalogSearchResult;
  plan: FashionSearchPlan;
  options?: {
    brandNote?: string;
    capsuleOutfits?: boolean;
    opening?: string;
  };
}): DeliverCurationInput {
  const registry = buildRefRegistry({
    mode: params.plan.mode,
    slots: params.catalog.slots.map((slot) => ({
      slot_id: slot.slot_id,
      planSlot: params.plan.slots.find((p) => p.slot_id === slot.slot_id)!,
      verified: slot.verified_pool ?? [],
    })),
  });

  const slots = params.plan.slots.map((planSlot) => {
    const refs = [...registry.entries()]
      .filter(([, e]) => e.slot_id === planSlot.slot_id)
      .map(([ref]) => ref)
      .slice(0, Math.max(1, planSlot.options_wanted));
    return {
      slot_id: planSlot.slot_id,
      picks: refs.map((ref, i) => ({
        ref,
        role: i === 0 ? ("safe" as const) : ("value" as const),
        stylist_line: `Verified ${planSlot.garment} — ref-aligned E2E pick ${i + 1}.`,
      })),
    };
  });

  const allRefs = slots.flatMap((s) => s.picks.map((p) => p.ref));
  const capsule_outfits =
    params.options?.capsuleOutfits && allRefs.length >= 2
      ? [
          { item_refs: allRefs.slice(0, Math.min(3, allRefs.length)), label: "Rotation A" },
          { item_refs: allRefs.slice(0, Math.min(3, allRefs.length)), label: "Rotation B" },
        ]
      : undefined;

  const interpretation = params.plan.budget_allocation?.budget_interpretation;
  const needsBudgetNote =
    interpretation === "per_item_stated" ||
    interpretation === "per_item_assumed" ||
    interpretation === "set_total_assumed" ||
    interpretation === "total_stated";
  const budgetMax = params.plan.brief.budget_context.max;

  return {
    slots,
    capsule_outfits,
    vetoes: [],
    narration: {
      opening:
        params.options?.opening ??
        "Here is a verified shortlist built from ref-aligned E2E recordings.",
      brand_note: params.options?.brandNote,
      ...(needsBudgetNote
        ? {
            budget_note:
              budgetMax != null
                ? `Working within your $${Math.round(budgetMax)} budget (${interpretation}).`
                : `Working within your stated budget (${interpretation}).`,
          }
        : {}),
    },
  };
}

export function buildCurationToolInputFromSlots(params: {
  plan: FashionSearchPlan;
  slots: Array<{ slot_id: string; verified_pool?: import("@/lib/fashion-memory/hydration/types").HydratedCandidate[] }>;
  options?: Parameters<typeof buildCurationToolInput>[0]["options"];
}): DeliverCurationInput {
  return buildCurationToolInput({
    catalog: {
      version: 1,
      plan: params.plan,
      timing_ms: 0,
      slots: params.slots.map((s) => ({
        slot_id: s.slot_id,
        garment: params.plan.slots.find((p) => p.slot_id === s.slot_id)?.garment ?? s.slot_id,
        verified_pool: s.verified_pool,
        products: [],
        query_variants_used: [],
        counts: {
          unique_products: s.verified_pool?.length ?? 0,
          per_variant: [],
          reformulated: false,
        },
        query_logs: [],
      })),
    },
    plan: params.plan,
    options: params.options,
  });
}

export function curationMessageFromSlots(params: {
  plan: FashionSearchPlan;
  slots: Array<{ slot_id: string; verified_pool?: import("@/lib/fashion-memory/hydration/types").HydratedCandidate[] }>;
  options?: Parameters<typeof buildCurationToolInput>[0]["options"];
}): Message {
  const input = buildCurationToolInputFromSlots(params);
  return toolMessage(CURATION_TOOL_NAME, input as unknown as Record<string, unknown>);
}

export function curationMessageFromCatalog(params: {
  catalog: FashionCatalogSearchResult;
  plan: FashionSearchPlan;
  options?: Parameters<typeof buildCurationToolInput>[0]["options"];
}): Message {
  const input = buildCurationToolInput(params);
  return toolMessage(CURATION_TOOL_NAME, input as unknown as Record<string, unknown>);
}
