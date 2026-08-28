import { logAiChat } from "@/lib/ai-chat/observability";
import { canonicalizeRelation } from "./extraction/relation-aliases";
import type { FashionLocalStore } from "./local/store";
import {
  resolvePeopleFromUserMessage,
  resolvePeopleFromUserMessageLocal,
} from "./detect-people";
import { listPeopleForUser } from "./people";
import type { AmbiguousSubject } from "./extraction/tool-schema";
import type { PersonRelation, PersonRow } from "./types";

/**
 * Canonical relation keys we will create on the roster when the user
 * clearly shops for someone else. Aliases collapse (mom → mother).
 *
 * Friend/colleague are omitted: too ambiguous without a name, and the
 * extractor can still create them via new_person later.
 *
 * Warning-only: never a create path. detect_people owns creation.
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

function lastUserText(
  messages: Array<{ role: string; content: string }>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && m.content.trim()) return m.content;
  }
  return "";
}

function warnRegexOnly(params: {
  userMessage: string;
  rosterRelations: string[];
}): void {
  const regex = extractMentionedRelations(params.userMessage);
  if (regex.length === 0) return;
  const roster = new Set(
    params.rosterRelations.map((r) => canonicalizeRelation(r)),
  );
  const unmatched = regex.filter((rel) => !roster.has(canonicalizeRelation(rel)));
  if (unmatched.length === 0) return;
  logAiChat("warn", "fashion_detect_people_regex_only", {
    regex: unmatched,
    roster: [...roster],
  });
}

/** Ensure roster rows exist for gift recipients named in the latest user turn. */
export async function ensureMentionedPeople(params: {
  userId: string;
  messages: Array<{ role: string; content: string }>;
  traceId?: string | null;
}): Promise<{ created: PersonRow[]; ambiguous: AmbiguousSubject[] }> {
  const userMessage = lastUserText(params.messages);
  if (!userMessage) return { created: [], ambiguous: [] };
  const result = await resolvePeopleFromUserMessage({
    userId: params.userId,
    userMessage,
    traceId: params.traceId,
  });
  const roster = await listPeopleForUser(params.userId);
  warnRegexOnly({
    userMessage,
    rosterRelations: roster.map((p) => p.relation),
  });
  return result;
}

/** Guest / localStorage mirror of ensureMentionedPeople. */
export async function ensureMentionedPeopleLocal(params: {
  userId: string;
  store: FashionLocalStore;
  messages: Array<{ role: string; content: string }>;
  traceId?: string | null;
}): Promise<{ created: PersonRow[]; ambiguous: AmbiguousSubject[] }> {
  const userMessage = lastUserText(params.messages);
  if (!userMessage) return { created: [], ambiguous: [] };
  const result = await resolvePeopleFromUserMessageLocal({
    userId: params.userId,
    store: params.store,
    userMessage,
    traceId: params.traceId,
  });
  warnRegexOnly({
    userMessage,
    rosterRelations: params.store.snapshot.people
      .filter((p) => p.user_id === params.userId)
      .map((p) => p.relation),
  });
  return result;
}
