import { prisma } from "@/lib/ai-chat/db";
import type { ProductCard } from "@/lib/ai-chat/types";
import { isFashionMemoryGuestUserId, isSupabaseAuthUserId } from "./auth";
import type { CartItemMetadata } from "@/lib/cart/types";
import { logAiChat } from "@/lib/ai-chat/observability";
import { writePurchaseMemory } from "./purchase";
import { writePilotAlert } from "./pilot-alerts";
import type { FashionPurchaseApplyInput } from "./purchase-local";

export type CheckoutPurchaseHint = {
  searchId?: string | null;
  ref?: string | null;
  productId?: string | null;
  title?: string | null;
  brand?: string | null;
  color?: string | null;
  catalogAttributes?: Array<{ name: string; value: string }>;
};

export type FashionPurchaseClientPayload = FashionPurchaseApplyInput;

function metaRecord(raw: unknown): Record<string, CartItemMetadata> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, CartItemMetadata>;
}

function hintFromMeta(meta: CartItemMetadata): CheckoutPurchaseHint {
  return {
    searchId: meta.searchId,
    ref: meta.ref ?? meta.productId,
    productId: meta.productId,
    title: meta.title,
    brand: meta.brand,
    color: meta.color,
  };
}

async function hintFromCart(
  userId: string,
  productUrl?: string | null,
): Promise<CheckoutPurchaseHint | null> {
  const sessions = await prisma.cartSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });
  for (const session of sessions) {
    const metas = metaRecord(session.itemMetadata);
    const values = Object.values(metas);
    const byUrl = productUrl
      ? values.find((m) => m.productUrl === productUrl)
      : undefined;
    const hit =
      byUrl ?? values.find((m) => Boolean(m.searchId)) ?? values[0];
    if (hit?.searchId) return hintFromMeta(hit);
  }
  return null;
}

function productCard(hint: CheckoutPurchaseHint): ProductCard {
  const id = hint.productId ?? hint.ref ?? "purchase";
  const catalogAttributes = [...(hint.catalogAttributes ?? [])];
  const add = (name: string, value?: string | null) => {
    const v = value?.trim();
    if (!v) return;
    if (catalogAttributes.some((a) => a.name.toLowerCase() === name)) return;
    catalogAttributes.push({ name, value: v });
  };
  add("brand", hint.brand);
  add("color", hint.color);
  return {
    id,
    title: hint.title ?? id,
    catalogAttributes: catalogAttributes.length ? catalogAttributes : undefined,
  };
}

/** Pilot P0: a broken search id must surface on day one, not on visit 2. */
function alertPurchaseMemoryMissingSearchId(payload: Record<string, unknown>): void {
  void writePilotAlert({
    code: "purchase_memory_missing_search_id",
    severity: "P0",
    payload,
  });
}

/**
 * After Rye (or any first-party) checkout completes: write purchase memory
 * for signed-in users. Guests get a payload the client applies locally.
 */
export async function completeCheckoutPurchase(params: {
  userId: string;
  productUrl?: string | null;
  hint?: CheckoutPurchaseHint | null;
}): Promise<FashionPurchaseClientPayload | null> {
  const fromCart = await hintFromCart(params.userId, params.productUrl);
  const merged: CheckoutPurchaseHint = {
    ...fromCart,
    ...params.hint,
    searchId: params.hint?.searchId || fromCart?.searchId,
    ref: params.hint?.ref || fromCart?.ref,
    brand: params.hint?.brand || fromCart?.brand,
    color: params.hint?.color || fromCart?.color,
    title: params.hint?.title || fromCart?.title,
    productId: params.hint?.productId || fromCart?.productId,
  };
  const searchId = merged.searchId?.trim();
  const ref = (merged.ref ?? merged.productId ?? "").trim();
  if (!searchId || !ref) {
    alertPurchaseMemoryMissingSearchId({
      userId: params.userId.slice(0, 12),
      hasHint: Boolean(params.hint?.searchId),
      hasCart: Boolean(fromCart?.searchId),
      hasRef: Boolean(ref),
    });
    return null;
  }

  const product = productCard({ ...merged, searchId, ref });
  const payload: FashionPurchaseClientPayload = { searchId, ref, product };

  if (isSupabaseAuthUserId(params.userId)) {
    const event = await writePurchaseMemory({
      userId: params.userId,
      searchId,
      ref,
      product,
    });
    if (!event) {
      logAiChat("warn", "purchase_memory_origin_not_found", {
        searchId,
      });
    }
    return payload;
  }

  if (isFashionMemoryGuestUserId(params.userId)) return payload;
  return null;
}
