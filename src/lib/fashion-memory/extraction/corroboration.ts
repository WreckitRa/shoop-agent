import { fashionMemoryDb } from "../db";
import { normalizeSignalValue, upsertStyleSignal } from "../signals";
import type {
  ExtractionOpResult,
  RequestEventAttributes,
  StyleSignalType,
} from "../types";

const ATTRIBUTE_TO_SIGNAL: Partial<
  Record<keyof RequestEventAttributes, StyleSignalType>
> = {
  color: "color",
  style: "style",
  brand: "brand",
  silhouette: "silhouette",
  aesthetic: "aesthetic",
  material: "material",
  pattern: "pattern",
};

const MIN_EVENTS = 3;
const MIN_CONVERSATIONS = 2;
const PROMOTE_AT_EVENTS = 4;

type CorroborationBucket = {
  signalType: StyleSignalType;
  value: string;
  eventCount: number;
  conversationIds: Set<string>;
};

function bucketsFromRequestEvents(
  rows: Array<{
    conversation_id: string | null;
    attributes: RequestEventAttributes;
  }>,
): CorroborationBucket[] {
  const map = new Map<string, CorroborationBucket>();

  for (const row of rows) {
    const attrs = row.attributes ?? {};
    for (const [key, raw] of Object.entries(attrs)) {
      const signalType = ATTRIBUTE_TO_SIGNAL[key as keyof RequestEventAttributes];
      if (!signalType || !raw?.trim()) continue;
      const value = normalizeSignalValue(raw);
      const bucketKey = `${signalType}:${value}`;
      const existing = map.get(bucketKey);
      if (existing) {
        existing.eventCount += 1;
        if (row.conversation_id) {
          existing.conversationIds.add(row.conversation_id);
        }
      } else {
        map.set(bucketKey, {
          signalType,
          value,
          eventCount: 1,
          conversationIds: row.conversation_id
            ? new Set([row.conversation_id])
            : new Set(),
        });
      }
    }
  }

  return [...map.values()];
}

/**
 * Promote recurring request attributes to inferred style_signals.
 * Request attributes NEVER directly become active signals — only via corroboration.
 */
export async function runRequestEventCorroboration(params: {
  userId: string;
  personId: string;
  context?: string;
}): Promise<ExtractionOpResult[]> {
  const db = fashionMemoryDb();
  const rows = await db
    .from("request_events")
    .select("conversation_id, attributes")
    .eq("user_id", params.userId)
    .eq("person_id", params.personId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (rows.error) throw new Error(rows.error.message);

  const buckets = bucketsFromRequestEvents(
    (rows.data ?? []) as Array<{
      conversation_id: string | null;
      attributes: RequestEventAttributes;
    }>,
  );

  const results: ExtractionOpResult[] = [];

  for (const bucket of buckets) {
    if (bucket.eventCount < MIN_EVENTS) continue;
    if (bucket.conversationIds.size < MIN_CONVERSATIONS) continue;

    const promoteActive = bucket.eventCount >= PROMOTE_AT_EVENTS;
    const signal = await upsertStyleSignal({
      userId: params.userId,
      personId: params.personId,
      context: params.context,
      signalType: bucket.signalType,
      value: bucket.value,
      polarity: 1,
      source: "inferred",
      confidence: promoteActive ? 0.55 : 0.4,
      status: promoteActive ? "active" : "candidate",
      incrementEvidence: true,
    });

    results.push({
      op: "corroborate_signal",
      accepted: true,
      entity_id: signal.id,
    });
  }

  return results;
}

/** User explicitly stated a taste — always wins over inferred. */
export async function promoteStatedSignal(params: {
  userId: string;
  personId: string;
  context?: string;
  signalType: StyleSignalType;
  value: string;
  polarity?: -1 | 1;
  sourceQuote?: string;
}) {
  return upsertStyleSignal({
    userId: params.userId,
    personId: params.personId,
    context: params.context,
    signalType: params.signalType,
    value: params.value,
    polarity: params.polarity ?? 1,
    source: "stated",
    status: "active",
    confidence: 0.9,
    sourceQuote: params.sourceQuote,
  });
}

/** Downgrade or supersede inferred signals when user rejects matching picks. */
export async function downgradeInferredSignal(params: {
  userId: string;
  signalId: string;
}) {
  const db = fashionMemoryDb();
  const { error } = await db
    .from("style_signals")
    .update({
      status: "superseded",
      confidence: 0.2,
    })
    .eq("id", params.signalId)
    .eq("user_id", params.userId)
    .eq("source", "inferred");
  if (error) throw new Error(error.message);
}
