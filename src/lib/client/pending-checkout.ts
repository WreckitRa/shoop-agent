import type { ActiveCartGroup, ActiveCartLine, CartItemMetadata } from "@/lib/cart/types";
import { variantIdsMatch } from "@/lib/cart/variant-id";

const STORAGE_KEY = "shoop.pending-checkout";

export type PendingCheckoutPayload = {
  shopDomain: string;
  variantId: string;
  productId: string;
  quantity: number;
  checkoutUrl: string;
  product: CartItemMetadata;
};

function normalizeShop(domain: string | null | undefined): string | null {
  const trimmed = domain?.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().replace(/^www\./, "");
}

export function stashPendingCheckout(payload: PendingCheckoutPayload): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage unavailable — pre-checkout may still resolve from cart.
  }
}

export function clearPendingCheckout(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function readPendingCheckout(
  shopDomain: string | null,
  variantId: string | null,
): PendingCheckoutPayload | null {
  if (typeof window === "undefined" || !variantId) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCheckoutPayload;
    if (!parsed?.variantId || !variantIdsMatch(parsed.variantId, variantId)) {
      return null;
    }
    const normalizedShop = normalizeShop(shopDomain);
    if (
      normalizedShop &&
      normalizeShop(parsed.shopDomain) !== normalizedShop
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Build a synthetic cart selection when the live cart hasn't synced yet. */
export function pendingCheckoutSelection(
  payload: PendingCheckoutPayload,
): { group: ActiveCartGroup; line: ActiveCartLine } {
  const shopDomain = payload.shopDomain.trim();
  const priceCents = payload.product.priceCents ?? null;
  const line: ActiveCartLine = {
    variantId: payload.variantId,
    quantity: payload.quantity,
    title: payload.product.title ?? "Product",
    imageUrl: payload.product.imageUrl ?? null,
    priceCents,
    lineTotalCents:
      priceCents != null ? priceCents * payload.quantity : null,
    currency: payload.product.currency ?? null,
    sellerName: payload.product.sellerName ?? null,
    sellerDomain: payload.product.sellerDomain ?? shopDomain,
    productId: payload.product.productId ?? payload.productId,
    searchId: payload.product.searchId ?? null,
    ref: payload.product.ref ?? payload.product.productId ?? payload.productId,
    brand: payload.product.brand ?? null,
    color: payload.product.color ?? null,
    productUrl: payload.product.productUrl ?? null,
  };
  const group: ActiveCartGroup = {
    hasCart: true,
    cartId: null,
    checkoutUrl: payload.checkoutUrl,
    shopDomain,
    continueUrl: null,
    currency: payload.product.currency ?? null,
    totalCents: line.lineTotalCents,
    lineItems: [line],
    messages: [],
    expiresAt: null,
    lastSyncedAt: null,
    checkout: {
      cartSupported: false,
      checkoutSupported: true,
      embeddedAvailable: false,
    },
  };
  return { group, line };
}
