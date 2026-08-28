import { canonicalizeRelation } from "../extraction/relation-aliases";
import { buildPersonShortIdMap } from "../extraction/context-format";
import {
  AMBIGUOUS_PERSON_ERROR,
  resolveProposedPerson,
} from "../resolve-person";
import {
  canonicalizeSignalValueSync,
  signalCanonicalKey,
} from "../normalize/signal-canonical";
import type {
  ExtractionOpResult,
  ExtractionRunRow,
  FashionFactRow,
  FashionFactType,
  FashionFactValue,
  PersonRelation,
  PersonRow,
  RequestEventAttributes,
  RequestEventRow,
  StyleSignalRow,
  StyleSignalSource,
  StyleSignalStatus,
  StyleSignalType,
} from "../types";

export const GUEST_FASHION_MEMORY_VERSION = 1 as const;

/** Local-only fashion memory — mirrors Supabase tables for guest sessions. */
export type GuestFashionMemorySnapshot = {
  version: typeof GUEST_FASHION_MEMORY_VERSION;
  people: PersonRow[];
  fashion_facts: FashionFactRow[];
  style_signals: StyleSignalRow[];
  request_events: RequestEventRow[];
  extraction_runs: ExtractionRunRow[];
};

export function emptyGuestFashionMemorySnapshot(): GuestFashionMemorySnapshot {
  return {
    version: GUEST_FASHION_MEMORY_VERSION,
    people: [],
    fashion_facts: [],
    style_signals: [],
    request_events: [],
    extraction_runs: [],
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
  return randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function garmentKey(garmentType: string | null | undefined): string | null {
  const g = garmentType?.trim();
  return g ? g.toLowerCase() : null;
}

export function normalizeSignalValue(value: string): string {
  return value.trim().toLowerCase();
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

/** In-memory / localStorage fashion memory with the same rules as the DB path. */
export class FashionLocalStore {
  constructor(public snapshot: GuestFashionMemorySnapshot) {}

  clone(): FashionLocalStore {
    return new FashionLocalStore(structuredClone(this.snapshot));
  }

  ensureSelfPerson(userId: string): PersonRow {
    const existing = this.snapshot.people.find(
      (p) => p.user_id === userId && p.relation === "self",
    );
    if (existing) return existing;

    const ts = nowIso();
    const row: PersonRow = {
      id: newId(),
      user_id: userId,
      relation: "self",
      name: null,
      birthday: null,
      notes: null,
      intake_completed_at: null,
      created_at: ts,
      updated_at: ts,
    };
    this.snapshot.people.push(row);
    return row;
  }

  createPerson(params: {
    userId: string;
    relation: PersonRelation;
    name?: string | null;
    birthday?: string | null;
    notes?: string | null;
  }): PersonRow {
    if (params.relation === "self") {
      return this.ensureSelfPerson(params.userId);
    }

    const ts = nowIso();
    const row: PersonRow = {
      id: newId(),
      user_id: params.userId,
      relation: params.relation,
      name: params.name ?? null,
      birthday: params.birthday ?? null,
      notes: params.notes ?? null,
      intake_completed_at: null,
      created_at: ts,
      updated_at: ts,
    };
    this.snapshot.people.push(row);
    return row;
  }

  getPersonById(userId: string, personId: string): PersonRow | null {
    return (
      this.snapshot.people.find(
        (p) => p.user_id === userId && p.id === personId,
      ) ?? null
    );
  }

  updatePersonName(params: {
    userId: string;
    personId: string;
    name: string;
  }): PersonRow | null {
    const person = this.getPersonById(params.userId, params.personId);
    if (!person) return null;
    const trimmed = params.name.trim();
    if (!trimmed) return person;
    person.name = trimmed;
    person.updated_at = nowIso();
    return person;
  }

  findPersonByRelation(params: {
    userId: string;
    relation: PersonRelation;
    name?: string | null;
  }): PersonRow | null {
    const name = params.name?.trim().toLowerCase();
    return (
      this.snapshot.people.find((p) => {
        if (p.user_id !== params.userId || p.relation !== params.relation) {
          return false;
        }
        if (!name) return true;
        return (p.name ?? "").trim().toLowerCase() === name;
      }) ?? null
    );
  }

  resolvePerson(params: {
    userId: string;
    relation?: PersonRelation;
    name?: string | null;
    personId?: string;
  }): PersonRow {
    if (params.personId) {
      const byId = this.getPersonById(params.userId, params.personId);
      if (byId) return byId;
      throw new Error(`Person not found: ${params.personId}`);
    }

    const relation = canonicalizeRelation(params.relation ?? "self") as PersonRelation;
    if (relation === "self") return this.ensureSelfPerson(params.userId);

    const name = params.name?.trim() || null;
    const people = this.snapshot.people.filter((p) => p.user_id === params.userId);
    const decision = resolveProposedPerson({
      people,
      personShortIds: buildPersonShortIdMap(people),
      relation,
      name,
    });

    if (decision.action === "merge") {
      if (decision.attachName) {
        const updated = this.updatePersonName({
          userId: params.userId,
          personId: decision.person.id,
          name: decision.attachName,
        });
        if (updated) return updated;
      }
      return decision.person;
    }

    if (decision.action === "create") {
      return this.createPerson({
        userId: params.userId,
        relation: decision.relation as PersonRelation,
        name: decision.name,
      });
    }

    throw new Error(AMBIGUOUS_PERSON_ERROR);
  }

  upsertFashionFact<T extends FashionFactType>(params: {
    userId: string;
    personId: string;
    factType: T;
    garmentType?: string | null;
    value: FashionFactValue<T>;
    sourceQuote?: string | null;
  }): FashionFactRow<T> {
    const garment = garmentKey(params.garmentType);
    const ts = nowIso();

    const activeIdx = this.snapshot.fashion_facts.findIndex((f) => {
      if (
        f.user_id !== params.userId ||
        f.person_id !== params.personId ||
        f.fact_type !== params.factType ||
        f.status !== "active"
      ) {
        return false;
      }
      const fGarment = f.garment_type ?? null;
      return fGarment === garment;
    });

    if (activeIdx >= 0) {
      const prev = this.snapshot.fashion_facts[activeIdx]!;
      if (JSON.stringify(prev.value) === JSON.stringify(params.value)) {
        return prev as FashionFactRow<T>;
      }
    }

    const newRow: FashionFactRow<T> = {
      id: newId(),
      user_id: params.userId,
      person_id: params.personId,
      fact_type: params.factType,
      garment_type: garment,
      value: params.value,
      source_quote: params.sourceQuote ?? null,
      status: "active",
      superseded_by: null,
      created_at: ts,
      updated_at: ts,
    };
    this.snapshot.fashion_facts.push(newRow);

    if (activeIdx >= 0) {
      const prev = this.snapshot.fashion_facts[activeIdx]!;
      prev.status = "superseded";
      prev.superseded_by = newRow.id;
      prev.updated_at = ts;
    }

    return newRow;
  }

  logRequestEvent(params: {
    userId: string;
    personId: string;
    conversationId?: string | null;
    attributes: RequestEventAttributes;
  }): RequestEventRow {
    const row: RequestEventRow = {
      id: newId(),
      user_id: params.userId,
      person_id: params.personId,
      conversation_id: params.conversationId ?? null,
      attributes: params.attributes,
      created_at: nowIso(),
    };
    this.snapshot.request_events.unshift(row);
    return row;
  }

  upsertStyleSignal(params: {
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
    valueCanonical?: string | null;
  }): StyleSignalRow {
    const context = params.context?.trim() || "general";
    const value = normalizeSignalValue(params.value);
    const canonical = (
      params.valueCanonical?.trim() ||
      canonicalizeSignalValueSync(params.signalType, params.value)
    );
    const polarity = params.polarity ?? 1;
    const status =
      params.status ?? (params.source === "stated" ? "active" : "candidate");
    const now = nowIso();

    const idx = this.snapshot.style_signals.findIndex((s) => {
      if (
        s.user_id !== params.userId ||
        s.person_id !== params.personId ||
        s.context !== context ||
        s.signal_type !== params.signalType ||
        s.polarity !== polarity ||
        (s.status !== "active" && s.status !== "candidate")
      ) {
        return false;
      }
      return (
        signalCanonicalKey(s).toLowerCase() === canonical.toLowerCase()
      );
    });

    if (idx >= 0) {
      const row = this.snapshot.style_signals[idx]!;
      if (row.source === "stated" && params.source === "inferred") {
        return row;
      }
      row.source = sourceBeats(row.source, params.source)
        ? params.source
        : row.source;
      row.status =
        params.source === "stated"
          ? "active"
          : row.status === "active"
            ? "active"
            : status;
      row.confidence = Math.min(
        0.95,
        Math.max(row.confidence, params.confidence ?? row.confidence),
      );
      row.evidence_count +=
        params.incrementEvidence === false ? 0 : 1;
      row.last_seen_at = now;
      row.source_quote = params.sourceQuote ?? row.source_quote;
      row.value_canonical = row.value_canonical || canonical;
      return row;
    }

    const row: StyleSignalRow = {
      id: newId(),
      user_id: params.userId,
      person_id: params.personId,
      context,
      signal_type: params.signalType,
      value,
      value_canonical: canonical,
      polarity,
      source: params.source,
      confidence: Math.min(
        0.95,
        params.confidence ?? (params.source === "stated" ? 0.9 : 0.5),
      ),
      evidence_count: 1,
      status,
      source_quote: params.sourceQuote ?? null,
      first_seen_at: now,
      last_seen_at: now,
    };
    this.snapshot.style_signals.push(row);
    return row;
  }

  findActiveFashionFact(params: {
    userId: string;
    personId: string;
    factType: FashionFactType;
    garmentType?: string | null;
  }): FashionFactRow | null {
    const garment = garmentKey(params.garmentType);
    return (
      this.snapshot.fashion_facts.find(
        (f) =>
          f.user_id === params.userId &&
          f.person_id === params.personId &&
          f.fact_type === params.factType &&
          f.status === "active" &&
          (f.garment_type ?? null) === garment,
      ) ?? null
    );
  }

  /** Hard-delete measurement facts (privacy) — mirrors purgePersonMeasurementFacts. */
  purgeMeasurementFacts(params: {
    userId: string;
    personId: string;
  }): number {
    const before = this.snapshot.fashion_facts.length;
    this.snapshot.fashion_facts = this.snapshot.fashion_facts.filter(
      (f) =>
        !(
          f.user_id === params.userId &&
          f.person_id === params.personId &&
          f.fact_type === "measurement"
        ),
    );
    return before - this.snapshot.fashion_facts.length;
  }

  findActiveStyleSignal(params: {
    userId: string;
    personId: string;
    context?: string;
    signalType: StyleSignalType;
    value: string;
    polarity?: -1 | 1;
    valueCanonical?: string | null;
  }): StyleSignalRow | null {
    const context = params.context?.trim() || "general";
    const canonical = (
      params.valueCanonical?.trim() ||
      canonicalizeSignalValueSync(params.signalType, params.value)
    );
    const polarity = params.polarity ?? 1;
    return (
      this.snapshot.style_signals.find((s) => {
        if (
          s.user_id !== params.userId ||
          s.person_id !== params.personId ||
          s.context !== context ||
          s.signal_type !== params.signalType ||
          s.polarity !== polarity ||
          (s.status !== "active" && s.status !== "candidate")
        ) {
          return false;
        }
        return (
          signalCanonicalKey(s).toLowerCase() === canonical.toLowerCase()
        );
      }) ?? null
    );
  }

  supersedeStyleSignal(params: { userId: string; signalId: string }): void {
    const row = this.snapshot.style_signals.find(
      (s) => s.user_id === params.userId && s.id === params.signalId,
    );
    if (row) row.status = "superseded";
  }

  bumpStyleSignalConfidence(params: {
    userId: string;
    signalId: string;
    incomingConfidence: number;
    cap?: number;
  }): StyleSignalRow {
    const row = this.snapshot.style_signals.find(
      (s) => s.user_id === params.userId && s.id === params.signalId,
    );
    if (!row) throw new Error("signal_not_found");
    const cap = params.cap ?? 0.95;
    row.confidence = Math.min(cap, Math.max(row.confidence, params.incomingConfidence));
    row.evidence_count += 1;
    row.last_seen_at = nowIso();
    return row;
  }

  getLatestExtractionRun(params: {
    userId: string;
    conversationId: string;
  }): ExtractionRunRow | null {
    const runs = this.snapshot.extraction_runs
      .filter(
        (r) =>
          r.user_id === params.userId &&
          r.conversation_id === params.conversationId,
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    return runs[0] ?? null;
  }

  beginExtractionRun(params: {
    userId: string;
    conversationId: string;
    lastMessageId: string;
  }): ExtractionRunRow {
    const row: ExtractionRunRow = {
      id: newId(),
      user_id: params.userId,
      conversation_id: params.conversationId,
      last_message_id: params.lastMessageId,
      status: "running",
      ops_applied: null,
      ambiguous_subjects: null,
      created_at: nowIso(),
      finished_at: null,
    };
    this.snapshot.extraction_runs.unshift(row);
    return row;
  }

  finishExtractionRun(params: {
    runId: string;
    status: "done" | "failed";
    opsApplied?: ExtractionOpResult[];
    ambiguousSubjects?: import("../types").AmbiguousSubject[] | null;
  }): void {
    const row = this.snapshot.extraction_runs.find((r) => r.id === params.runId);
    if (!row) return;
    row.status = params.status;
    row.ops_applied = params.opsApplied ?? null;
    row.ambiguous_subjects = params.ambiguousSubjects ?? null;
    row.finished_at = nowIso();
  }
}

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

/** Same corroboration rules as the server path — runs on local snapshot. */
export function runLocalRequestEventCorroboration(
  store: FashionLocalStore,
  params: { userId: string; personId: string; context?: string },
): ExtractionOpResult[] {
  const buckets = new Map<
    string,
    {
      signalType: StyleSignalType;
      value: string;
      eventCount: number;
      conversationIds: Set<string>;
    }
  >();

  for (const row of store.snapshot.request_events) {
    if (
      row.user_id !== params.userId ||
      row.person_id !== params.personId
    ) {
      continue;
    }
    for (const [key, raw] of Object.entries(row.attributes ?? {})) {
      const signalType =
        ATTRIBUTE_TO_SIGNAL[key as keyof RequestEventAttributes];
      if (!signalType || !raw?.trim()) continue;
      const value = canonicalizeSignalValueSync(signalType, raw);
      const bucketKey = `${signalType}:${value.toLowerCase()}`;
      const existing = buckets.get(bucketKey);
      if (existing) {
        existing.eventCount += 1;
        if (row.conversation_id) {
          existing.conversationIds.add(row.conversation_id);
        }
      } else {
        buckets.set(bucketKey, {
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

  const results: ExtractionOpResult[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.eventCount < MIN_EVENTS) continue;
    if (bucket.conversationIds.size < MIN_CONVERSATIONS) continue;

    const promoteActive = bucket.eventCount >= PROMOTE_AT_EVENTS;
    const signal = store.upsertStyleSignal({
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
