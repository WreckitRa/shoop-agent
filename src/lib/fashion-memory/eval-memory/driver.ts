import { randomUUID } from "node:crypto";
import type { ProductCard } from "@/lib/ai-chat/types";
import { prisma } from "@/lib/ai-chat/db";
import { writeInteractionSignal } from "../curation/interaction-signals";
import type { FashionTurnMessage } from "../extraction/message-window";
import { applyClarificationReplyFromMessage } from "../intake/apply-intake-reply";
import {
  ensureMentionedPeople,
  ensureMentionedPeopleLocal,
} from "../people-from-mentions";
import { listPeopleForUser } from "../people";
import { nextRouterAsksFromUnresolved } from "../unresolved";
import { writePurchaseMemory } from "../purchase";
import { writeRequestEventFromBrief } from "../router/assemble-router-context";
import { requestAttributesFromBrief } from "../router/request-event-from-brief";
import type {
  FashionClarificationGap,
  FashionClarificationQuestion,
  FashionSearchBrief,
  MessageFashionRouterMetaV1,
} from "../router/types";
import type { PersonRow } from "../types";
import { runClerk } from "./clerk";
import { dumpAmbiguousForConversation, dumpSession, type Session } from "./dump";
import { casePassed, diffDump, expectedItemCount } from "./match";
import { dumpStateKey } from "./flake";
import { personByLabel, seedRequestEvents, seedSession } from "./seed";
import type {
  CaseResult,
  ClerkTurnTrace,
  MemoryAskQuestion,
  MemoryCase,
  MemoryTurn,
} from "./types";

const DEFAULT_CONV = "main";

function turnConversation(turn: MemoryTurn): string | undefined {
  if ("conversation" in turn && typeof turn.conversation === "string") {
    return turn.conversation;
  }
  return undefined;
}

function isUserTurn(t: MemoryTurn): t is { user: string; conversation?: string } {
  return "user" in t;
}
function isAskTurn(t: MemoryTurn): t is Extract<MemoryTurn, { assistant_ask: unknown }> {
  return "assistant_ask" in t;
}
function isResultsTurn(
  t: MemoryTurn,
): t is Extract<MemoryTurn, { assistant_results: unknown }> {
  return "assistant_results" in t;
}
function isChipTurn(t: MemoryTurn): t is Extract<MemoryTurn, { chip_tap: string }> {
  return "chip_tap" in t;
}
function isRailTurn(t: MemoryTurn): t is Extract<MemoryTurn, { rail: unknown }> {
  return "rail" in t;
}
function isPurchaseTurn(
  t: MemoryTurn,
): t is Extract<MemoryTurn, { purchase: unknown }> {
  return "purchase" in t;
}
function isSweepTurn(t: MemoryTurn): t is { sweep: true; conversation?: string } {
  return "sweep" in t && t.sweep === true;
}

function skipLocalReason(cse: MemoryCase): string | null {
  if (cse.id === "iso-03" || cse.id === "iso-04") {
    return "guest_no_interaction_writes";
  }
  return null;
}

function chipsForGap(gap: string, extra?: string[]): string[] {
  if (extra?.length) return extra;
  if (gap === "size") return ["XS", "S", "M", "L", "XL"];
  if (gap === "depth") return ["You decide", "2 looks", "3 looks", "5"];
  if (gap === "preference_anchor") {
    return ["The usual", "Push me", "Something new"];
  }
  if (gap === "department") return ["Men's", "Women's"];
  return ["Yes", "No"];
}

function asQuestions(
  qs: MemoryAskQuestion[],
): FashionClarificationQuestion[] {
  return qs.map((q) => ({
    text: q.text,
    gap: q.gap as FashionClarificationGap,
    garment_type: q.garment_type,
    field: q.field as FashionClarificationQuestion["field"],
    quick_options: chipsForGap(q.gap, q.chips),
    kind: q.gap === "size" || q.gap === "department" || q.gap === "recipient"
      ? "blocking"
      : "consult",
  }));
}

function productFromAttrs(
  ref: string,
  attrs: Record<string, string>,
): ProductCard {
  return {
    id: ref,
    title: attrs.title ?? ref,
    catalogAttributes: Object.entries(attrs).map(([name, value]) => ({
      name,
      value,
    })),
  };
}

function briefFromResults(params: {
  personId: string;
  garments: string[];
  attributes?: Record<string, string>;
}): FashionSearchBrief {
  const hint = [
    ...params.garments,
    ...Object.values(params.attributes ?? {}),
  ];
  return {
    recipient_person_id: params.personId,
    request_type: "single_item",
    garments: params.garments,
    occasion_context: params.attributes?.occasion ?? "",
    quantity_hint: "",
    must_haves: hint,
    nice_to_haves: [],
    budget_context: { stated: false },
    style_direction: params.attributes?.style ?? "",
  };
}

async function insertMessage(params: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  metadata?: unknown;
}): Promise<FashionTurnMessage> {
  const row = await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      metadata: params.metadata as never,
      status: "completed",
    },
  });
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    metadata: (row.metadata ?? null) as FashionTurnMessage["metadata"],
    createdAt: row.createdAt,
  };
}

async function resolveRecipient(
  session: Session,
  label: string,
): Promise<PersonRow | null> {
  if (!label || label === "self") {
    return personByLabel(session, "self");
  }
  return personByLabel(session, label);
}

export async function runMemoryCase(params: {
  cse: MemoryCase;
  session: Session;
  traceId?: string;
}): Promise<CaseResult> {
  const { cse, session } = params;
  const emptyDiff = {
    missing: [],
    extra: [],
    forbidden: [],
    wrong_person: [],
    status_mismatch: [],
  };

  if (session.kind === "local") {
    const skip = skipLocalReason(cse);
    if (skip) {
      return {
        id: cse.id,
        store: session.kind,
        pass: true,
        skipped: skip,
        diff: emptyDiff,
        clerk: [],
        counts: {
          missing: 0,
          extra: 0,
          forbidden: 0,
          wrong_person: 0,
          expected_items: expectedItemCount(cse),
        },
      };
    }
  }

  await seedSession(session, cse);

  const conversations = new Map<string, string>();
  const messagesByConv = new Map<string, FashionTurnMessage[]>();

  const ensureConv = async (name: string): Promise<string> => {
    const existing = conversations.get(name);
    if (existing) return existing;
    const conv = await prisma.conversation.create({
      data: {
        title: `eval-memory ${cse.id} ${name}`,
        userId: session.userId,
        model: "eval-memory",
      },
    });
    conversations.set(name, conv.id);
    messagesByConv.set(name, []);
    return conv.id;
  };

  const convNames = new Set<string>([DEFAULT_CONV]);
  for (const ev of cse.seed.request_events ?? []) convNames.add(ev.conversation);
  for (const turn of cse.turns) {
    const n = turnConversation(turn);
    if (n) convNames.add(n);
  }
  for (const name of convNames) await ensureConv(name);
  await seedRequestEvents(session, cse, conversations);

  let currentConv = DEFAULT_CONV;
  let stickyRecipient = "self";
  let lastAmbiguous = 0;
  let lastAsks: { gap: string; chips: string[] }[] = [];
  const clerk: ClerkTurnTrace[] = [];

  const switchConv = async (name?: string) => {
    if (!name) return;
    currentConv = name;
    await ensureConv(name);
  };

  const pushMsg = (conv: string, msg: FashionTurnMessage) => {
    const arr = messagesByConv.get(conv) ?? [];
    arr.push(msg);
    messagesByConv.set(conv, arr);
  };

  const extract = async (sweep?: boolean) => {
    const conversationId = conversations.get(currentConv)!;
    const messages = messagesByConv.get(currentConv) ?? [];
    const result = await runClerk({
      session,
      conversationId,
      messages,
      sweep,
      traceId: params.traceId,
    });
    lastAmbiguous = result.ambiguous;
    clerk.push(
      result.skipped
        ? { skipped: result.skipReason, traces: [] }
        : {
            traces: result.traces.map((t) => ({
              op: t.emitted.op,
              accepted: t.result.accepted,
              reason: t.result.reason,
              emitted: t.emitted as unknown as Record<string, unknown>,
            })),
          },
    );
    return result;
  };

  const searchNonce = randomUUID().slice(0, 8);
  const scopedSearchId = (id: string) => `${searchNonce}:${id}`;

  try {
    for (const turn of cse.turns) {
      await switchConv(turnConversation(turn));
      const conversationId = conversations.get(currentConv)!;

      if (isUserTurn(turn)) {
        const msg = await insertMessage({
          conversationId,
          role: "user",
          content: turn.user,
        });
        pushMsg(currentConv, msg);
        const history = (messagesByConv.get(currentConv) ?? []).map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const mentioned =
          session.kind === "local"
            ? await ensureMentionedPeopleLocal({
                userId: session.userId,
                store: session.local!,
                messages: history,
                traceId: params.traceId,
              })
            : await ensureMentionedPeople({
                userId: session.userId,
                messages: history,
                traceId: params.traceId,
              });
        lastAmbiguous = Math.max(lastAmbiguous, mentioned.ambiguous.length);
        if (mentioned.ambiguous.length) {
          const roster =
            session.kind === "local"
              ? session.local!.snapshot.people.filter(
                  (p) => p.user_id === session.userId,
                )
              : await listPeopleForUser(session.userId);
          lastAsks = nextRouterAsksFromUnresolved({
            subjects: mentioned.ambiguous,
            people: roster,
          });
        }
        await extract();
        lastAmbiguous = Math.max(
          lastAmbiguous,
          mentioned.ambiguous.length,
          await dumpAmbiguousForConversation(session, conversationId),
        );
        continue;
      }

      if (isAskTurn(turn)) {
        const recipient =
          turn.assistant_ask.recipient ?? stickyRecipient;
        const person = await resolveRecipient(session, recipient);
        const questions = asQuestions(turn.assistant_ask.questions);
        const meta: MessageFashionRouterMetaV1 = {
          version: 1,
          move: "ask_clarification",
          questions,
          target_person_id: person?.id,
          status: "pending",
          escape_chip: "Just show me",
        };
        const text = questions.map((q) => q.text).join(" ");
        const content = text.includes("?") ? text : `${text}?`;
        const msg = await insertMessage({
          conversationId,
          role: "assistant",
          content,
          metadata: { fashionRouter: meta },
        });
        pushMsg(currentConv, msg);
        continue;
      }

      if (isResultsTurn(turn)) {
        const r = turn.assistant_results;
        stickyRecipient = r.recipient;
        const person = await resolveRecipient(session, r.recipient);
        if (person) {
          const brief = briefFromResults({
            personId: person.id,
            garments: r.garments,
            attributes: r.attributes,
          });
          const attributes = {
            ...requestAttributesFromBrief(brief),
            ...(r.attributes ?? {}),
            search_id: scopedSearchId(r.search_id),
          };
          await writeRequestEventFromBrief({
            userId: session.userId,
            conversationId,
            personId: person.id,
            attributes,
            guestSnapshot: session.local?.snapshot,
          });
        }
        const msg = await insertMessage({
          conversationId,
          role: "assistant",
          content: `Here are some ${r.garments.join(", ") || "finds"}.`,
        });
        pushMsg(currentConv, msg);
        continue;
      }

      if (isChipTurn(turn)) {
        const msg = await insertMessage({
          conversationId,
          role: "user",
          content: turn.chip_tap,
          metadata: { fashionChipTap: true },
        });
        pushMsg(currentConv, msg);
        await applyClarificationReplyFromMessage({
          userId: session.userId,
          conversationId,
          userMessage: turn.chip_tap,
          guestSnapshot: session.local?.snapshot,
        });
        await extract();
        continue;
      }

      if (isRailTurn(turn)) {
        if (session.kind === "local") continue;
        const kind = turn.rail.kind as Parameters<
          typeof writeInteractionSignal
        >[0]["interaction"];
        await writeInteractionSignal({
          userId: session.userId,
          searchId: scopedSearchId(turn.rail.search_id),
          interaction: kind,
          ref: turn.rail.ref,
          product: productFromAttrs(turn.rail.ref, turn.rail.attrs),
          occasionContext: "general",
        });
        continue;
      }

      if (isPurchaseTurn(turn)) {
        await writePurchaseMemory({
          userId: session.userId,
          searchId: scopedSearchId(turn.purchase.search_id),
          ref: turn.purchase.ref,
          product: productFromAttrs(turn.purchase.ref, turn.purchase.attrs),
          guestSnapshot: session.local?.snapshot,
        });
        continue;
      }

      if (isSweepTurn(turn)) {
        await extract(true);
      }
    }

    lastAmbiguous = Math.max(
      lastAmbiguous,
      await dumpAmbiguousForConversation(
        session,
        conversations.get(currentConv)!,
      ),
    );

    const dump = await dumpSession(session);
    dump.ambiguous_subjects = lastAmbiguous;
    dump.next_router_asks = lastAsks;
    const diff = diffDump({ cse, dump });
    const pass = casePassed(diff);
    return {
      id: cse.id,
      store: session.kind,
      pass,
      diff,
      clerk,
      stateKey: dumpStateKey(dump),
      attempts: 1,
      counts: {
        missing: diff.missing.length,
        extra: diff.extra.length,
        forbidden: diff.forbidden.length,
        wrong_person: diff.wrong_person.length,
        expected_items: expectedItemCount(cse),
      },
    };
  } catch (error) {
    return {
      id: cse.id,
      store: session.kind,
      pass: false,
      error: error instanceof Error ? error.message : String(error),
      diff: emptyDiff,
      clerk,
      counts: {
        missing: 0,
        extra: 0,
        forbidden: 0,
        wrong_person: 0,
        expected_items: expectedItemCount(cse),
      },
      attempts: 1,
    };
  }
}
