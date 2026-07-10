import type { MessageMetadata } from "@/lib/ai-chat/types";

export function isProductCurationPendingInMessage(
  metadata: MessageMetadata | null | undefined,
  productId: string,
): boolean {
  const searches = metadata?.productSearch?.searches ?? [];
  for (const inv of searches) {
    if (inv.curationPending !== true) continue;
    if (inv.products.some((p) => p.id === productId)) return true;
    if (inv.curatedPicks?.some((p) => p.id === productId)) return true;
  }
  return false;
}

export function messageHasPendingProductCuration(
  metadata: MessageMetadata | null | undefined,
): boolean {
  return (
    metadata?.productSearch?.searches?.some(
      (inv) => inv.curationPending === true,
    ) ?? false
  );
}
