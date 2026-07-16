/**
 * Synchronous registration of router `stated_facts` before the identity gate.
 * Idempotent with async extraction (upsert supersedes / noop on same value).
 */
import { logAiChat } from "@/lib/ai-chat/observability";
import { isSupabaseAuthUserId } from "../auth";
import {
  fashionFactValuesEqual,
  findActiveFashionFact,
  upsertFashionFact,
} from "../facts";
import { FashionLocalStore } from "../local/store";
import type { GuestFashionMemorySnapshot } from "../local/store";
import { resolvePerson } from "../people";
import { recordPipelineEvent } from "../observability/trace";
import type { FashionStatedFacts } from "../router/types";
import type {
  FashionFactRow,
  FashionFactSizeValue,
  PersonRelation,
  PersonRow,
} from "../types";
import type { SizeGarmentBucket } from "./garment-size-fields";
import { parseDepartmentAnswer } from "./identity-gate";
import { parseSizeValue } from "./parse-size-value";

function inferRelation(raw: string | undefined): PersonRelation {
  const t = (raw ?? "").toLowerCase();
  if (/\b(colleague|coworker|co-worker)\b/.test(t)) return "colleague";
  if (/\bfriend\b/.test(t)) return "friend";
  if (/\bmother|mom\b/.test(t)) return "mother";
  if (/\bfather|dad\b/.test(t)) return "father";
  if (/\bwife\b/.test(t)) return "wife";
  if (/\bhusband\b/.test(t)) return "husband";
  if (/\bsister\b/.test(t)) return "sister";
  if (/\bbrother\b/.test(t)) return "brother";
  if (/\bson\b/.test(t)) return "son";
  if (/\bdaughter\b/.test(t)) return "daughter";
  if (t === "self") return "self";
  return "friend";
}

function sizeEntries(
  sizes: FashionStatedFacts["sizes"],
): Array<{ bucket: SizeGarmentBucket; raw: string }> {
  if (!sizes) return [];
  const out: Array<{ bucket: SizeGarmentBucket; raw: string }> = [];
  if (sizes.tops?.trim()) out.push({ bucket: "tops", raw: sizes.tops.trim() });
  if (sizes.bottoms?.trim())
    out.push({ bucket: "bottoms", raw: sizes.bottoms.trim() });
  if (sizes.shoes?.trim())
    out.push({ bucket: "shoes", raw: sizes.shoes.trim() });
  if (sizes.dresses?.trim())
    out.push({ bucket: "dresses", raw: sizes.dresses.trim() });
  return out;
}

export type ApplyStatedFactsResult = {
  personId: string | null;
  person: PersonRow | null;
  factsWritten: FashionFactRow[];
  contradictions: Array<{
    fact_type: string;
    garment_type?: string;
    previous: unknown;
    next: unknown;
  }>;
};

async function writeSizeFact(params: {
  userId: string;
  personId: string;
  bucket: SizeGarmentBucket;
  value: FashionFactSizeValue;
  sourceQuote: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
  existing: FashionFactRow | null;
  contradictions: ApplyStatedFactsResult["contradictions"];
}): Promise<FashionFactRow | null> {
  if (
    params.existing &&
    !fashionFactValuesEqual(params.existing.value, params.value)
  ) {
    params.contradictions.push({
      fact_type: "size",
      garment_type: params.bucket,
      previous: params.existing.value,
      next: params.value,
    });
  }

  if (isSupabaseAuthUserId(params.userId)) {
    return upsertFashionFact({
      userId: params.userId,
      personId: params.personId,
      factType: "size",
      garmentType: params.bucket,
      value: params.value,
      sourceQuote: params.sourceQuote,
    });
  }
  if (params.guestSnapshot) {
    const store = new FashionLocalStore(params.guestSnapshot);
    return store.upsertFashionFact({
      userId: params.userId,
      personId: params.personId,
      factType: "size",
      garmentType: params.bucket,
      value: params.value,
      sourceQuote: params.sourceQuote,
    });
  }
  return null;
}

/**
 * Register stated_facts in-request. Latest value wins on contradiction;
 * logs `in_conversation_contradiction` and never asks the user to resolve.
 */
export async function applyStatedFacts(params: {
  userId: string;
  stated: FashionStatedFacts;
  evidenceQuote?: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
  /** Existing roster for resolving person_ref short/full ids. */
  people?: PersonRow[];
  personShortIds?: Record<string, string>;
  traceId?: string | null;
}): Promise<ApplyStatedFactsResult> {
  const evidence = (params.evidenceQuote ?? "").slice(0, 500);
  const contradictions: ApplyStatedFactsResult["contradictions"] = [];
  const factsWritten: FashionFactRow[] = [];

  let person: PersonRow | null = null;
  const people = params.people ?? [];
  const shortIds = params.personShortIds ?? {};

  const ref = params.stated.person_ref;
  if (ref === "new" || params.stated.new_person) {
    const name = params.stated.new_person?.name?.trim();
    const relation = inferRelation(params.stated.new_person?.relation);
    if (isSupabaseAuthUserId(params.userId)) {
      person = await resolvePerson({
        userId: params.userId,
        relation,
        name: name || null,
      });
    } else if (params.guestSnapshot) {
      const store = new FashionLocalStore(params.guestSnapshot);
      person = store.resolvePerson({
        userId: params.userId,
        relation,
        name: name || null,
      });
    }
  } else if (ref === "self") {
    if (isSupabaseAuthUserId(params.userId)) {
      person = await resolvePerson({ userId: params.userId, relation: "self" });
    } else if (params.guestSnapshot) {
      const store = new FashionLocalStore(params.guestSnapshot);
      person = store.resolvePerson({
        userId: params.userId,
        relation: "self",
      });
    }
  } else {
    const mapped = shortIds[ref] ?? ref;
    // Resolve by id / short id only — never by name alone (relation beats name;
    // brother Gabriel ≠ son Gabriel).
    person =
      people.find((p) => p.id === mapped || p.id === ref) ?? null;

    if (!person && isSupabaseAuthUserId(params.userId)) {
      const { getPersonById } = await import("../people");
      person = await getPersonById(params.userId, mapped);
    } else if (!person && params.guestSnapshot) {
      const store = new FashionLocalStore(params.guestSnapshot);
      person = store.getPersonById(params.userId, mapped);
    }
  }

  if (!person) {
    logAiChat("warn", "fashion_stated_facts_no_person", {
      traceId: params.traceId,
      person_ref: ref,
    });
    return { personId: null, person: null, factsWritten, contradictions };
  }

  const personId = person.id;

  const dept = params.stated.department;

  if (dept) {
    const presentation =
      dept === "mens" ||
      dept === "womens" ||
      dept === "boys" ||
      dept === "girls" ||
      dept === "baby" ||
      dept === "mixed"
        ? dept
        : parseDepartmentAnswer(String(dept));
    if (presentation) {
      let existing: FashionFactRow | null = null;
      if (isSupabaseAuthUserId(params.userId)) {
        existing = await findActiveFashionFact({
          userId: params.userId,
          personId,
          factType: "gender_presentation",
        });
      } else if (params.guestSnapshot) {
        existing =
          params.guestSnapshot.fashion_facts.find(
            (f) =>
              f.user_id === params.userId &&
              f.person_id === personId &&
              f.fact_type === "gender_presentation" &&
              f.status === "active",
          ) ?? null;
      }
      if (
        existing &&
        !fashionFactValuesEqual(existing.value, { presentation })
      ) {
        contradictions.push({
          fact_type: "gender_presentation",
          previous: existing.value,
          next: { presentation },
        });
      }
      if (isSupabaseAuthUserId(params.userId)) {
        factsWritten.push(
          await upsertFashionFact({
            userId: params.userId,
            personId,
            factType: "gender_presentation",
            value: { presentation },
            sourceQuote: evidence || null,
          }),
        );
      } else if (params.guestSnapshot) {
        const store = new FashionLocalStore(params.guestSnapshot);
        factsWritten.push(
          store.upsertFashionFact({
            userId: params.userId,
            personId,
            factType: "gender_presentation",
            value: { presentation },
            sourceQuote: evidence || null,
          }),
        );
      }
    }
  }

  for (const { bucket, raw } of sizeEntries(params.stated.sizes)) {
    const value = parseSizeValue(raw);
    let existing: FashionFactRow | null = null;
    if (isSupabaseAuthUserId(params.userId)) {
      existing = await findActiveFashionFact({
        userId: params.userId,
        personId,
        factType: "size",
        garmentType: bucket,
      });
    } else if (params.guestSnapshot) {
      existing =
        params.guestSnapshot.fashion_facts.find(
          (f) =>
            f.user_id === params.userId &&
            f.person_id === personId &&
            f.fact_type === "size" &&
            f.status === "active" &&
            (f.garment_type ?? "").toLowerCase() === bucket,
        ) ?? null;
    }
    const written = await writeSizeFact({
      userId: params.userId,
      personId,
      bucket,
      value,
      sourceQuote: evidence,
      guestSnapshot: params.guestSnapshot,
      existing,
      contradictions,
    });
    if (written) factsWritten.push(written);
  }

  if (params.stated.budget?.max != null) {
    const band = {
      min: null as number | null,
      max: params.stated.budget.max,
      currency: params.stated.budget.currency ?? "USD",
    };
    let existing: FashionFactRow | null = null;
    if (isSupabaseAuthUserId(params.userId)) {
      existing = await findActiveFashionFact({
        userId: params.userId,
        personId,
        factType: "budget_band",
      });
    } else if (params.guestSnapshot) {
      existing =
        params.guestSnapshot.fashion_facts.find(
          (f) =>
            f.user_id === params.userId &&
            f.person_id === personId &&
            f.fact_type === "budget_band" &&
            f.status === "active",
        ) ?? null;
    }
    if (existing && !fashionFactValuesEqual(existing.value, band)) {
      contradictions.push({
        fact_type: "budget_band",
        previous: existing.value,
        next: band,
      });
    }
    if (isSupabaseAuthUserId(params.userId)) {
      factsWritten.push(
        await upsertFashionFact({
          userId: params.userId,
          personId,
          factType: "budget_band",
          value: band,
          sourceQuote: evidence || null,
        }),
      );
    } else if (params.guestSnapshot) {
      const store = new FashionLocalStore(params.guestSnapshot);
      factsWritten.push(
        store.upsertFashionFact({
          userId: params.userId,
          personId,
          factType: "budget_band",
          value: band,
          sourceQuote: evidence || null,
        }),
      );
    }
  }

  for (const c of contradictions) {
    logAiChat("info", "in_conversation_contradiction", {
      traceId: params.traceId,
      person_id: personId,
      ...c,
    });
    recordPipelineEvent({
      traceId: params.traceId,
      stage: "stated_facts",
      payload: {
        decision: "in_conversation_contradiction",
        person_id: personId,
        ...c,
      },
    });
  }

  logAiChat("info", "fashion_stated_facts_applied", {
    traceId: params.traceId,
    person_id: personId,
    facts_written: factsWritten.length,
    contradictions: contradictions.length,
  });

  return { personId, person, factsWritten, contradictions };
}
