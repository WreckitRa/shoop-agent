import { isGuestUserId } from "@/lib/auth/guest-session";
import { isSupabaseAuthUserId } from "./auth";
import { ensureSelfPerson } from "./people";
import { upsertStyleSignal } from "./signals";
import type { ProductCard } from "@/lib/ai-chat/types";
import type { StyleSignalType } from "./types";

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

/** Direct write — user selected / opened a pick (inferred positive signal). */
export async function writeFashionPickAcceptance(params: {
  userId: string;
  product: ProductCard;
  conversationId?: string;
  personId?: string;
}): Promise<void> {
  if (isGuestUserId(params.userId)) return;
  if (!isSupabaseAuthUserId(params.userId)) return;

  const person =
    params.personId ?? (await ensureSelfPerson(params.userId)).id;
  for (const { signalType, value } of signalsFromProduct(params.product)) {
    await upsertStyleSignal({
      userId: params.userId,
      personId: person,
      signalType,
      value,
      polarity: 1,
      source: "inferred",
      status: "candidate",
      confidence: 0.45,
    });
  }
  void params.conversationId;
}

/** Direct write — user rejected a pick (negative signal). */
export async function writeFashionPickRejection(params: {
  userId: string;
  product: ProductCard;
  personId?: string;
  reason?: string;
}): Promise<void> {
  if (isGuestUserId(params.userId)) return;
  if (!isSupabaseAuthUserId(params.userId)) return;

  const person =
    params.personId ?? (await ensureSelfPerson(params.userId)).id;
  for (const { signalType, value } of signalsFromProduct(params.product)) {
    await upsertStyleSignal({
      userId: params.userId,
      personId: person,
      signalType,
      value,
      polarity: -1,
      source: "rejection",
      status: "active",
      confidence: 0.7,
      sourceQuote: params.reason,
    });
  }
}
