import type { MessageMetadata, ProductSearchInvocation } from "../types";

/** True while a detached curator pass is still running (poll DB until it lands). */
export function invocationNeedsCurationEnhancement(
  inv: ProductSearchInvocation,
): boolean {
  return inv.curationPending === true;
}

export function messageNeedsCurationEnhancement(
  metadata?: MessageMetadata | null,
): boolean {
  return (
    metadata?.productSearch?.searches?.some(
      invocationNeedsCurationEnhancement,
    ) ?? false
  );
}
