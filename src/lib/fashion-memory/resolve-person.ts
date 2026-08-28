import {
  coercePersonDepartment,
  departmentFromRelation,
  type PersonDepartment,
} from "./department";
import {
  canonicalizeRelation,
  isRelationWord,
  isUniqueCanonicalRelation,
} from "./extraction/relation-aliases";
import { levenshtein } from "./normalize/fuzzy";
import { normalizePersonName } from "./person-name";
import type { PersonRow } from "./types";

export const MATCH_EXISTING_THRESHOLD = 0.85;
/** Same-relation names this close are not identity — ask, never create/merge. */
export const NEAR_NAME_MAX_DISTANCE = 2;
export const AMBIGUOUS_PERSON_ERROR = "ambiguous_person";

export type MatchExistingProposal = {
  personRef: string;
  confidence: number;
  why?: string;
};

export type ResolveProposedInput = {
  people: PersonRow[];
  personShortIds: Record<string, string>;
  mentionText?: string;
  relation?: string | null;
  name?: string | null;
  isRecipient?: boolean;
  departmentHint?: string | null;
  matchExisting?: MatchExistingProposal | null;
};

export type ResolveProposedDecision =
  | { action: "merge"; person: PersonRow; attachName?: string }
  | { action: "create"; relation: string; name: string | null }
  | { action: "ambiguous"; candidates: PersonRow[]; mention: string }
  | { action: "skip" };

function lookupPersonRef(
  people: PersonRow[],
  personShortIds: Record<string, string>,
  ref: string,
): PersonRow | null {
  const raw = ref.trim().replace(/^#/, "");
  if (!raw) return null;
  const fromShort = personShortIds[raw.toLowerCase()];
  if (fromShort) {
    return people.find((p) => p.id === fromShort) ?? null;
  }
  return people.find((p) => p.id === raw) ?? null;
}

function sameRelation(a: string, b: string): boolean {
  const ca = canonicalizeRelation(a);
  const cb = canonicalizeRelation(b);
  return Boolean(ca && cb && ca === cb);
}

function namedHits(
  people: PersonRow[],
  nameNorm: string,
): PersonRow[] {
  return people.filter(
    (p) =>
      p.relation !== "self" && normalizePersonName(p.name) === nameNorm,
  );
}

function relationHits(people: PersonRow[], relation: string): PersonRow[] {
  const canonical = canonicalizeRelation(relation);
  if (!canonical) return [];
  return people.filter((p) => canonicalizeRelation(p.relation) === canonical);
}

/** Exact normalized names are identity. Distance 1–2 on the same relation is a near-miss. */
export function isNearName(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizePersonName(a);
  const right = normalizePersonName(b);
  if (!left || !right || left === right) return false;
  return levenshtein(left, right) <= NEAR_NAME_MAX_DISTANCE;
}

function nearNameHits(
  people: PersonRow[],
  relation: string,
  name: string,
): PersonRow[] {
  return relationHits(people, relation).filter((p) => isNearName(p.name, name));
}

export function departmentForProposedPerson(params: {
  relation: string;
  departmentHint?: string | null;
  ageHint?: number | null;
}): PersonDepartment | null {
  const hinted = coercePersonDepartment(params.departmentHint);
  if (hinted) return hinted;
  const fromRel = departmentFromRelation(params.relation);
  const age = params.ageHint;
  if (age != null && age >= 0 && age <= 17) {
    if (fromRel === "mens") return "boys";
    if (fromRel === "womens") return "girls";
  }
  return fromRel;
}

/**
 * LLM proposes; code decides. Merge only at confidence ≥ 0.85 AND the same
 * canonical relation AND not a near-name (edit distance 1–2). Exact
 * normalized names are identity. Unique-relation slots and the
 * unnamed-singleton attach-name rule stay here.
 */
export function resolveProposedPerson(
  params: ResolveProposedInput,
): ResolveProposedDecision {
  if (params.isRecipient === false) return { action: "skip" };

  const relation = canonicalizeRelation(
    params.relation,
    params.departmentHint,
  );
  const rawName = params.name?.trim() || null;
  const name = rawName && isRelationWord(rawName) ? null : rawName;
  const nameNorm = normalizePersonName(name);
  const mention = params.mentionText?.trim() || name || relation || "someone";

  if (nameNorm && !relation) {
    const hits = namedHits(params.people, nameNorm);
    if (hits.length > 1) {
      return { action: "ambiguous", candidates: hits, mention };
    }
    if (hits.length === 1) {
      return { action: "merge", person: hits[0]! };
    }
  }

  const matchRef = params.matchExisting?.personRef?.trim();
  if (matchRef && params.matchExisting) {
    const candidate = lookupPersonRef(
      params.people,
      params.personShortIds,
      matchRef,
    );
    if (candidate) {
      const relConflict =
        Boolean(relation) && !sameRelation(relation, candidate.relation);
      if (relConflict) {
        // Distinct relations are distinct people — do not merge, keep going.
      } else if (
        name &&
        isNearName(candidate.name, name)
      ) {
        return { action: "ambiguous", candidates: [candidate], mention };
      } else if (params.matchExisting.confidence >= MATCH_EXISTING_THRESHOLD) {
        return mergeDecision(candidate, name);
      } else {
        return { action: "ambiguous", candidates: [candidate], mention };
      }
    }
  }

  if (relation && isUniqueCanonicalRelation(relation)) {
    const existing = relationHits(params.people, relation)[0];
    if (existing) return mergeDecision(existing, name);
  }

  if (relation && nameNorm) {
    const sameRelNamed = relationHits(params.people, relation).filter(
      (p) => normalizePersonName(p.name) === nameNorm,
    );
    if (sameRelNamed.length === 1) {
      return { action: "merge", person: sameRelNamed[0]! };
    }
    if (sameRelNamed.length > 1) {
      return { action: "ambiguous", candidates: sameRelNamed, mention };
    }
  }

  if (relation) {
    const sameRel = relationHits(params.people, relation);
    if (name && sameRel.length === 1 && !sameRel[0]!.name?.trim()) {
      return { action: "merge", person: sameRel[0]!, attachName: name };
    }
    if (!name && sameRel.length === 1) {
      return { action: "merge", person: sameRel[0]! };
    }
    if (!name && sameRel.length > 1) {
      return { action: "ambiguous", candidates: sameRel, mention };
    }
  }

  if (relation && name) {
    const near = nearNameHits(params.people, relation, name);
    if (near.length) {
      return { action: "ambiguous", candidates: near, mention };
    }
  }

  if (relation) {
    return { action: "create", relation, name };
  }

  if (nameNorm) {
    return { action: "ambiguous", candidates: [], mention };
  }

  return { action: "skip" };
}

function mergeDecision(
  person: PersonRow,
  incomingName: string | null,
): ResolveProposedDecision {
  if (incomingName && !person.name?.trim()) {
    return { action: "merge", person, attachName: incomingName };
  }
  return { action: "merge", person };
}
