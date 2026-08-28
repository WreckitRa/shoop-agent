"use client";

import {
  GUEST_FASHION_MEMORY_VERSION,
  emptyGuestFashionMemorySnapshot,
  type GuestFashionMemorySnapshot,
} from "@/lib/fashion-memory/local/store";
import {
  loadGuestData,
  saveGuestData,
  type GuestLocalData,
} from "@/lib/client/guest-storage";
import { guestUserIdFromSessionId } from "@/lib/auth/guest-session";
import { requestAttributesFromQuery } from "@/lib/fashion-memory/request-attributes";
import type { RequestEventAttributes } from "@/lib/fashion-memory/types";
import { FashionLocalStore } from "@/lib/fashion-memory/local/store";
import { applyPurchaseToLocalStore } from "@/lib/fashion-memory/purchase-local";
import type { ProductCard } from "@/lib/ai-chat/types";

export function loadGuestFashionMemorySnapshot(): GuestFashionMemorySnapshot | null {
  const data = loadGuestData();
  if (!data?.fashionMemory) return null;
  if (data.fashionMemory.version !== GUEST_FASHION_MEMORY_VERSION) return null;
  return data.fashionMemory;
}

export function loadGuestFashionStore(guestId: string): FashionLocalStore {
  const data = loadGuestData();
  const snapshot =
    data?.fashionMemory?.version === GUEST_FASHION_MEMORY_VERSION
      ? data.fashionMemory
      : emptyGuestFashionMemorySnapshot();
  return new FashionLocalStore(snapshot);
}

export function saveGuestFashionSnapshot(snapshot: GuestFashionMemorySnapshot) {
  const base = loadGuestData();
  if (!base) return;
  const next: GuestLocalData = {
    ...base,
    fashionMemory: {
      ...snapshot,
      version: GUEST_FASHION_MEMORY_VERSION,
    },
  };
  saveGuestData(next);
}

export function persistGuestFashionRequestEvent(params: {
  guestId: string;
  conversationId: string;
  query: string;
  attributes?: RequestEventAttributes;
  personId?: string;
}): void {
  const userId = guestUserIdFromSessionId(params.guestId);
  const store = loadGuestFashionStore(params.guestId);
  const personId =
    params.personId ?? store.ensureSelfPerson(userId).id;
  store.logRequestEvent({
    userId,
    personId,
    conversationId: params.conversationId,
    attributes:
      params.attributes ?? requestAttributesFromQuery(params.query),
  });
  saveGuestFashionSnapshot(store.snapshot);
}

export function persistGuestFashionPurchase(params: {
  searchId: string;
  ref: string;
  product: ProductCard;
}): void {
  const data = loadGuestData();
  if (!data?.guestId) return;
  const userId = guestUserIdFromSessionId(data.guestId);
  const store = loadGuestFashionStore(data.guestId);
  const origin =
    store.snapshot.request_events.find(
      (e) =>
        e.user_id === userId &&
        e.attributes.search_id === params.searchId &&
        e.attributes.kind !== "purchase",
    ) ??
    store.snapshot.request_events.find(
      (e) => e.user_id === userId && e.attributes.search_id === params.searchId,
    );
  if (!origin) return;
  const already = store.snapshot.request_events.find(
    (e) =>
      e.user_id === userId &&
      e.attributes.kind === "purchase" &&
      e.attributes.search_id === params.searchId &&
      e.attributes.ref === params.ref,
  );
  if (already) return;
  applyPurchaseToLocalStore({
    store,
    userId,
    origin,
    searchId: params.searchId,
    ref: params.ref,
    product: params.product,
  });
  saveGuestFashionSnapshot(store.snapshot);
}

export function readGuestFashionMemoryForUser(guestId: string) {
  const store = loadGuestFashionStore(guestId);
  const userId = guestUserIdFromSessionId(guestId);
  store.ensureSelfPerson(userId);
  return store.snapshot;
}
