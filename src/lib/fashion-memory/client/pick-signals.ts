"use client";

import type { ProductCard } from "@/lib/ai-chat/types";
import { guestUserIdFromSessionId } from "@/lib/auth/guest-session";
import { guestFetch } from "@/lib/client/guest-fetch";
import { getGuestSessionId } from "@/lib/client/guest-storage";
import type { StyleSignalType } from "@/lib/fashion-memory/types";
import { loadGuestFashionStore, saveGuestFashionSnapshot } from "./guest-bridge";

const SIGNAL_KEYS: Array<{ attr: string; type: StyleSignalType }> = [
  { attr: "color", type: "color" },
  { attr: "style", type: "style" },
  { attr: "brand", type: "brand" },
  { attr: "material", type: "material" },
  { attr: "pattern", type: "pattern" },
];

function signalsFromProduct(product: ProductCard): Array<{
  signalType: StyleSignalType;
  value: string;
}> {
  const out: Array<{ signalType: StyleSignalType; value: string }> = [];
  const attrs = product.catalogAttributes ?? [];
  for (const { attr, type } of SIGNAL_KEYS) {
    const hit = attrs.find((a) => a.name.toLowerCase() === attr);
    const value = hit?.value?.trim();
    if (value) out.push({ signalType: type, value: value.toLowerCase() });
  }
  return out;
}

function writeGuestPickAcceptance(params: {
  guestId: string;
  product: ProductCard;
}): void {
  const userId = guestUserIdFromSessionId(params.guestId);
  const store = loadGuestFashionStore(params.guestId);
  const self = store.ensureSelfPerson(userId);
  for (const { signalType, value } of signalsFromProduct(params.product)) {
    store.upsertStyleSignal({
      userId,
      personId: self.id,
      signalType,
      value,
      polarity: 1,
      source: "inferred",
      status: "candidate",
      confidence: 0.45,
    });
  }
  saveGuestFashionSnapshot(store.snapshot);
}

function writeGuestPickRejection(params: {
  guestId: string;
  product: ProductCard;
  reason?: string;
}): void {
  const userId = guestUserIdFromSessionId(params.guestId);
  const store = loadGuestFashionStore(params.guestId);
  const self = store.ensureSelfPerson(userId);
  for (const { signalType, value } of signalsFromProduct(params.product)) {
    store.upsertStyleSignal({
      userId,
      personId: self.id,
      signalType,
      value,
      polarity: -1,
      source: "rejection",
      status: "active",
      confidence: 0.7,
      sourceQuote: params.reason,
    });
  }
  saveGuestFashionSnapshot(store.snapshot);
}

/** Direct write — user opened / selected a fashion pick. */
export function recordFashionPickSelection(
  product: ProductCard,
  conversationId?: string | null,
): void {
  const guestId = getGuestSessionId();
  if (guestId) {
    try {
      writeGuestPickAcceptance({ guestId, product });
    } catch (error) {
      console.error("[shoop] fashion guest pick acceptance failed", error);
    }
    return;
  }

  void guestFetch("/api/fashion-memory/pick-signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "acceptance",
      product,
      conversationId: conversationId ?? undefined,
    }),
  }).catch(() => undefined);
}

/** Direct write — user rejected a fashion pick. */
export function recordFashionPickRejection(
  product: ProductCard,
  reason?: string,
): void {
  const guestId = getGuestSessionId();
  if (guestId) {
    try {
      writeGuestPickRejection({ guestId, product, reason });
    } catch (error) {
      console.error("[shoop] fashion guest pick rejection failed", error);
    }
    return;
  }

  void guestFetch("/api/fashion-memory/pick-signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "rejection",
      product,
      reason,
    }),
  }).catch(() => undefined);
}
