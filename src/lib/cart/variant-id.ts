import type { ActiveCartState } from "@/lib/cart/types";
import type { Cart } from "@/lib/shopify/cart";

/** Legacy numeric resource id from a Shopify GID or plain numeric string. */
export function extractNumericShopifyResourceId(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const tail = trimmed.split("/").pop();
  if (tail && /^\d+$/.test(tail)) return tail;
  return null;
}

/** Normalize Shopify / catalog variant ids for comparison. */
export function normalizeVariantId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return trimmed;
  try {
    if (trimmed.startsWith("gid://")) {
      return decodeURIComponent(trimmed).toLowerCase();
    }
  } catch {
    /* keep raw */
  }
  return trimmed.toLowerCase();
}

export function variantIdsMatch(a: string, b: string): boolean {
  const na = normalizeVariantId(a);
  const nb = normalizeVariantId(b);
  if (na === nb) return true;
  const tailA = na.split("/").pop() ?? na;
  const tailB = nb.split("/").pop() ?? nb;
  return tailA.length > 0 && tailA === tailB;
}

export function cartContainsVariant(
  cart: ActiveCartState | null,
  variantId: string,
): boolean {
  if (!cart?.lineItems.length) return false;
  return cart.lineItems.some((line) => variantIdsMatch(line.variantId, variantId));
}

/** Extract variant id from a Cart MCP line (shape varies by merchant). */
export function resolveCartLineVariantId(
  line: Cart["line_items"][number],
): string | null {
  const item = line.item;
  if (typeof item?.id === "string" && item.id.trim()) {
    return item.id.trim();
  }

  const raw = line as Cart["line_items"][number] & Record<string, unknown>;
  const itemRaw = item as Record<string, unknown> | undefined;
  const candidates = [
    itemRaw?.id,
    itemRaw?.variant_id,
    itemRaw?.variantId,
    raw.variant_id,
    raw.variantId,
    raw.product_variant_id,
    raw.productVariantId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}
