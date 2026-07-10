import { isFashionMemoryGuestUserId, isSupabaseAuthUserId } from "../auth";
import { listActiveFashionFacts } from "../facts";
import { listPeopleForUser } from "../people";
import { listActiveStyleSignals } from "../signals";
import type { GuestFashionMemorySnapshot } from "../local/store";
import {
  buildPersonShortIdMap,
  formatRouterPersonProfile,
} from "../router/router-context-format";
import type { FashionSearchBrief } from "../router/types";

export async function buildRecipientProfileBlockForPlanner(params: {
  userId: string;
  recipientPersonId: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
}): Promise<string> {
  if (
    isFashionMemoryGuestUserId(params.userId) ||
    !isSupabaseAuthUserId(params.userId)
  ) {
    const snapshot = params.guestSnapshot ?? {
      version: 1 as const,
      people: [],
      fashion_facts: [],
      style_signals: [],
      request_events: [],
      extraction_runs: [],
    };
    const people = snapshot.people.filter((p) => p.user_id === params.userId);
    const person = people.find((p) => p.id === params.recipientPersonId);
    if (!person) return "(no profile recorded yet)";

    const shortIds = buildPersonShortIdMap(people);
    const facts = snapshot.fashion_facts.filter(
      (f) =>
        f.user_id === params.userId &&
        f.person_id === person.id &&
        f.status === "active",
    );
    const signals = snapshot.style_signals.filter(
      (s) =>
        s.user_id === params.userId &&
        s.person_id === person.id &&
        (s.status === "active" || s.status === "candidate"),
    );

    return formatRouterPersonProfile({
      person,
      facts,
      signals,
      shortIds,
    });
  }

  const people = await listPeopleForUser(params.userId);
  const person = people.find((p) => p.id === params.recipientPersonId);
  if (!person) return "(no profile recorded yet)";

  const shortIds = buildPersonShortIdMap(people);
  const [facts, signals] = await Promise.all([
    listActiveFashionFacts({ userId: params.userId, personId: person.id }),
    listActiveStyleSignals({ userId: params.userId, personId: person.id }),
  ]);

  return formatRouterPersonProfile({
    person,
    facts,
    signals,
    shortIds,
  });
}

export function plannerInputFromBrief(params: {
  brief: FashionSearchBrief;
  recipientProfile: string;
  currentDate: string;
}) {
  return {
    brief: params.brief,
    recipientProfile: params.recipientProfile,
    currentDate: params.currentDate,
  };
}
