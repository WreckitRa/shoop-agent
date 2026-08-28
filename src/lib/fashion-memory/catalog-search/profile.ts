import { prisma } from "@/lib/ai-chat/db";
import { buyerCatalogContextFromSources } from "@/lib/shopify/catalog-localization";
import { loadDefaultSavedAddressLocale } from "@/lib/shopify/default-saved-address";
import { isFashionMemoryGuestUserId, isSupabaseAuthUserId } from "../auth";
import { listActiveStyleSignals } from "../signals";
import { filterSignalsByEffectiveConfidence } from "../signal-confidence";
import type { GuestFashionMemorySnapshot } from "../local/store";
import { safeTrim } from "../safe-trim";
import type { FashionSearchProfile } from "./types";
import { TASTE_FIT_SIGNAL_TYPES } from "../scoring/taste-fit";
import type { TasteFitSignal } from "../scoring/taste-fit";

const DEFAULT_COUNTRY = "US";
const DEFAULT_CURRENCY = "USD";

export async function loadFashionSearchProfile(params: {
  userId: string;
  recipientPersonId: string;
  conversationId?: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): Promise<FashionSearchProfile> {
  const [profileRow, conversation, savedAddress] = await Promise.all([
    isSupabaseAuthUserId(params.userId)
      ? prisma.userProfile.findUnique({
          where: { userId: params.userId },
          select: {
            shippingCountry: true,
            country: true,
            currency: true,
            language: true,
          },
        })
      : Promise.resolve(null),
    params.conversationId
      ? prisma.conversation.findFirst({
          where: { id: params.conversationId, userId: params.userId },
          select: { shippingCountry: true, currency: true },
        })
      : Promise.resolve(null),
    isSupabaseAuthUserId(params.userId)
      ? loadDefaultSavedAddressLocale(params.userId)
      : Promise.resolve(null),
  ]);

  const buyer = buyerCatalogContextFromSources(
    profileRow ?? {},
    conversation,
    savedAddress,
  );

  const countryCode =
    buyer.shipsToCountry ??
    buyer.context.address_country ??
    DEFAULT_COUNTRY;
  const currency = buyer.context.currency ?? DEFAULT_CURRENCY;
  const language = buyer.context.language;

  const positiveSignals = await loadPositiveStyleSignals({
    userId: params.userId,
    recipientPersonId: params.recipientPersonId,
    guestSnapshot: params.guestSnapshot,
  });

  return {
    countryCode: countryCode.toUpperCase(),
    currency: currency.toUpperCase(),
    language,
    positiveSignals,
  };
}

async function loadPositiveStyleSignals(params: {
  userId: string;
  recipientPersonId: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): Promise<string[]> {
  if (
    isFashionMemoryGuestUserId(params.userId) ||
    !isSupabaseAuthUserId(params.userId)
  ) {
    const snapshot = params.guestSnapshot ?? {
      version: 1 as const,
      people: [],
      fashion_facts: [],
      style_signals: [],
      request_events: [],
      extraction_runs: [],
    };
    const signals = snapshot.style_signals.filter(
      (s) =>
        s.user_id === params.userId &&
        s.person_id === params.recipientPersonId &&
        (s.status === "active" || s.status === "candidate") &&
        s.polarity === 1,
    );
    return filterSignalsByEffectiveConfidence(signals)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8)
      .map((s) => safeTrim(s.value))
      .filter(Boolean);
  }

  const signals = await listActiveStyleSignals({
    userId: params.userId,
    personId: params.recipientPersonId,
  });

  return filterSignalsByEffectiveConfidence(
    signals.filter((s) => s.polarity === 1),
  )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8)
    .map((s) => safeTrim(s.value))
    .filter(Boolean);
}

const TASTE_TYPE_SET = new Set<string>(TASTE_FIT_SIGNAL_TYPES);

/** Active like/dislike signals used by the S0 taste_fit diagnostic. */
export async function loadRecipientTasteFitSignals(params: {
  userId: string;
  recipientPersonId: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): Promise<TasteFitSignal[]> {
  const fromSnapshot = params.guestSnapshot?.style_signals.filter(
    (s) =>
      s.user_id === params.userId &&
      s.person_id === params.recipientPersonId &&
      (s.status === "active" || s.status === "candidate") &&
      TASTE_TYPE_SET.has(s.signal_type),
  );
  const rows =
    fromSnapshot?.length
      ? fromSnapshot
      : isSupabaseAuthUserId(params.userId)
        ? (
            await listActiveStyleSignals({
              userId: params.userId,
              personId: params.recipientPersonId,
            })
          ).filter((s) => TASTE_TYPE_SET.has(s.signal_type))
        : [];

  return filterSignalsByEffectiveConfidence(rows).map((s) => ({
    signal_type: s.signal_type,
    value: s.value,
    polarity: s.polarity,
    source: s.source,
    value_canonical: s.value_canonical ?? null,
  }));
}
