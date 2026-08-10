import { prisma } from "@/lib/ai-chat/db";
import type { MessageMetadata } from "@/lib/ai-chat/types";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import type { MessageFashionCurationMetaV1 } from "./types";
import type { FashionSearchPlan } from "../search-planner/types";
import type { RenderContract } from "../types/render-contract";
import { buildRefRegistry } from "./refs";
import type { CurationRefRegistry } from "./types";
import {
  loadSlotPool,
  type RehydratedSlotPool,
} from "../hydration/pool-persistence";

export type LoadedSearchState = {
  messageId: string;
  userId: string;
  metadata: MessageMetadata;
  curation: MessageFashionCurationMetaV1;
  plan: FashionSearchPlan;
  occasionContext: string;
  registry: CurationRefRegistry;
};

export function planFromMetadata(metadata: MessageMetadata): FashionSearchPlan | null {
  const planMeta = metadata.fashionSearchPlan;
  if (!planMeta) return null;
  const routerBrief = metadata.fashionRouter?.brief;
  const garments = planMeta.slots.map((s) => s.garment);
  return {
    version: 1,
    mode: planMeta.mode,
    reasoning: planMeta.reasoning ?? "",
    currentDate: new Date().toISOString().slice(0, 10),
    brief: routerBrief ?? {
      recipient_person_id: planMeta.recipient_person_id,
      request_type:
        planMeta.mode === "single_item"
          ? "single_item"
          : planMeta.mode === "capsule"
            ? "capsule"
            : planMeta.mode === "multi_item"
              ? "multi_item"
              : "outfit",
      garments,
      occasion_context: "general",
      quantity_hint: "one",
      must_haves: [],
      nice_to_haves: [],
      budget_context: { stated: false },
      style_direction: garments.join(", "),
      knowledge_state: planMeta.knowledge_state,
    },
    slots: planMeta.slots,
    budget_allocation: planMeta.budget_assembly
      ? {
          bounds: new Map(),
          per_slot: Object.fromEntries(
            Object.entries(planMeta.per_slot_budget ?? {}).map(([id, a]) => [
              id,
              {
                fraction: a.fraction,
                fraction_source: a.fraction_source,
                allocated_max: a.allocated_max,
                padded_max: a.padded_max,
              },
            ]),
          ),
          validation: planMeta.budget_allocation_validation ?? "accepted",
          budget_assembly: planMeta.budget_assembly,
          budget_interpretation: planMeta.budget_interpretation,
        }
      : undefined,
  };
}

export async function loadSearchState(
  messageId: string,
  userId: string,
): Promise<LoadedSearchState | null> {
  const row = await prisma.message.findUnique({
    where: { id: messageId },
    select: { metadata: true },
  });
  if (!row?.metadata) return null;
  const metadata = row.metadata as MessageMetadata;
  const catalog = metadata.fashionCatalogSearch;
  const curation = catalog?.curation;
  const plan = planFromMetadata(metadata);
  if (!catalog || !curation || !plan) return null;

  const registry = buildRefRegistry({
    mode: plan.mode,
    slots: catalog.slots.map((slot) => ({
      slot_id: slot.slot_id,
      planSlot: plan.slots.find((p) => p.slot_id === slot.slot_id)!,
      verified: slot.verified_pool ?? [],
    })),
  });

  return {
    messageId,
    userId,
    metadata,
    curation,
    plan,
    occasionContext:
      metadata.fashionRouter?.brief?.occasion_context ??
      plan.brief.occasion_context ??
      "general",
    registry,
  };
}

export async function persistCuration(
  messageId: string,
  metadata: MessageMetadata,
  curation: MessageFashionCurationMetaV1,
  render?: RenderContract,
): Promise<void> {
  await prisma.message.update({
    where: { id: messageId },
    data: {
      metadata: {
        ...metadata,
        fashionCatalogSearch: {
          ...metadata.fashionCatalogSearch!,
          curation,
          ...(render ? { render } : {}),
        },
      } as InputJsonValue,
    },
  });
}

export async function loadPoolForSlot(params: {
  searchId: string;
  slotId: string;
  userId: string;
  hydrateFn?: import("../hydration/pool").CreateSlotPoolParams["hydrateFn"];
}): Promise<RehydratedSlotPool | null> {
  return loadSlotPool({
    searchId: params.searchId,
    slotId: params.slotId,
    userId: params.userId,
    hydrateFn: params.hydrateFn,
  });
}

export function pickBelongsToLook(
  curation: MessageFashionCurationMetaV1,
  ref: string,
): string | null {
  for (const look of curation.looks ?? []) {
    if (look.item_refs.includes(ref)) return look.name;
  }
  return null;
}

export function recomputeLookTotalFromPresentation(
  look: { item_refs: string[] },
  curation: MessageFashionCurationMetaV1,
): number {
  let total = 0;
  for (const ref of look.item_refs) {
    const pick = curation.tiers.picks.find((p) => p.ref === ref);
    const verified = curation.tiers.verified.find((v) => v.ref === ref);
    const item = pick ?? verified;
    if (item?.displayPrice?.amount != null) {
      total += item.displayPrice.amount / 100;
    }
  }
  return Math.round(total * 100) / 100;
}

export function validateLookBudget(params: {
  lookTotal: number;
  curation: MessageFashionCurationMetaV1;
  metadata: MessageMetadata;
}): boolean {
  const ceiling =
    params.metadata.fashionCatalogSearch?.budget_assembly?.total_max;
  if (ceiling == null) return true;
  const tolerance =
    params.metadata.fashionCatalogSearch?.budget_assembly?.tolerance ?? 0.1;
  return params.lookTotal <= ceiling * (1 + tolerance);
}

export function validateSetTotal(params: {
  curation: MessageFashionCurationMetaV1;
  metadata: MessageMetadata;
}): boolean {
  const assembly = params.metadata.fashionCatalogSearch?.budget_assembly;
  if (!assembly || assembly.constraint_type !== "set_total") return true;
  const setTotal = params.curation.meta.set_total ?? 0;
  const tolerance = assembly.tolerance ?? 0.1;
  return setTotal <= assembly.total_max * (1 + tolerance);
}
