/**
 * Relation beats name: matching / labeling people for prompts and gates.
 */
import {
  isUniqueCanonicalRelation,
  normalizeRelationAlias,
} from "./relation-aliases";
import type { PersonRow } from "../types";

const SKIP_OPTION = "Skip";

/** Display label always relation-first so two Gabriels are distinct. */
export function formatPersonChoiceLabel(person: Pick<PersonRow, "relation" | "name">): string {
  const relation = person.relation.trim() || "unknown";
  const name = person.name?.trim();
  return name ? `${relation} (${name})` : relation;
}

export function findPeopleByName(
  people: PersonRow[],
  name: string,
): PersonRow[] {
  const n = name.trim().toLowerCase();
  if (!n) return [];
  return people.filter((p) => (p.name ?? "").trim().toLowerCase() === n);
}

export function relationsCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ca = normalizeRelationAlias(a ?? "") ?? (a ?? "").trim().toLowerCase();
  const cb = normalizeRelationAlias(b ?? "") ?? (b ?? "").trim().toLowerCase();
  if (!ca || !cb) return false;
  return ca === cb;
}

/** Roster people sharing a canonical relation (mother/mom → mother). */
export function findPeopleByRelation(
  people: PersonRow[],
  relation: string,
): PersonRow[] {
  const canonical =
    normalizeRelationAlias(relation) ?? relation.trim().toLowerCase();
  if (!canonical) return [];
  return people.filter((p) => {
    const pCanon =
      normalizeRelationAlias(p.relation) ?? p.relation.trim().toLowerCase();
    return pCanon === canonical;
  });
}

/** Count of roster people sharing a canonical relation. */
export function countPeopleWithRelation(
  people: PersonRow[],
  relation: string,
): number {
  return findPeopleByRelation(people, relation).length;
}

/**
 * When exactly one roster person matches a mentioned relation ("my mother"
 * with one mother), that IS the person — resolve silently, never confirm.
 */
export function singleRelationMatch(params: {
  userText: string;
  people: PersonRow[];
}): PersonRow | null {
  const text = params.userText.trim();
  if (!text) return null;

  // Prefer gift/third-person phrasing ("for my mother") when present.
  const giftCue =
    /\b(?:(?:for|gift(?:\s+for)?|present(?:\s+for)?)\s+(?:my\s+)?|my\s+)(mother|mom|mum|mama|father|dad|daddy|papa|wife|husband|sister|brother|son|daughter|girlfriend|boyfriend|grandmother|grandma|grandfather|grandpa|friend|colleague|coworker)\b/i.exec(
      text,
    );
  const raw = giftCue?.[1];
  if (!raw) return null;
  const matches = findPeopleByRelation(params.people, raw);
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Name is optional when this will be the first person of that relation,
 * or when the role is a unique family alias (mother/mom) that merges.
 * A second "son" needs a name to distinguish.
 */
export function isNameOptionalForRelation(
  people: PersonRow[],
  relation: string,
): boolean {
  const count = countPeopleWithRelation(people, relation);
  if (count === 0) return true;
  if (isUniqueCanonicalRelation(relation) && count === 1) return true;
  return false;
}

/** Roster display names (lowercased) for stripping illegal quick_options. */
export function rosterDisplayNames(people: PersonRow[]): string[] {
  const out: string[] = [];
  for (const p of people) {
    const n = p.name?.trim();
    if (n) out.push(n);
  }
  return out;
}

export function isSkipNameOption(option: string): boolean {
  return option.trim().toLowerCase() === SKIP_OPTION.toLowerCase();
}

/**
 * If the user text mentions a roster name shared by 2+ people, and does not
 * pin a compatible relation, return those people for disambiguation.
 */
export function ambiguousNameMatches(params: {
  userText: string;
  people: PersonRow[];
}): PersonRow[] | null {
  const text = params.userText.trim();
  if (!text) return null;

  const byName = new Map<string, PersonRow[]>();
  for (const p of params.people) {
    const n = p.name?.trim().toLowerCase();
    if (!n || p.relation === "self") continue;
    const list = byName.get(n) ?? [];
    list.push(p);
    byName.set(n, list);
  }

  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
    if (!re.test(text)) continue;

    // Relation cue that uniquely identifies one of the group → no ambiguity.
    const relationPinned = group.filter((p) => {
      const aliases = relationMentionAliases(p.relation);
      return aliases.some((a) => new RegExp(`\\b${escapeRegex(a)}\\b`, "i").test(text));
    });
    if (relationPinned.length === 1) return null;
    if (relationPinned.length > 1) return relationPinned;
    return group;
  }
  return null;
}

function relationMentionAliases(relation: string): string[] {
  const canonical =
    normalizeRelationAlias(relation) ?? relation.trim().toLowerCase();
  const aliases: Record<string, string[]> = {
    mother: ["mother", "mom", "mum", "mama"],
    father: ["father", "dad", "daddy", "papa"],
    brother: ["brother"],
    sister: ["sister"],
    son: ["son"],
    daughter: ["daughter"],
    wife: ["wife"],
    husband: ["husband"],
    girlfriend: ["girlfriend"],
    boyfriend: ["boyfriend"],
    grandmother: ["grandmother", "grandma"],
    grandfather: ["grandfather", "grandpa"],
    friend: ["friend"],
    colleague: ["colleague", "coworker"],
  };
  return aliases[canonical] ?? [canonical];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export { SKIP_OPTION as PERSON_NAME_SKIP_OPTION };
