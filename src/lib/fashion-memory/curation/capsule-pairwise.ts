import type { FashionSearchPlan } from "../search-planner/types";
import type { CurationRefRegistry } from "./types";
import type { RefEntry } from "./types";

function isTopGarment(garment: string): boolean {
  return /\b(shirt|blouse|top|sweater|tee)\b/i.test(garment);
}

function isBottomGarment(garment: string): boolean {
  return /\b(trousers|trouser|pants|pant|jeans|jean|skirts|skirt|bottoms|bottom)\b/i.test(
    garment,
  );
}

/** Whether candidate pairs with every remaining capsule piece via outfit definitions. */
export function passesCapsulePairwise(params: {
  candidate: RefEntry;
  remainingRefs: string[];
  capsuleOutfits: Array<{ item_refs: string[] }>;
  registry: CurationRefRegistry;
  plan: FashionSearchPlan;
}): boolean {
  const { candidate, remainingRefs, capsuleOutfits, registry, plan } = params;
  if (!capsuleOutfits.length) return true;

  const remaining = new Set(remainingRefs);
  const others = [...remaining].filter((r) => r !== candidate.ref);
  if (!others.length) return true;

  const candidateEntry = registry.get(candidate.ref);
  if (!candidateEntry) return false;

  const slotMeta = plan.slots.find((s) => s.slot_id === candidateEntry.slot_id);
  const garment = slotMeta?.garment ?? candidateEntry.candidate.title;

  for (const otherRef of others) {
    const other = registry.get(otherRef);
    if (!other) return false;

    const otherSlot = plan.slots.find((s) => s.slot_id === other.slot_id);
    const otherGarment = otherSlot?.garment ?? other.candidate.title;

    const needsPair =
      (isTopGarment(garment) && isBottomGarment(otherGarment)) ||
      (isBottomGarment(garment) && isTopGarment(otherGarment));

    if (!needsPair) continue;

    const hasOutfit = capsuleOutfits.some(
      (o) =>
        o.item_refs.includes(candidate.ref) && o.item_refs.includes(otherRef),
    );
    if (!hasOutfit) return false;
  }

  return true;
}

export function filterCapsuleSafeReplacements(params: {
  candidates: RefEntry[];
  remainingRefs: string[];
  capsuleOutfits: Array<{ item_refs: string[] }>;
  registry: CurationRefRegistry;
  plan: FashionSearchPlan;
}): RefEntry[] {
  return params.candidates.filter((c) =>
    passesCapsulePairwise({
      candidate: c,
      remainingRefs: params.remainingRefs,
      capsuleOutfits: params.capsuleOutfits,
      registry: params.registry,
      plan: params.plan,
    }),
  );
}
