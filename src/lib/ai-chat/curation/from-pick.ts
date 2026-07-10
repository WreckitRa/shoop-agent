import type { ProductCurationDto } from "@/lib/ai-chat/curation/serialize";
import type { CuratedPick } from "@/lib/ai-chat/types";

/** Map an in-chat curated pick to the PDP curation DTO shape. */
export function productCurationFromChatPick(
  pick: CuratedPick,
  productId: string,
): ProductCurationDto {
  return {
    productExternalId: productId,
    slot: pick.slot,
    reason: pick.reason,
    verdict: pick.verdict,
    searchQuery: null,
    productTitle: pick.title,
    productImageUrl: pick.imageUrl ?? null,
    updatedAt: new Date().toISOString(),
    insight: pick.insight,
  };
}
