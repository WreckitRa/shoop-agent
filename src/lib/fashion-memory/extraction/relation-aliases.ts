import { normalizePersonName } from "../person-name";
import type { PersonRow } from "../types";

/**
 * Canonical relations the LLM may emit. Unique-slot membership is a rule
 * over this enum — not an input-side alias map. Aliases (mom/mama/ماما)
 * are the detect_people prompt's job.
 */
export const CANONICAL_PERSON_RELATIONS = [
  "mother",
  "father",
  "sister",
  "brother",
  "son",
  "daughter",
  "wife",
  "husband",
  "nephew",
  "niece",
  "friend",
  "colleague",
  "grandmother",
  "grandfather",
  "aunt",
  "uncle",
  "girlfriend",
  "boyfriend",
] as const;

export type CanonicalPersonRelation =
  (typeof CANONICAL_PERSON_RELATIONS)[number];

const CANONICAL_SET = new Set<string>(CANONICAL_PERSON_RELATIONS);

/** Tokens that must never be stored as a display name. */
const RELATION_NAME_VOCABULARY = new Set<string>([
  ...CANONICAL_PERSON_RELATIONS,
  "self",
  "mom",
  "mum",
  "mama",
  "ma",
  "ماما",
  "dad",
  "daddy",
  "papa",
  "بابا",
  "grandma",
  "grandpa",
  "teta",
  "تيتا",
  "coworker",
  "co-worker",
]);

/** Relations that typically have at most one roster entry per user. */
export const UNIQUE_CANONICAL_RELATIONS = new Set([
  "mother",
  "father",
  "wife",
  "husband",
  "girlfriend",
  "boyfriend",
  "grandmother",
  "grandfather",
]);

export function isCanonicalPersonRelation(
  raw: string | null | undefined,
): raw is CanonicalPersonRelation {
  return CANONICAL_SET.has((raw ?? "").trim().toLowerCase());
}

export function isUniqueCanonicalRelation(relation: string): boolean {
  return UNIQUE_CANONICAL_RELATIONS.has(canonicalizeRelation(relation));
}

/** Canonical key if `raw` already is one (or possessive-child). Else null. */
export function normalizeRelationAlias(raw: string): string | null {
  const canonical = canonicalizeRelation(raw);
  if (!canonical) return null;
  if (canonical === "self") return "self";
  return CANONICAL_SET.has(canonical) ? canonical : null;
}

/** True when `raw` is a relation vocabulary token, not a personal name. */
export function isRelationWord(raw: string | null | undefined): boolean {
  const key = (raw ?? "").trim().toLowerCase();
  return Boolean(key) && RELATION_NAME_VOCABULARY.has(key);
}

/**
 * Sister's/brother's child → nephew/niece. Canonical keys pass through.
 * Does not map mom/mama — detect_people emits the canonical key.
 */
export function canonicalizeRelation(
  raw: string | null | undefined,
  departmentHint?: string | null,
): string {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return "";
  const possessive = possessiveChildRelation(key, departmentHint);
  if (possessive) return possessive;
  if (key === "self" || CANONICAL_SET.has(key)) return key;
  return key;
}

function possessiveChildRelation(
  raw: string,
  departmentHint?: string | null,
): string | null {
  const t = raw.replace(/['’]/g, "'");
  const m = t.match(
    /^(sister|brother|sibling)'s\s+(son|daughter|child|kid|boy|girl)$/,
  );
  if (!m) return null;
  const child = m[2];
  if (child === "son" || child === "boy") return "nephew";
  if (child === "daughter" || child === "girl") return "niece";
  const hint = departmentHint?.trim().toLowerCase();
  if (hint === "girls") return "niece";
  return "nephew";
}

export function findRosterDuplicateForNewPerson(params: {
  people: PersonRow[];
  relation: string;
  name?: string | null;
}): PersonRow | null {
  const canonical = canonicalizeRelation(params.relation);
  if (!canonical || !CANONICAL_SET.has(canonical)) return null;

  const nameNorm = normalizePersonName(params.name) || null;

  if (UNIQUE_CANONICAL_RELATIONS.has(canonical)) {
    return (
      params.people.find(
        (p) => canonicalizeRelation(p.relation) === canonical,
      ) ?? null
    );
  }

  if (!nameNorm) return null;
  return (
    params.people.find((p) => {
      if (normalizePersonName(p.name) !== nameNorm) return false;
      return canonicalizeRelation(p.relation) === canonical;
    }) ?? null
  );
}
