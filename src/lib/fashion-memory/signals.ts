import { assertFashionRow, fashionMemoryDb } from "./db";
import type {
  RequestEventAttributes,
  RequestEventRow,
  StyleSignalRow,
  StyleSignalSource,
  StyleSignalStatus,
  StyleSignalType,
} from "./types";

export function normalizeSignalValue(value: string): string {
  return value.trim().toLowerCase();
}

/** Log one episodic request — deterministic, no LLM. Never creates style_signals. */
export async function logRequestEvent(params: {
  userId: string;
  personId: string;
  conversationId?: string | null;
  attributes: RequestEventAttributes;
}): Promise<RequestEventRow> {
  const db = fashionMemoryDb();
  const row = await db
    .from("request_events")
    .insert({
      user_id: params.userId,
      person_id: params.personId,
      conversation_id: params.conversationId ?? null,
      attributes: params.attributes,
    })
    .select("*")
    .single();

  return assertFashionRow(
    "logRequestEvent",
    row.data as RequestEventRow | null,
    row.error,
  );
}

const SOURCE_RANK: Record<StyleSignalSource, number> = {
  stated: 4,
  rejection: 3,
  inferred: 2,
  request: 1,
};

function sourceBeats(existing: StyleSignalSource, incoming: StyleSignalSource): boolean {
  return SOURCE_RANK[incoming] > SOURCE_RANK[existing];
}

export async function upsertStyleSignal(params: {
  userId: string;
  personId: string;
  context?: string;
  signalType: StyleSignalType;
  value: string;
  polarity?: -1 | 1;
  source: StyleSignalSource;
  confidence?: number;
  status?: StyleSignalStatus;
  sourceQuote?: string | null;
  incrementEvidence?: boolean;
}): Promise<StyleSignalRow> {
  const db = fashionMemoryDb();
  const context = params.context?.trim() || "general";
  const value = normalizeSignalValue(params.value);
  const polarity = params.polarity ?? 1;
  const status = params.status ?? (params.source === "stated" ? "active" : "candidate");

  const existing = await db
    .from("style_signals")
    .select("*")
    .eq("user_id", params.userId)
    .eq("person_id", params.personId)
    .eq("context", context)
    .eq("signal_type", params.signalType)
    .eq("value", value)
    .eq("polarity", polarity)
    .in("status", ["active", "candidate"])
    .maybeSingle();

  const now = new Date().toISOString();

  if (existing.data) {
    const row = existing.data as StyleSignalRow;
    if (row.source === "stated" && params.source === "inferred") {
      return row;
    }

    const nextSource = sourceBeats(row.source, params.source)
      ? params.source
      : row.source;
    const nextStatus =
      params.source === "stated"
        ? "active"
        : row.status === "active"
          ? "active"
          : status;
    const nextConfidence = Math.min(
      0.95,
      Math.max(row.confidence, params.confidence ?? row.confidence),
    );
    const nextEvidence =
      row.evidence_count + (params.incrementEvidence === false ? 0 : 1);

    const updated = await db
      .from("style_signals")
      .update({
        source: nextSource,
        status: nextStatus,
        confidence: nextConfidence,
        evidence_count: nextEvidence,
        last_seen_at: now,
        source_quote: params.sourceQuote ?? row.source_quote,
      })
      .eq("id", row.id)
      .eq("user_id", params.userId)
      .select("*")
      .single();

    return assertFashionRow(
      "upsertStyleSignal",
      updated.data as StyleSignalRow | null,
      updated.error,
    );
  }

  const inserted = await db
    .from("style_signals")
    .insert({
      user_id: params.userId,
      person_id: params.personId,
      context,
      signal_type: params.signalType,
      value,
      polarity,
      source: params.source,
      confidence: Math.min(0.95, params.confidence ?? (params.source === "stated" ? 0.9 : 0.5)),
      evidence_count: 1,
      status,
      source_quote: params.sourceQuote ?? null,
      first_seen_at: now,
      last_seen_at: now,
    })
    .select("*")
    .single();

  if (inserted.error?.code === "23505") {
    const winner = await db
      .from("style_signals")
      .select("*")
      .eq("user_id", params.userId)
      .eq("person_id", params.personId)
      .eq("context", context)
      .eq("signal_type", params.signalType)
      .eq("value", value)
      .eq("polarity", polarity)
      .in("status", ["active", "candidate"])
      .single();
    return assertFashionRow(
      "upsertStyleSignal.concurrent",
      winner.data as StyleSignalRow | null,
      winner.error,
    );
  }

  return assertFashionRow(
    "upsertStyleSignal",
    inserted.data as StyleSignalRow | null,
    inserted.error,
  );
}

export async function supersedeStyleSignal(params: {
  userId: string;
  signalId: string;
}): Promise<void> {
  const db = fashionMemoryDb();
  const { error } = await db
    .from("style_signals")
    .update({ status: "superseded" })
    .eq("id", params.signalId)
    .eq("user_id", params.userId);
  if (error) throw new Error(error.message);
}

export async function listActiveStyleSignals(params: {
  userId: string;
  personId: string;
  context?: string;
}): Promise<StyleSignalRow[]> {
  const db = fashionMemoryDb();
  let q = db
    .from("style_signals")
    .select("*")
    .eq("user_id", params.userId)
    .eq("person_id", params.personId)
    .in("status", ["active", "candidate"]);
  if (params.context) q = q.eq("context", params.context);
  const rows = await q.order("last_seen_at", { ascending: false });
  if (rows.error) throw new Error(rows.error.message);
  return (rows.data ?? []) as StyleSignalRow[];
}

export async function findActiveStyleSignal(params: {
  userId: string;
  personId: string;
  context?: string;
  signalType: StyleSignalType;
  value: string;
  polarity?: -1 | 1;
}): Promise<StyleSignalRow | null> {
  const context = params.context?.trim() || "general";
  const value = normalizeSignalValue(params.value);
  const polarity = params.polarity ?? 1;
  const signals = await listActiveStyleSignals({
    userId: params.userId,
    personId: params.personId,
    context,
  });
  return (
    signals.find(
      (s) =>
        s.signal_type === params.signalType &&
        s.value === value &&
        s.polarity === polarity,
    ) ?? null
  );
}

export async function bumpStyleSignalConfidence(params: {
  userId: string;
  signalId: string;
  incomingConfidence: number;
  cap?: number;
}): Promise<StyleSignalRow> {
  const db = fashionMemoryDb();
  const existing = await db
    .from("style_signals")
    .select("*")
    .eq("user_id", params.userId)
    .eq("id", params.signalId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const row = existing.data as StyleSignalRow | null;
  if (!row) throw new Error("signal_not_found");

  const cap = params.cap ?? 0.95;
  const now = new Date().toISOString();
  const updated = await db
    .from("style_signals")
    .update({
      confidence: Math.min(cap, Math.max(row.confidence, params.incomingConfidence)),
      evidence_count: row.evidence_count + 1,
      last_seen_at: now,
    })
    .eq("id", params.signalId)
    .eq("user_id", params.userId)
    .select("*")
    .single();

  return assertFashionRow(
    "bumpStyleSignalConfidence",
    updated.data as StyleSignalRow | null,
    updated.error,
  );
}
