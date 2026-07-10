import type { FashionLocalStore } from "./local/store";
import { resolvePerson } from "./people";
import type { PersonRelation, PersonRow } from "./types";

/**
 * Canonical relation keys we will create on the roster when the user
 * clearly shops for someone else. Aliases collapse (mom → mother).
 *
 * Friend/colleague are omitted: too ambiguous without a name, and the
 * extractor can still create them via new_person later.
 */
const RELATION_CANONICAL: Record<string, string> = {
  mother: "mother",
  mom: "mother",
  mum: "mother",
  mama: "mother",
  father: "father",
  dad: "father",
  daddy: "father",
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
  grandfather: "grandfather",
  grandpa: "grandfather",
  aunt: "aunt",
  uncle: "uncle",
  niece: "niece",
  nephew: "nephew",
};

const RELATION_ALT = Object.keys(RELATION_CANONICAL)
  .sort((a, b) => b.length - a.length)
  .join("|");

/**
 * Gift / third-person cues: "for my mother", "my mom", "for mom",
 * "shopping for my sister". Avoids bare "mother" in unrelated prose.
 */
const MENTION_RE = new RegExp(
  `\\b(?:(?:for|gift(?:\\s+for)?|present(?:\\s+for)?)\\s+(?:my\\s+)?|my\\s+)(${RELATION_ALT})\\b`,
  "gi",
);

export function canonicalRelationFromMention(
  raw: string,
): PersonRelation | null {
  const key = raw.trim().toLowerCase();
  const canonical = RELATION_CANONICAL[key];
  return canonical ? (canonical as PersonRelation) : null;
}

/** Unique canonical relations mentioned as gift/third-person recipients. */
export function extractMentionedRelations(text: string): PersonRelation[] {
  if (!text.trim()) return [];
  const found = new Set<string>();
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(text)) != null) {
    const canonical = canonicalRelationFromMention(match[1] ?? "");
    if (canonical) found.add(canonical);
  }
  return [...found] as PersonRelation[];
}

export function extractMentionedRelationsFromMessages(
  messages: Array<{ role: string; content: string }>,
): PersonRelation[] {
  const found = new Set<string>();
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const rel of extractMentionedRelations(m.content)) {
      found.add(rel);
    }
  }
  return [...found] as PersonRelation[];
}

/** Ensure roster rows exist for gift recipients named in recent user turns. */
export async function ensureMentionedPeople(params: {
  userId: string;
  messages: Array<{ role: string; content: string }>;
}): Promise<PersonRow[]> {
  const relations = extractMentionedRelationsFromMessages(params.messages);
  const created: PersonRow[] = [];
  for (const relation of relations) {
    created.push(
      await resolvePerson({
        userId: params.userId,
        relation,
      }),
    );
  }
  return created;
}

/** Guest / localStorage mirror of ensureMentionedPeople. */
export function ensureMentionedPeopleLocal(params: {
  userId: string;
  store: FashionLocalStore;
  messages: Array<{ role: string; content: string }>;
}): PersonRow[] {
  const relations = extractMentionedRelationsFromMessages(params.messages);
  return relations.map((relation) =>
    params.store.resolvePerson({
      userId: params.userId,
      relation,
    }),
  );
}
