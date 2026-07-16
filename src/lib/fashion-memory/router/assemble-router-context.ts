import { logAiChat } from "@/lib/ai-chat/observability";
import { isFashionMemoryGuestUserId, isSupabaseAuthUserId } from "../auth";
import { safeTrim } from "../safe-trim";
import { listActiveFashionFacts } from "../facts";
import { ensureSelfPerson, listPeopleForUser } from "../people";
import {
  ensureMentionedPeople,
  ensureMentionedPeopleLocal,
} from "../people-from-mentions";
import { logRequestEvent } from "../signals";
import type { GuestFashionMemorySnapshot } from "../local/store";
import { FashionLocalStore } from "../local/store";
import type { FashionFactRow, PersonRow, RequestEventRow, StyleSignalRow } from "../types";
import { loadRecentFashionMessages } from "../extraction/message-window";
import { fashionMemoryDb } from "../db";
import { loadIntakeProfileHints } from "../intake/account-profile-bridge";
import { buildRouterContextFromData, buildPersonShortIdMap } from "./router-context-format";
import { dedupeConsecutiveUserMessages } from "../observability/message-dedupe";
import type { FashionRouterContext } from "./types";

const MESSAGE_WINDOW_LIMIT = 12;

async function resolveStickyRecipientPersonIds(params: {
  userId: string;
  conversationId: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): Promise<string[]> {
  const { prisma } = await import("@/lib/ai-chat/db");
  const recentAssistant = await prisma.message.findMany({
    where: { conversationId: params.conversationId, role: "assistant" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 24,
    select: { metadata: true },
  });

  for (const row of recentAssistant) {
    const meta = row.metadata as {
      fashionRouter?: { brief?: { recipient_person_id?: string } };
    } | null;
    const recipient = meta?.fashionRouter?.brief?.recipient_person_id?.trim();
    if (recipient) return [recipient];
  }

  if (params.guestSnapshot) {
    const events = params.guestSnapshot.request_events
      .filter(
        (e) =>
          e.user_id === params.userId &&
          e.conversation_id === params.conversationId,
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (events[0]?.person_id) return [events[0].person_id];
    return [];
  }

  if (!isSupabaseAuthUserId(params.userId)) return [];

  const db = fashionMemoryDb();
  const row = await db
    .from("request_events")
    .select("person_id")
    .eq("user_id", params.userId)
    .eq("conversation_id", params.conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (row.error) throw new Error(row.error.message);
  const personId = (row.data as { person_id?: string } | null)?.person_id;
  return personId ? [personId] : [];
}

function loadGuestMemory(params: {
  userId: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): {
  people: PersonRow[];
  factsByPersonId: Map<string, FashionFactRow[]>;
  signalsByPersonId: Map<string, StyleSignalRow[]>;
} {
  const snapshot = params.guestSnapshot ?? {
    version: 1 as const,
    people: [],
    fashion_facts: [],
    style_signals: [],
    request_events: [],
    extraction_runs: [],
  };

  const people = snapshot.people.filter((p) => p.user_id === params.userId);
  const factsByPersonId = new Map<string, FashionFactRow[]>();
  const signalsByPersonId = new Map<string, StyleSignalRow[]>();

  for (const person of people) {
    factsByPersonId.set(
      person.id,
      snapshot.fashion_facts.filter(
        (f) => f.user_id === params.userId && f.person_id === person.id && f.status === "active",
      ),
    );
    signalsByPersonId.set(
      person.id,
      snapshot.style_signals.filter(
        (s) =>
          s.user_id === params.userId &&
          s.person_id === person.id &&
          (s.status === "active" || s.status === "candidate"),
      ),
    );
  }

  return { people, factsByPersonId, signalsByPersonId };
}

async function loadAuthMemory(params: { userId: string }): Promise<{
  people: PersonRow[];
  factsByPersonId: Map<string, FashionFactRow[]>;
  signalsByPersonId: Map<string, StyleSignalRow[]>;
}> {
  const people = await listPeopleForUser(params.userId);
  const factsByPersonId = new Map<string, FashionFactRow[]>();
  const signalsByPersonId = new Map<string, StyleSignalRow[]>();

  await Promise.all(
    people.map(async (person) => {
      const [facts, signals] = await Promise.all([
        listActiveFashionFacts({ userId: params.userId, personId: person.id }),
        import("../signals").then((m) =>
          m.listActiveStyleSignals({ userId: params.userId, personId: person.id }),
        ),
      ]);
      factsByPersonId.set(person.id, facts);
      signalsByPersonId.set(person.id, signals);
    }),
  );

  return { people, factsByPersonId, signalsByPersonId };
}

/** Resolve sticky short ids to full UUIDs where possible. */
function normalizeStickyPersonIds(
  stickyIds: string[],
  people: PersonRow[],
  personShortIds: Record<string, string>,
): string[] {
  const uuidByShort = new Map(
    Object.entries(personShortIds).map(([short, id]) => [short, id]),
  );
  const peopleIds = new Set(people.map((p) => p.id));

  return stickyIds
    .map((ref) => {
      const trimmed = safeTrim(ref).replace(/^#/, "");
      if (peopleIds.has(trimmed)) return trimmed;
      const fromShort = uuidByShort.get(trimmed.toLowerCase());
      if (fromShort) return fromShort;
      return ref;
    })
    .filter(Boolean);
}

export async function assembleRouterContext(params: {
  conversationId: string;
  userId: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
  now?: Date;
}): Promise<FashionRouterContext> {
  const isAuth = isSupabaseAuthUserId(params.userId);

  // Self must exist before the first router call — otherwise ROSTER/PROFILES
  // are empty and the model invents recipient clarifications.
  if (isAuth) {
    await ensureSelfPerson(params.userId);
    // Backfill fashion facts/signals from completed onboarding (idempotent).
    // Await so the first search turn already has sizes/gender/taste in memory.
    try {
      const { prisma } = await import("@/lib/ai-chat/db");
      const profile = await prisma.userProfile.findUnique({
        where: { userId: params.userId },
        select: { onboardingCompleted: true },
      });
      if (profile?.onboardingCompleted) {
        const { seedOnboardingIntoFashionMemory } = await import(
          "@/lib/onboarding/seed-fashion-memory"
        );
        await seedOnboardingIntoFashionMemory(params.userId);
      }
    } catch {
      /* non-blocking — router must still run */
    }
  }

  const [recentMessages, stickyRaw, accountHints] = await Promise.all([
    loadRecentFashionMessages({
      conversationId: params.conversationId,
      limit: MESSAGE_WINDOW_LIMIT,
    }),
    resolveStickyRecipientPersonIds({
      userId: params.userId,
      conversationId: params.conversationId,
      guestSnapshot: params.guestSnapshot,
    }),
    isAuth ? loadIntakeProfileHints(params.userId) : Promise.resolve(null),
  ]);

  const conversationForMentions = recentMessages.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  // Gift recipients must exist on the roster BEFORE the router runs —
  // otherwise recipient_person_id / intake target fall back to self and
  // sizes for "my mother" land on the shopper.
  if (isAuth) {
    await ensureMentionedPeople({
      userId: params.userId,
      messages: conversationForMentions,
    });
  } else if (params.guestSnapshot) {
    ensureMentionedPeopleLocal({
      userId: params.userId,
      store: new FashionLocalStore(params.guestSnapshot),
      messages: conversationForMentions,
    });
  }

  const memory =
    isFashionMemoryGuestUserId(params.userId) || !isAuth
      ? loadGuestMemory({
          userId: params.userId,
          guestSnapshot: params.guestSnapshot,
        })
      : await loadAuthMemory({ userId: params.userId });

  const personShortIds = buildPersonShortIdMap(memory.people);

  const stickyPersonIds = normalizeStickyPersonIds(
    stickyRaw,
    memory.people,
    personShortIds,
  );

  const context = buildRouterContextFromData({
    people: memory.people,
    factsByPersonId: memory.factsByPersonId,
    signalsByPersonId: memory.signalsByPersonId,
    conversationMessages: dedupeConsecutiveUserMessages(
      recentMessages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
    ),
    stickyPersonIds,
    now: params.now,
    accountHints: accountHints
      ? {
          genderPresentation:
            accountHints.genderPresentation === "mens" ||
            accountHints.genderPresentation === "womens"
              ? accountHints.genderPresentation
              : accountHints.genderPresentation
                ? "mixed"
                : null,
          preferredName: accountHints.preferredName,
          sizeLines: accountHints.sizeLines,
        }
      : null,
  });

  logAiChat("info", "fashion_assemble_router_context", {
    conversationId: params.conversationId,
    userId: params.userId,
    people_count: memory.people.length,
    people: memory.people.map((p) => ({
      id: p.id,
      relation: p.relation,
      name: p.name,
      intake_completed_at: p.intake_completed_at,
    })),
    sticky_raw: stickyRaw,
    sticky_person_ids: stickyPersonIds,
    account_hints: accountHints
      ? {
          genderPresentation: accountHints.genderPresentation,
          preferredName: accountHints.preferredName,
          sizeBuckets: [...accountHints.sizeBuckets],
          sizeLines: accountHints.sizeLines,
        }
      : null,
    roster: context.roster,
    profiles: context.profiles,
    currentDate: context.currentDate,
    personShortIds: context.personShortIds,
    conversationMessages: context.conversationMessages,
  });

  return context;
}

export async function writeRequestEventFromBrief(params: {
  userId: string;
  conversationId: string;
  personId: string;
  attributes: import("../types").RequestEventAttributes;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): Promise<RequestEventRow | null> {
  if (isSupabaseAuthUserId(params.userId)) {
    return logRequestEvent({
      userId: params.userId,
      personId: params.personId,
      conversationId: params.conversationId,
      attributes: params.attributes,
    });
  }

  if (params.guestSnapshot) {
    const store = new FashionLocalStore(params.guestSnapshot);
    return store.logRequestEvent({
      userId: params.userId,
      personId: params.personId,
      conversationId: params.conversationId,
      attributes: params.attributes,
    });
  }

  return null;
}
