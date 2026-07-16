/**
 * Blind-guard fixtures — conversation-stated facts must win over DB-only gates.
 *
 * 1. rima_inline_answer_no_reask
 * 2. single_mother_no_confirm
 * 3. dodge_vs_answer
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FashionLocalStore } from "../local/store";
import { applyStatedFacts } from "../intake/apply-stated-facts";
import {
  parseClarificationAnswersFromMessage,
} from "../intake/apply-intake-reply";
import {
  answeredGapsFromStatedFacts,
  checkReaskAfterAnswer,
  filterQuestionsSatisfiedByConversation,
  isGapAnswered,
  suppressDeclinedForAnsweredGaps,
} from "../intake/clarification-dedup";
import {
  buildBlockingClarification,
} from "../intake/identity-gate";
import { singleRelationMatch } from "../extraction/person-identity";
import { buildFashionRouterPrompt } from "../router/prompt";
import type {
  FashionClarificationQuestion,
  FashionSearchBrief,
  FashionStatedFacts,
} from "../router/types";
import type { PersonRow } from "../types";
import type { GuestFashionMemorySnapshot } from "../local/store";

const mother: PersonRow = {
  id: "mom-1",
  user_id: "u1",
  relation: "mother",
  name: "Elena",
  birthday: null,
  notes: null,
  intake_completed_at: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const rimaStated: FashionStatedFacts = {
  person_ref: "rima-1",
  department: "womens",
  sizes: { dresses: "S" },
};

const rimaBriefBase: FashionSearchBrief = {
  recipient_person_id: "rima-1",
  request_type: "single_item",
  garments: ["dress"],
  occasion_context: "everyday casual",
  quantity_hint: "one",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: false },
  style_direction: "Everyday / casual dress for Rima.",
  department_scope: "womens",
  stated_facts: rimaStated,
};

describe("rima_inline_answer_no_reask", () => {
  it("inline echo 'What's Rima's dress size? S' parses as the dress answer", () => {
    const answers = parseClarificationAnswersFromMessage(
      "Everyday / casual. What's Rima's dress size? S",
      [
        {
          text: "What's the occasion?",
          gap: "occasion",
          quick_options: ["Everyday / casual", "Work", "Other"],
        },
        {
          text: "What's Rima's typical dress size?",
          gap: "size",
          garment_type: "dresses",
          field: "size_dresses",
          quick_options: ["XS", "S", "M", "L", "Other"],
        },
      ],
    );
    assert.equal(answers.size_dresses ?? answers.size, "S");
  });

  it("stated_facts dresses:S + empty DB → template emits zero size questions", async () => {
    // Simulate the asymmetry: router absorbed S, DB not yet reflecting it.
    const blocking = buildBlockingClarification({
      brief: rimaBriefBase,
      facts: [],
      targetPersonId: "rima-1",
      personLabel: "Rima",
      person: {
        id: "rima-1",
        user_id: "u1",
        relation: "friend",
        name: "Rima",
        birthday: null,
        notes: null,
        intake_completed_at: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    });
    // Template alone is DB-blind — may still propose dresses.
    const proposed: FashionClarificationQuestion[] = blocking.questions.length
      ? blocking.questions
      : [
          {
            text: "What's Rima's typical dress size?",
            gap: "size",
            garment_type: "dresses",
            field: "size_dresses",
            quick_options: ["XS", "S", "M", "L", "XL", "Other"],
          },
        ];

    const remaining = filterQuestionsSatisfiedByConversation({
      questions: proposed,
      facts: [],
      brief: rimaBriefBase,
      answeredLedger: answeredGapsFromStatedFacts(rimaStated),
    });
    assert.equal(
      remaining.filter((q) => q.gap === "size").length,
      0,
      "conversation dedup must drop the dress-size reask",
    );

    // Tripwire silent when the proposed set is already cleaned (post-dedup).
    assert.equal(
      checkReaskAfterAnswer({
        questions: remaining,
        stated: rimaStated,
      }),
      false,
    );
  });

  it("register stated_facts then gate: zero clarifications (sync order)", async () => {
    const snapshot: GuestFashionMemorySnapshot = {
      version: 1,
      people: [],
      fashion_facts: [],
      style_signals: [],
      request_events: [],
      extraction_runs: [],
    };
    const store = new FashionLocalStore(snapshot);
    store.ensureSelfPerson("guest-u1");
    store.resolvePerson({
      userId: "guest-u1",
      relation: "friend",
      name: "Rima",
    });
    const rima = snapshot.people.find((p) => p.name === "Rima");
    assert.ok(rima);

    const applied = await applyStatedFacts({
      userId: "guest-u1",
      stated: {
        person_ref: rima.id,
        department: "womens",
        sizes: { dresses: "S" },
      },
      evidenceQuote: "Everyday / casual. What's Rima's dress size? S",
      guestSnapshot: snapshot,
      people: snapshot.people,
    });
    assert.ok(applied.factsWritten.length >= 1);

    const facts = snapshot.fashion_facts.filter(
      (f) => f.person_id === rima.id && f.status === "active",
    );
    const blocking = buildBlockingClarification({
      brief: { ...rimaBriefBase, recipient_person_id: rima.id },
      facts,
      targetPersonId: rima.id,
      personLabel: "Rima",
      person: rima,
    });
    assert.equal(blocking.questions.length, 0);
  });

  it("tripwire fires when a blind guard proposes dress size against stated_facts", () => {
    const proposed: FashionClarificationQuestion[] = [
      {
        text: "What's Rima's typical dress size?",
        gap: "size",
        garment_type: "dresses",
        quick_options: ["XS", "S", "M", "Other"],
      },
    ];
    const prev = process.env.FASHION_INVARIANT_HARD_FAIL;
    process.env.FASHION_INVARIANT_HARD_FAIL = "0";
    try {
      assert.equal(
        checkReaskAfterAnswer({
          questions: proposed,
          stated: rimaStated,
        }),
        true,
      );
    } finally {
      if (prev === undefined) delete process.env.FASHION_INVARIANT_HARD_FAIL;
      else process.env.FASHION_INVARIANT_HARD_FAIL = prev;
    }
  });

  it("self person_ref drops recipient reask without aborting the turn", () => {
    const stated: FashionStatedFacts = { person_ref: "self" };
    const proposed: FashionClarificationQuestion[] = [
      {
        text: "Are you shopping for yourself, or for someone else?",
        gap: "recipient",
        quick_options: ["Myself", "Someone else"],
      },
      {
        text: "What looks are you drawn to?",
        gap: "occasion",
        quick_options: ["Tailored", "Relaxed"],
      },
    ];
    const prev = process.env.FASHION_INVARIANT_HARD_FAIL;
    delete process.env.FASHION_INVARIANT_HARD_FAIL;
    try {
      assert.equal(
        checkReaskAfterAnswer({ questions: proposed, stated }),
        true,
        "tripwire must log the recipient reask",
      );
      const remaining = filterQuestionsSatisfiedByConversation({
        questions: proposed,
        facts: [],
        brief: { stated_facts: stated },
      });
      assert.equal(
        remaining.some((q) => q.gap === "recipient"),
        false,
        "recipient question must be filtered out",
      );
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0]!.gap, "occasion");
    } finally {
      if (prev === undefined) delete process.env.FASHION_INVARIANT_HARD_FAIL;
      else process.env.FASHION_INVARIANT_HARD_FAIL = prev;
    }
  });
});

describe("single_mother_no_confirm", () => {
  it("prompt forbids confirmation when exactly one roster match", () => {
    const prompt = buildFashionRouterPrompt({
      roster: "#self self\n#mom1 mother (Elena)",
      profiles: "(none)",
      currentDate: "2026-07-15",
    });
    assert.match(prompt, /exactly ONE roster person matches/i);
    assert.match(prompt, /never ask to confirm/i);
  });

  it("code twin: one mother on roster → singleRelationMatch resolves silently", () => {
    const people: PersonRow[] = [
      {
        id: "self",
        user_id: "u1",
        relation: "self",
        name: null,
        birthday: null,
        notes: null,
        intake_completed_at: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
      mother,
    ];
    const match = singleRelationMatch({
      userText: "dress for my mother",
      people,
    });
    assert.ok(match);
    assert.equal(match!.id, "mom-1");
    assert.equal(match!.relation, "mother");
  });

  it("two mothers → no silent resolve (confirmation still allowed)", () => {
    const people: PersonRow[] = [
      mother,
      { ...mother, id: "mom-2", name: "Sofia" },
    ];
    const match = singleRelationMatch({
      userText: "dress for my mother",
      people,
    });
    assert.equal(match, null);
  });
});

describe("dodge_vs_answer", () => {
  it("inline answer via stated_facts clears the dodge candidate set", () => {
    const questions = [
      { gap: "size" as const, garment_type: "dresses" },
      { gap: "department" as const },
    ];
    const ledger = answeredGapsFromStatedFacts(rimaStated);
    assert.equal(isGapAnswered(ledger, "size", "dresses"), true);
    assert.equal(isGapAnswered(ledger, "department"), true);

    const stillUnanswered = suppressDeclinedForAnsweredGaps(questions, ledger);
    assert.equal(stillUnanswered.length, 0);
  });

  it("genuine unanswered gap remains a dodge candidate", () => {
    const questions = [
      { gap: "size" as const, garment_type: "shoes" },
      { gap: "size" as const, garment_type: "dresses" },
    ];
    const ledger = answeredGapsFromStatedFacts(rimaStated);
    const stillUnanswered = suppressDeclinedForAnsweredGaps(questions, ledger);
    assert.equal(stillUnanswered.length, 1);
    assert.equal(stillUnanswered[0]!.garment_type, "shoes");
  });
});
