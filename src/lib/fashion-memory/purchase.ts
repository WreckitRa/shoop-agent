import type { ProductCard } from "@/lib/ai-chat/types";
import { isSupabaseAuthUserId } from "./auth";
import { FashionLocalStore } from "./local/store";
import type { GuestFashionMemorySnapshot } from "./local/store";
import { normalizeSignalContext } from "./extraction/signal-context";
import {
  applyPurchaseToLocalStore,
  attrsFromPurchaseProduct,
} from "./purchase-local";
import { logRequestEvent, upsertStyleSignal } from "./signals";
import { fashionMemoryDb } from "./db";
import type {
  RequestEventAttributes,
  RequestEventRow,
  StyleSignalType,
} from "./types";

const SIGNAL_KEYS: StyleSignalType[] = [
  "color",
  "style",
  "brand",
  "material",
  "pattern",
  "garment",
];

export type PurchaseWriteParams = {
  userId: string;
  searchId: string;
  ref: string;
  product: ProductCard;
  guestSnapshot?: GuestFashionMemorySnapshot;
};

function matchesSearch(
  events: RequestEventRow[],
  userId: string,
  searchId: string,
): RequestEventRow[] {
  return events.filter(
    (e) => e.user_id === userId && e.attributes.search_id === searchId,
  );
}

function originFromMatches(matches: RequestEventRow[]): RequestEventRow | null {
  return (
    matches.find((e) => e.attributes.kind !== "purchase") ?? matches[0] ?? null
  );
}

async function loadUserEvents(
  userId: string,
  guestSnapshot?: GuestFashionMemorySnapshot,
): Promise<RequestEventRow[]> {
  if (guestSnapshot) {
    return guestSnapshot.request_events.filter((e) => e.user_id === userId);
  }
  if (!isSupabaseAuthUserId(userId)) return [];
  const { data, error } = await fashionMemoryDb()
    .from("request_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error || !data?.length) return [];
  return data as RequestEventRow[];
}

/**
 * Checkout success: purchase event on the originating search's recipient,
 * plus stated 0.9 attribute signals in that search's occasion context.
 */
export async function writePurchaseMemory(
  params: PurchaseWriteParams,
): Promise<RequestEventRow | null> {
  const events = await loadUserEvents(params.userId, params.guestSnapshot);
  const matches = matchesSearch(events, params.userId, params.searchId);
  const already = matches.find(
    (e) => e.attributes.kind === "purchase" && e.attributes.ref === params.ref,
  );
  if (already) return already;
  const origin = originFromMatches(matches);
  if (!origin) return null;

  if (params.guestSnapshot) {
    const store = new FashionLocalStore(params.guestSnapshot);
    return applyPurchaseToLocalStore({
      store,
      userId: params.userId,
      origin,
      searchId: params.searchId,
      ref: params.ref,
      product: params.product,
    });
  }

  if (!isSupabaseAuthUserId(params.userId)) return null;

  const productAttrs = attrsFromPurchaseProduct(params.product);
  const attributes: RequestEventAttributes = {
    ...origin.attributes,
    ...productAttrs,
    kind: "purchase",
    search_id: params.searchId,
    ref: params.ref,
  };
  const context = normalizeSignalContext(origin.attributes.occasion);

  const event = await logRequestEvent({
    userId: params.userId,
    personId: origin.person_id,
    conversationId: origin.conversation_id,
    attributes,
  });
  for (const key of SIGNAL_KEYS) {
    const value = attributes[key]?.trim();
    if (!value) continue;
    await upsertStyleSignal({
      userId: params.userId,
      personId: origin.person_id,
      context,
      signalType: key,
      value,
      polarity: 1,
      source: "stated",
      confidence: 0.9,
      status: "active",
    });
  }
  return event;
}
