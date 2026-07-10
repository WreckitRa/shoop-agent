import type { PersonRow } from "../types";

/**
 * Canonical relation keys for unique-ish family roles. Aliases collapse so
 * "mom" / "mother" / "mama" / "ماما" map to one roster slot.
 * friend/colleague are omitted — multiple are allowed; name matching is separate.
 */
const RELATION_ALIAS_TO_CANONICAL: Record<string, string> = {
  mother: "mother",
  mom: "mother",
  mum: "mother",
  mama: "mother",
  "ماما": "mother",
  father: "father",
  dad: "father",
  daddy: "father",
  papa: "father",
  "بابا": "father",
  wife: "wife",
  husband: "husband",
  sister: "sister",
  brother: "brother",
  girlfriend: "girlfriend",
  boyfriend: "boyfriend",
  son: "son",
  daughter: "daughter",
  grandmother: "grandmother",
  grandma: "grandmother",
  teta: "grandmother",
  "تيتا": "grandmother",
  grandfather: "grandfather",
  grandpa: "grandfather",
  aunt: "aunt",
  uncle: "uncle",
  niece: "niece",
  nephew: "nephew",
};

/** Relations that typically have at most one roster entry per user. */
const UNIQUE_CANONICAL_RELATIONS = new Set([
  "mother",
  "father",
  "wife",
  "husband",
  "girlfriend",
  "boyfriend",
  "grandmother",
  "grandfather",
]);

export function normalizeRelationAlias(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return RELATION_ALIAS_TO_CANONICAL[key] ?? null;
}

export function findRosterDuplicateForNewPerson(params: {
  people: PersonRow[];
  relation: string;
  name?: string | null;
}): PersonRow | null {
  const canonical = normalizeRelationAlias(params.relation) ?? params.relation.trim().toLowerCase();
  if (!canonical) return null;

  const nameNorm = params.name?.trim().toLowerCase() || null;

  // Unique family roles: any existing person with the same canonical relation.
  if (UNIQUE_CANONICAL_RELATIONS.has(canonical)) {
    const match = params.people.find((p) => {
      const pCanon =
        normalizeRelationAlias(p.relation) ?? p.relation.trim().toLowerCase();
      return pCanon === canonical;
    });
    return match ?? null;
  }

  // Non-unique (friend/colleague/…): only reject exact same relation + name.
  // Cross-bucket ambiguity (friend Sam vs colleague Sam) is the LLM's job
  // via ambiguous_subject — do not auto-merge here.
  if (!nameNorm) return null;
  return (
    params.people.find((p) => {
      const pName = p.name?.trim().toLowerCase();
      if (!pName || pName !== nameNorm) return false;
      const pCanon =
        normalizeRelationAlias(p.relation) ?? p.relation.trim().toLowerCase();
      return pCanon === canonical;
    }) ?? null
  );
}
