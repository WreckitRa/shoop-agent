"use client";

import type { ChatMessage } from "@/lib/ai-chat/types";
import { guestUserIdFromSessionId } from "@/lib/auth/guest-session";
import { ensureMentionedPeopleLocal } from "@/lib/fashion-memory/people-from-mentions";
import { buildRouterContextFromData } from "@/lib/fashion-memory/router/router-context-format";
import type { FashionRouterContext } from "@/lib/fashion-memory/router/types";
import { loadGuestFashionStore } from "./guest-bridge";

/** Mirror server assembleRouterContext for guest sessions (memory from localStorage). */
export function assembleGuestRouterContext(params: {
  guestId: string;
  conversationId: string;
  messages: ChatMessage[];
  stickyPersonIds?: string[];
  now?: Date;
}): FashionRouterContext {
  const userId = guestUserIdFromSessionId(params.guestId);
  const store = loadGuestFashionStore(params.guestId);
  store.ensureSelfPerson(userId);

  const convMessages = params.messages
    .filter((m) => m.conversationId === params.conversationId)
    .slice(-12);

  ensureMentionedPeopleLocal({
    userId,
    store,
    messages: convMessages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    })),
  });

  const people = store.snapshot.people.filter((p) => p.user_id === userId);

  const lastEventPersonId = store.snapshot.request_events
    .filter(
      (e) =>
        e.user_id === userId && e.conversation_id === params.conversationId,
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.person_id;

  const stickyPersonIds =
    params.stickyPersonIds ??
    (lastEventPersonId ? [lastEventPersonId] : []);

  const factsByPersonId = new Map<
    string,
    import("@/lib/fashion-memory/types").FashionFactRow[]
  >();
  const signalsByPersonId = new Map<
    string,
    import("@/lib/fashion-memory/types").StyleSignalRow[]
  >();

  for (const person of people) {
    factsByPersonId.set(
      person.id,
      store.snapshot.fashion_facts.filter(
        (f) =>
          f.user_id === userId &&
          f.person_id === person.id &&
          f.status === "active",
      ),
    );
    signalsByPersonId.set(
      person.id,
      store.snapshot.style_signals.filter(
        (s) =>
          s.user_id === userId &&
          s.person_id === person.id &&
          (s.status === "active" || s.status === "candidate"),
      ),
    );
  }

  return buildRouterContextFromData({
    people,
    factsByPersonId,
    signalsByPersonId,
    conversationMessages: convMessages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    })),
    stickyPersonIds,
    now: params.now,
  });
}
