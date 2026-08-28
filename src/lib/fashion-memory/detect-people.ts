import { z } from "zod";
import { logAiChat } from "@/lib/ai-chat/observability";
import { AI_CHAT_LIGHTWEIGHT_MODEL } from "@/lib/ai-chat/constants";
import { upsertFashionFact } from "./facts";
import { createPerson, listPeopleForUser, updatePersonName } from "./people";
import { tracedLLMCall } from "./observability/traced-llm-call";
import {
  buildPersonShortIdMap,
  formatRosterLine,
} from "./extraction/context-format";
import {
  departmentForProposedPerson,
  resolveProposedPerson,
  type MatchExistingProposal,
} from "./resolve-person";
import { CANONICAL_PERSON_RELATIONS } from "./extraction/relation-aliases";
import { ambiguousNameMatches } from "./extraction/person-identity";
import type { FashionLocalStore } from "./local/store";
import type { AmbiguousSubject } from "./extraction/tool-schema";
import type {
  FashionFactGenderPresentationValue,
  PersonRelation,
  PersonRow,
} from "./types";

export const DETECT_PEOPLE_TOOL_NAME = "detect_people";

const detectedPersonSchema = z.object({
  mention_text: z.string().min(1).max(200),
  relation: z.string().max(80).nullable().optional(),
  name: z.string().max(120).nullable().optional(),
  department_hint: z.string().max(40).nullable().optional(),
  age_hint: z.union([z.number(), z.string()]).nullable().optional(),
  is_recipient: z.boolean().optional(),
  match_existing: z
    .object({
      person_ref: z.string().min(1).max(80).optional(),
      person_id: z.string().min(1).max(80).optional(),
      confidence: z.number().min(0).max(1),
      why: z.string().max(500).optional(),
    })
    .nullable()
    .optional(),
});

const detectPeopleResultSchema = z.object({
  people: z.array(detectedPersonSchema).max(8).default([]),
});

export type DetectedPerson = z.infer<typeof detectedPersonSchema>;

const DETECT_PEOPLE_TOOL = {
  name: DETECT_PEOPLE_TOOL_NAME,
  description:
    "People mentioned in this user message who should exist on the shopping roster.",
  input_schema: {
    type: "object" as const,
    properties: {
      people: {
        type: "array",
        items: {
          type: "object",
          properties: {
            mention_text: { type: "string" },
            relation: {
              type: ["string", "null"],
              enum: [...CANONICAL_PERSON_RELATIONS],
            },
            name: { type: ["string", "null"] },
            department_hint: { type: ["string", "null"] },
            age_hint: { type: ["integer", "null"] },
            is_recipient: { type: "boolean" },
            match_existing: {
              type: ["object", "null"],
              properties: {
                person_ref: { type: "string" },
                person_id: { type: "string" },
                confidence: { type: "number" },
                why: { type: "string" },
              },
              required: ["confidence"],
            },
          },
          required: ["mention_text"],
        },
      },
    },
    required: ["people"],
  },
};

const DETECT_PROMPT = `You list people the shopper is shopping for, or making a claim about, in ONE user message.

ROSTER is the known people (short id after #). Emit canonical English relations: mother, father, sister, brother, son, daughter, wife, husband, nephew, niece, friend, colleague, grandmother, grandfather, aunt, uncle, girlfriend, boyfriend. Aliases (mom, mama, mum, ma, ماما, père, mère) map to those keys.

Rules:
- Mentioned ≠ recipient. "for my sister's 8 year old" → the child is the recipient (nephew if he/boy, niece if she/girl). Do not emit the sister as a person to create. is_recipient false for anyone only mentioned as context.
- "sister's child" / "sister's 8 year old" → relation nephew or niece, never the literal phrase, never a new "sister" unless she is the one being shopped for.
- Distinct relations are distinct people. brother Gabriel is not son Gabriel. Never match_existing across relations.
- Typos/nicknames of the SAME relation: set match_existing { person_ref: short id without #, confidence, why }. High (≥0.85) only when you are sure (Andro→Andrew). Andrea vs Andrew is not sure — low confidence. Sami vs Sam: not sure.
- Two roster people share a name and the message does not pin a relation → emit that name with no match_existing (code will ask).
- Unique family slots (mother, father, …): match the existing slot; do not create a second mother.
- Kids: department_hint boys/girls/baby and age_hint when the message states age or "year old". An 8-year-old boy is boys, not mens.
- Self is already on the roster. Do not emit self unless you are matching an existing self row.
- If nobody new or no third person, people is [].`;

function parseAgeHint(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 120) return null;
  return Math.round(n);
}

function matchFromDetected(
  detected: DetectedPerson,
): MatchExistingProposal | null {
  const m = detected.match_existing;
  if (!m) return null;
  const personRef = (m.person_ref ?? m.person_id ?? "").trim();
  if (!personRef) return null;
  return { personRef, confidence: m.confidence, why: m.why };
}

export async function detectPeopleInMessage(params: {
  userMessage: string;
  people: PersonRow[];
  traceId?: string | null;
  signal?: AbortSignal;
}): Promise<DetectedPerson[]> {
  const text = params.userMessage.trim();
  if (!text) return [];

  const shortIds = buildPersonShortIdMap(params.people);
  const roster = params.people
    .map((p) => formatRosterLine(p, shortIds))
    .join("\n");

  try {
    const response = await tracedLLMCall({
      traceId: params.traceId,
      stage: "detect_people",
      model: AI_CHAT_LIGHTWEIGHT_MODEL,
      maxTokens: 1024,
      temperature: 0,
      systemPrompt: DETECT_PROMPT,
      systemCachedPrefix: DETECT_PROMPT,
      systemUncachedSuffix: `ROSTER:\n${roster || "(empty)"}`,
      inputMessages: [{ role: "user", content: text }],
      tools: [DETECT_PEOPLE_TOOL],
      toolChoice: { type: "tool", name: DETECT_PEOPLE_TOOL_NAME },
      signal: params.signal,
    });

    const toolBlock = response.content.find(
      (block) =>
        block.type === "tool_use" && block.name === DETECT_PEOPLE_TOOL_NAME,
    );
    if (!toolBlock || toolBlock.type !== "tool_use") return [];

    const parsed = detectPeopleResultSchema.safeParse(toolBlock.input);
    if (!parsed.success) {
      logAiChat("warn", "fashion_detect_people_schema", {
        issues: parsed.error.issues.map((i) => i.message),
      });
      return [];
    }
    return parsed.data.people;
  } catch (error) {
    logAiChat("warn", "fashion_detect_people_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

type PeopleMutator = {
  createPerson: (params: {
    userId: string;
    relation: PersonRelation;
    name: string | null;
  }) => Promise<PersonRow> | PersonRow;
  updatePersonName: (params: {
    userId: string;
    personId: string;
    name: string;
  }) => Promise<PersonRow | null> | PersonRow | null;
  upsertGenderPresentation: (params: {
    userId: string;
    personId: string;
    presentation: FashionFactGenderPresentationValue["presentation"];
    sourceQuote: string;
  }) => Promise<void> | void;
};

async function applyDetections(params: {
  userId: string;
  userMessage: string;
  people: PersonRow[];
  detections: DetectedPerson[];
  mutator: PeopleMutator;
}): Promise<{ created: PersonRow[]; ambiguous: AmbiguousSubject[] }> {
  const created: PersonRow[] = [];
  const ambiguous: AmbiguousSubject[] = [];
  let roster = params.people;
  const shortIds0 = buildPersonShortIdMap(roster);
  const collision = ambiguousNameMatches({
    userText: params.userMessage,
    people: roster,
  });
  if (collision && collision.length >= 2) {
    ambiguous.push({
      description: collision[0]!.name?.trim() || "name",
      candidate_person_refs: collision.map((p) => {
        return (
          Object.entries(shortIds0).find(([, id]) => id === p.id)?.[0] ?? p.id
        );
      }),
      evidence_quote: params.userMessage.slice(0, 2000),
    });
  }

  for (const detected of params.detections) {
    if (collision && collision.length >= 2) {
      const detectedName = (detected.name ?? "").trim().toLowerCase();
      const collides = collision.some(
        (p) => (p.name ?? "").trim().toLowerCase() === detectedName,
      );
      if (collides || !detectedName) continue;
    }
    const shortIds = buildPersonShortIdMap(roster);
    const ageHint = parseAgeHint(detected.age_hint);
    const decision = resolveProposedPerson({
      people: roster,
      personShortIds: shortIds,
      mentionText: detected.mention_text,
      relation: detected.relation,
      name: detected.name,
      isRecipient: detected.is_recipient,
      departmentHint: detected.department_hint,
      matchExisting: matchFromDetected(detected),
    });

    if (decision.action === "skip") continue;

    if (decision.action === "ambiguous") {
      const refs = decision.candidates.map((p) => {
        const short =
          Object.entries(shortIds).find(([, id]) => id === p.id)?.[0] ?? p.id;
        return short;
      });
      ambiguous.push({
        description: decision.mention,
        candidate_person_refs: refs.length ? refs : ["unresolved"],
        evidence_quote: detected.mention_text.slice(0, 2000),
      });
      continue;
    }

    let person: PersonRow;
    if (decision.action === "merge") {
      person = decision.person;
      if (decision.attachName) {
        const updated = await params.mutator.updatePersonName({
          userId: params.userId,
          personId: person.id,
          name: decision.attachName,
        });
        if (updated) {
          person = updated;
          roster = roster.map((p) => (p.id === person.id ? person : p));
        }
      }
    } else {
      person = await params.mutator.createPerson({
        userId: params.userId,
        relation: decision.relation as PersonRelation,
        name: decision.name,
      });
      created.push(person);
      roster = [...roster, person];
      const dept = departmentForProposedPerson({
        relation: decision.relation,
        departmentHint: detected.department_hint,
        ageHint,
      });
      if (dept) {
        await params.mutator.upsertGenderPresentation({
          userId: params.userId,
          personId: person.id,
          presentation: dept,
          sourceQuote: detected.mention_text.slice(0, 2000),
        });
      }
    }
  }

  return { created, ambiguous };
}

export async function resolvePeopleFromUserMessage(params: {
  userId: string;
  userMessage: string;
  traceId?: string | null;
  signal?: AbortSignal;
}): Promise<{ created: PersonRow[]; ambiguous: AmbiguousSubject[] }> {
  const people = await listPeopleForUser(params.userId);
  const detections = await detectPeopleInMessage({
    userMessage: params.userMessage,
    people,
    traceId: params.traceId,
    signal: params.signal,
  });
  return applyDetections({
    userId: params.userId,
    userMessage: params.userMessage,
    people,
    detections,
    mutator: {
      createPerson,
      updatePersonName,
      upsertGenderPresentation: async (p) => {
        await upsertFashionFact({
          userId: p.userId,
          personId: p.personId,
          factType: "gender_presentation",
          value: { presentation: p.presentation },
          sourceQuote: p.sourceQuote,
        });
      },
    },
  });
}

export async function resolvePeopleFromUserMessageLocal(params: {
  userId: string;
  userMessage: string;
  store: FashionLocalStore;
  traceId?: string | null;
  signal?: AbortSignal;
}): Promise<{ created: PersonRow[]; ambiguous: AmbiguousSubject[] }> {
  const people = params.store.snapshot.people.filter(
    (p) => p.user_id === params.userId,
  );
  const detections = await detectPeopleInMessage({
    userMessage: params.userMessage,
    people,
    traceId: params.traceId,
    signal: params.signal,
  });
  const store = params.store;
  return applyDetections({
    userId: params.userId,
    userMessage: params.userMessage,
    people,
    detections,
    mutator: {
      createPerson: (p) => store.createPerson(p),
      updatePersonName: (p) => store.updatePersonName(p),
      upsertGenderPresentation: (p) => {
        store.upsertFashionFact({
          userId: p.userId,
          personId: p.personId,
          factType: "gender_presentation",
          value: { presentation: p.presentation },
          sourceQuote: p.sourceQuote,
        });
      },
    },
  });
}

/** Test seam: apply detections without an LLM call. */
export async function applyDetectedPeopleForTest(params: {
  userId: string;
  userMessage: string;
  people: PersonRow[];
  detections: DetectedPerson[];
  mutator: PeopleMutator;
}): Promise<{ created: PersonRow[]; ambiguous: AmbiguousSubject[] }> {
  return applyDetections(params);
}
