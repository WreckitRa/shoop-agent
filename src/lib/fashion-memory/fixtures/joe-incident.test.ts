/**
 * Joe Incident fixtures — conversation-stated facts must count immediately.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FashionLocalStore } from "../local/store";
import { applyStatedFacts } from "../intake/apply-stated-facts";
import {
  buildBlockingClarification,
  missingSizeBucketsForGarments,
} from "../intake/identity-gate";
import {
  sanitizeClarificationQuestions,
  META_QUESTION_RE,
} from "../intake/clarification-sanitize";
import { buildFashionRouterPrompt } from "../router/prompt";
import { parseFashionRouterToolInput } from "../router/tool-schema";
import type { FashionSearchBrief, FashionStatedFacts } from "../router/types";
import { buildKnowledgeState } from "../intake/knowledge-state";

/** Re-export gap check using the same helpers the gate uses. */
function gapsFor(params: {
  brief: FashionSearchBrief;
  facts: import("../types").FashionFactRow[];
  person?: import("../types").PersonRow | null;
}) {
  const department =
    params.brief.department_scope ??
    params.facts.find((f) => f.fact_type === "gender_presentation")?.value;
  const presentation =
    typeof department === "object" && department && "presentation" in department
      ? (department as { presentation: string }).presentation
      : params.brief.department_scope;
  const missingDept = !params.brief.department_scope && !presentation;
  const missingSizes = missingSizeBucketsForGarments(
    params.facts,
    params.brief.garments,
    null,
    params.brief.department_scope ?? (presentation as string | undefined),
  );
  return {
    needs_clarification: missingDept || missingSizes.length > 0,
    missing_department: missingDept,
    missing_size_buckets: missingSizes,
  };
}

const JOE_MESSAGE =
  "full formal outfit for Joe, under $100, Men's, M tops, 33 bottoms, shoes 10, business event";

const joeStatedFacts: FashionStatedFacts = {
  person_ref: "new",
  new_person: { name: "Joe", relation: "friend" },
  department: "mens",
  sizes: { tops: "M", bottoms: "33", shoes: "10" },
  budget: { max: 100, currency: "USD" },
};

const joeCompleteBrief: FashionSearchBrief = {
  recipient_person_id: "new",
  request_type: "outfit",
  garments: ["shirt", "trousers", "shoes"],
  occasion_context: "business event",
  quantity_hint: "one outfit",
  must_haves: [],
  nice_to_haves: [],
  budget_context: { stated: true, max: 100, currency: "USD" },
  style_direction: "Full formal outfit for Joe under $100 for a business event.",
  department_scope: "mens",
  stated_facts: joeStatedFacts,
};

describe("joe_complete_first_message", () => {
  it("stated_facts registers Joe + sizes sync; gate needs zero clarifications", async () => {
    const snapshot = {
      version: 1 as const,
      people: [],
      fashion_facts: [],
      style_signals: [],
      request_events: [],
      extraction_runs: [],
    };
    const store = new FashionLocalStore(snapshot);
    store.ensureSelfPerson("guest-u1");

    const applied = await applyStatedFacts({
      userId: "guest-u1",
      stated: joeStatedFacts,
      evidenceQuote: JOE_MESSAGE,
      guestSnapshot: snapshot,
    });

    assert.ok(applied.personId);
    assert.equal(applied.person?.name, "Joe");
    assert.ok(applied.factsWritten.length >= 4);

    const facts = snapshot.fashion_facts.filter(
      (f) => f.person_id === applied.personId && f.status === "active",
    );
    const gap = gapsFor({
      brief: { ...joeCompleteBrief, recipient_person_id: applied.personId! },
      facts,
      person: applied.person,
    });
    assert.equal(gap.needs_clarification, false);
    assert.deepEqual(gap.missing_size_buckets, []);

    const state = buildKnowledgeState({
      brief: { ...joeCompleteBrief, recipient_person_id: applied.personId! },
      facts,
      person: applied.person!,
      sizesUnconfirmed: [],
    });
    assert.equal(state.department, "mens");
    assert.ok(state.sizes_confirmed.includes("shirt"));
    assert.ok(state.sizes_confirmed.includes("trousers"));
    assert.ok(state.sizes_confirmed.includes("shoes"));

    const parsed = parseFashionRouterToolInput("ready_to_search", {
      brief: joeCompleteBrief,
    });
    assert.equal(parsed?.move, "ready_to_search");
    if (parsed?.move === "ready_to_search") {
      assert.equal(parsed.brief.stated_facts?.new_person?.name, "Joe");
      assert.equal(parsed.brief.stated_facts?.sizes?.tops, "M");
      assert.equal(parsed.brief.stated_facts?.sizes?.bottoms, "33");
      assert.equal(parsed.brief.stated_facts?.sizes?.shoes, "10");
      assert.equal(parsed.brief.stated_facts?.budget?.max, 100);
    }
  });

  it("router prompt requires stated_facts fast lane", () => {
    const prompt = buildFashionRouterPrompt({
      roster: "#self self",
      profiles: "(none)",
      currentDate: "2026-07-10",
    });
    assert.match(prompt, /STATED FACTS ARE KNOWLEDGE, IMMEDIATELY/);
    assert.match(prompt, /stated_facts/);
    assert.match(prompt, /full formal outfit for Joe/);
  });
});

describe("no_meta_questions", () => {
  it("strips roster/machinery questions and logs via sanitize", () => {
    const cleaned = sanitizeClarificationQuestions({
      questions: [
        {
          text: "Is Joe already in my roster?",
          gap: "recipient",
          quick_options: ["Yes", "No", "Other"],
        },
        {
          text: "What's Joe's shoe size?",
          gap: "size",
          garment_type: "shoes",
          quick_options: ["9", "10", "11", "Other"],
        },
        {
          text: "Should I set him up in your profiles?",
          gap: "person_name",
          quick_options: ["Yes", "No", "Other"],
        },
      ],
    });
    assert.equal(cleaned.length, 1);
    assert.match(cleaned[0]!.text, /shoe size/i);
    assert.equal(META_QUESTION_RE.test("Is Joe already in my roster?"), true);
  });

  it("prompt bans machinery vocabulary", () => {
    const prompt = buildFashionRouterPrompt({
      roster: "#self self",
      profiles: "(none)",
      currentDate: "2026-07-10",
    });
    assert.match(prompt, /Internal machinery/);
    assert.match(prompt, /never about the system's bookkeeping/i);
  });
});

describe("no_dress_for_mens_outfit", () => {
  it("deterministic template asks only shoes when tops+bottoms known for mens", () => {
    const facts = [
      {
        id: "f1",
        user_id: "u1",
        person_id: "joe",
        fact_type: "gender_presentation" as const,
        garment_type: null,
        value: { presentation: "mens" as const },
        source_quote: null,
        status: "active" as const,
        superseded_by: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
      {
        id: "f2",
        user_id: "u1",
        person_id: "joe",
        fact_type: "size" as const,
        garment_type: "tops",
        value: { system: "alpha" as const, value: "M" },
        source_quote: null,
        status: "active" as const,
        superseded_by: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
      {
        id: "f3",
        user_id: "u1",
        person_id: "joe",
        fact_type: "size" as const,
        garment_type: "bottoms",
        value: { system: "us" as const, value: 33 },
        source_quote: null,
        status: "active" as const,
        superseded_by: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ];
    const blocking = buildBlockingClarification({
      brief: {
        ...joeCompleteBrief,
        recipient_person_id: "joe",
        stated_facts: undefined,
      },
      facts,
      targetPersonId: "joe",
      personLabel: "Joe",
      person: {
        id: "joe",
        user_id: "u1",
        relation: "friend",
        name: "Joe",
        birthday: null,
        notes: null,
        intake_completed_at: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    });
    assert.equal(blocking.questions.length, 1);
    assert.equal(blocking.questions[0]?.garment_type, "shoes");
    assert.equal(
      blocking.questions.every((q) => q.garment_type !== "dresses"),
      true,
    );
    assert.equal(
      blocking.questions.every((q) => !/dress/i.test(q.text)),
      true,
    );
  });
});

describe("partial_first_message", () => {
  it("stated_facts carries M; template asks only department+bottoms+shoes", async () => {
    const snapshot = {
      version: 1 as const,
      people: [],
      fashion_facts: [],
      style_signals: [],
      request_events: [],
      extraction_runs: [],
    };
    const store = new FashionLocalStore(snapshot);
    store.ensureSelfPerson("guest-u1");

    const stated: FashionStatedFacts = {
      person_ref: "new",
      new_person: { name: "Joe", relation: "friend" },
      sizes: { tops: "M" },
    };
    const applied = await applyStatedFacts({
      userId: "guest-u1",
      stated,
      evidenceQuote: "outfit for Joe, business event, he's an M top",
      guestSnapshot: snapshot,
    });
    assert.ok(applied.personId);

    const brief: FashionSearchBrief = {
      recipient_person_id: applied.personId!,
      request_type: "outfit",
      garments: ["shirt", "trousers", "shoes"],
      occasion_context: "business event",
      quantity_hint: "one outfit",
      must_haves: [],
      nice_to_haves: [],
      budget_context: { stated: false },
      style_direction: "Outfit for Joe, business event.",
      stated_facts: stated,
    };
    const facts = snapshot.fashion_facts.filter(
      (f) => f.person_id === applied.personId && f.status === "active",
    );
    const blocking = buildBlockingClarification({
      brief,
      facts,
      targetPersonId: applied.personId!,
      personLabel: "Joe",
      person: applied.person,
    });
    const gaps = blocking.questions.map((q) =>
      q.gap === "size" ? `size:${q.garment_type}` : q.gap,
    );
    assert.ok(gaps.includes("department"));
    assert.ok(gaps.includes("size:bottoms"));
    assert.ok(gaps.includes("size:shoes"));
    assert.equal(gaps.includes("size:tops"), false);
    assert.equal(blocking.questions.every((q) => q.gap !== "occasion"), true);
    assert.equal(blocking.questions.every((q) => q.gap !== "garment"), true);
  });
});

describe("latest_size_wins", () => {
  it("contradicted sizes keep latest and record contradiction", async () => {
    const snapshot = {
      version: 1 as const,
      people: [],
      fashion_facts: [],
      style_signals: [],
      request_events: [],
      extraction_runs: [],
    };
    const store = new FashionLocalStore(snapshot);
    store.ensureSelfPerson("guest-u1");

    const first = await applyStatedFacts({
      userId: "guest-u1",
      stated: {
        person_ref: "new",
        new_person: { name: "Joe" },
        sizes: { shoes: "10", bottoms: "33" },
      },
      evidenceQuote: "shoes 10, waist 33",
      guestSnapshot: snapshot,
    });
    assert.ok(first.personId);

    const second = await applyStatedFacts({
      userId: "guest-u1",
      stated: {
        person_ref: first.personId!,
        sizes: { shoes: "11", bottoms: "32" },
      },
      evidenceQuote: "actually shoes 11 and waist 32",
      guestSnapshot: snapshot,
      people: snapshot.people,
    });

    assert.ok(second.contradictions.length >= 2);
    const shoes = snapshot.fashion_facts.find(
      (f) =>
        f.person_id === first.personId &&
        f.fact_type === "size" &&
        f.garment_type === "shoes" &&
        f.status === "active",
    );
    const bottoms = snapshot.fashion_facts.find(
      (f) =>
        f.person_id === first.personId &&
        f.fact_type === "size" &&
        f.garment_type === "bottoms" &&
        f.status === "active",
    );
    assert.equal((shoes?.value as { value: number }).value, 11);
    assert.equal((bottoms?.value as { value: number }).value, 32);
  });
});

describe("questions_text_dedup", () => {
  it("dedupes duplicate question text entries", () => {
    const cleaned = sanitizeClarificationQuestions({
      questions: [
        {
          text: "Shoe size?",
          gap: "size",
          garment_type: "shoes",
          quick_options: ["9", "10", "Other"],
        },
        {
          text: "Shoe size?",
          gap: "size",
          garment_type: "shoes",
          quick_options: ["9", "10", "Other"],
        },
      ],
    });
    assert.equal(cleaned.length, 1);
  });
});
