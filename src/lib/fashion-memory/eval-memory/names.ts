import { normalizePersonName } from "../person-name";

/** Name compare for roster matching — casefold, strip accents/punctuation, collapse space. */

export function normalizeName(raw: string | null | undefined): string {
  return normalizePersonName(raw);
}

export function parsePersonLabel(label: string): {
  relation: string;
  name: string;
} {
  const t = label.trim();
  const m = t.match(/^(.+?)\s+\((.+)\)$/);
  if (m) {
    return {
      relation: m[1]!.trim().toLowerCase(),
      name: m[2]!.trim(),
    };
  }
  return { relation: t.toLowerCase(), name: "" };
}

export function personKey(relation: string, name?: string | null): string {
  const rel = relation.trim().toLowerCase() || "unknown";
  const n = normalizeName(name);
  return n ? `${rel}|${n}` : rel;
}

export function labelKey(label: string): string {
  const { relation, name } = parsePersonLabel(label);
  return personKey(relation, name);
}

export function formatPersonKey(relation: string, name?: string | null): string {
  const n = name?.trim();
  return n ? `${relation} (${n})` : relation;
}
