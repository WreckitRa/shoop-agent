import type { ProductCard } from "@/lib/ai-chat/types";
import { FashionLocalStore } from "./local/store";
import { normalizeSignalContext } from "./extraction/signal-context";
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

export function attrsFromPurchaseProduct(
  product: ProductCard,
): RequestEventAttributes {
  const out: RequestEventAttributes = {};
  for (const key of SIGNAL_KEYS) {
    const hit = product.catalogAttributes?.find(
      (a) => a.name.toLowerCase() === key,
    );
    const value = hit?.value?.trim().toLowerCase();
    if (value) out[key] = value;
  }
  return out;
}

export type FashionPurchaseApplyInput = {
  searchId: string;
  ref: string;
  product: ProductCard;
};

/** Guest / local store write — no Postgres. */
export function applyPurchaseToLocalStore(params: {
  store: FashionLocalStore;
  userId: string;
  origin: RequestEventRow;
  searchId: string;
  ref: string;
  product: ProductCard;
}): RequestEventRow {
  const productAttrs = attrsFromPurchaseProduct(params.product);
  const attributes: RequestEventAttributes = {
    ...params.origin.attributes,
    ...productAttrs,
    kind: "purchase",
    search_id: params.searchId,
    ref: params.ref,
  };
  const context = normalizeSignalContext(params.origin.attributes.occasion);
  const event = params.store.logRequestEvent({
    userId: params.userId,
    personId: params.origin.person_id,
    conversationId: params.origin.conversation_id,
    attributes,
  });
  for (const key of SIGNAL_KEYS) {
    const value = attributes[key]?.trim();
    if (!value) continue;
    params.store.upsertStyleSignal({
      userId: params.userId,
      personId: params.origin.person_id,
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
