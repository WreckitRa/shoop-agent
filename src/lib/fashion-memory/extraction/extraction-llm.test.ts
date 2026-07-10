import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evidenceQuoteInMessages,
  newMessageTextsFromContextBlock,
  normalizeEvidenceText,
} from "./evidence";
import { effectiveSignalConfidence, signalAboveEffectiveThreshold } from "../signal-confidence";
import { recordFashionOpsResultSchema, parseRecordFashionOpsResult } from "./tool-schema";
import { fashionFactGenderPresentationValueSchema } from "./fact-value-schemas";
import { buildFashionExtractionPrompt } from "./prompt";
import {
  findRosterDuplicateForNewPerson,
  normalizeRelationAlias,
} from "./relation-aliases";
import type { PersonRow } from "../types";

describe("fashion extraction evidence", () => {
  it("normalizes whitespace for substring checks", () => {
    assert.equal(normalizeEvidenceText("  I   hate   polyester  "), "i hate polyester");
  });

  it("finds evidence quotes in new message texts", () => {
    assert.equal(
      evidenceQuoteInMessages("I hate polyester", ["Yeah — I hate polyester actually"]),
      true,
    );
    assert.equal(
      evidenceQuoteInMessages("I love silk", ["black boots only"]),
      false,
    );
  });

  it("parses [NEW] lines from the messages block", () => {
    const texts = newMessageTextsFromContextBlock(
      "[CONTEXT] assistant: slim like usual?\n[NEW] user: yeah I'm an L now",
    );
    assert.deepEqual(texts, ["yeah I'm an L now"]);
  });
});

describe("fashion extraction tool schema", () => {
  it("accepts empty ops output", () => {
    const parsed = recordFashionOpsResultSchema.parse({
      ops: [],
      ambiguous_subjects: [],
    });
    assert.equal(parsed.ops.length, 0);
  });

  it("coerces missing evidence_quote and keeps valid ops", () => {
    const parsed = parseRecordFashionOpsResult({
      ops: [
        {
          op: "signal_add",
          person_ref: "self",
          source: "stated",
          confidence: 0.9,
          signal_type: "style",
          signal_value: "minimal",
          polarity: 1,
        },
        {
          op: "signal_add",
          person_ref: "self",
          source: "stated",
          confidence: 0.8,
          evidence_quote: "clean lines",
          signal_type: "style",
          signal_value: "tailored",
          polarity: 1,
        },
      ],
      ambiguous_subjects: [],
    });
    assert.equal(parsed.result.ops.length, 1);
    assert.equal(parsed.result.ops[0]?.signal_value, "tailored");
    assert.equal(parsed.droppedOps, 1);
  });

  it("accepts boys/girls/baby gender_presentation values", () => {
    assert.equal(
      fashionFactGenderPresentationValueSchema.parse({ presentation: "boys" })
        .presentation,
      "boys",
    );
    assert.equal(
      fashionFactGenderPresentationValueSchema.parse({ presentation: "girls" })
        .presentation,
      "girls",
    );
    assert.equal(
      fashionFactGenderPresentationValueSchema.parse({ presentation: "baby" })
        .presentation,
      "baby",
    );
  });
});

describe("signal confidence decay", () => {
  it("halves effective confidence every 9 months", () => {
    const now = new Date("2026-01-07T00:00:00.000Z");
    const signal = {
      confidence: 0.9,
      last_seen_at: "2025-04-07T00:00:00.000Z",
    };
    const effective = effectiveSignalConfidence(signal, now);
    assert.ok(Math.abs(effective - 0.45) < 0.05);
    assert.equal(signalAboveEffectiveThreshold(signal, 0.15, now), true);
  });
});

describe("extractor prompt v2", () => {
  it("includes the decision procedure and relation aliasing", () => {
    const prompt = buildFashionExtractionPrompt();
    assert.match(prompt, /THE DECISION PROCEDURE/);
    assert.match(prompt, /STEP 1 — PERSON or ITEM\?/);
    assert.match(prompt, /RELATION ALIASES/);
    assert.match(prompt, /short answer to an assistant question/);
    assert.match(prompt, /boys" \| "girls"/);
    assert.doesNotMatch(prompt, /THE SINGLE MOST IMPORTANT RULE/);
  });
});

const motherRima: PersonRow = {
  id: "person-mother",
  user_id: "u1",
  relation: "mother",
  name: "Rima",
  birthday: null,
  notes: null,
  intake_completed_at: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const colleagueSam: PersonRow = {
  id: "person-sam",
  user_id: "u1",
  relation: "colleague",
  name: "Sam",
  birthday: null,
  notes: null,
  intake_completed_at: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

describe("short_answer_size", () => {
  it("treats a short size reply as stated evidence for fact_add", () => {
    const prompt = buildFashionExtractionPrompt();
    assert.match(prompt, /"Medium"/);
    assert.match(prompt, /Stated fact/);

    const ops = recordFashionOpsResultSchema.parse({
      ops: [
        {
          op: "fact_add",
          person_ref: "abcd",
          source: "stated",
          confidence: 0.9,
          evidence_quote: "Medium",
          fact_type: "size",
          garment_type: "tops",
          value: { system: "alpha", value: "M" },
        },
      ],
      ambiguous_subjects: [],
    });
    assert.equal(ops.ops[0]?.op, "fact_add");
    assert.equal(ops.ops[0]?.source, "stated");
    assert.equal(ops.ops[0]?.evidence_quote, "Medium");
    assert.equal(evidenceQuoteInMessages("Medium", ["Medium"]), true);
  });
});

describe("mom_alias_no_duplicate", () => {
  it("rejects new_person when mama aliases to existing mother", () => {
    assert.equal(normalizeRelationAlias("mama"), "mother");
    assert.equal(normalizeRelationAlias("ماما"), "mother");

    const duplicate = findRosterDuplicateForNewPerson({
      people: [motherRima],
      relation: "mama",
      name: null,
    });
    assert.equal(duplicate?.id, motherRima.id);

    // Expected LLM path: no new_person; facts attach to existing mother short id.
    const ops = recordFashionOpsResultSchema.parse({
      ops: [
        {
          op: "signal_add",
          person_ref: "moth",
          source: "stated",
          confidence: 0.8,
          evidence_quote: "mama needs a scarf",
          signal_type: "style",
          signal_value: "scarf",
          polarity: 1,
        },
      ],
      ambiguous_subjects: [],
    });
    assert.equal(ops.ops.some((o) => o.op === "new_person"), false);
  });
});

describe("new_person_with_facts_same_batch", () => {
  it("allows new_person + size fact under new:1 in one tool call", () => {
    const ops = recordFashionOpsResultSchema.parse({
      ops: [
        {
          op: "new_person",
          person_ref: "new:1",
          source: "stated",
          confidence: 0.9,
          evidence_quote: "my colleague Lina",
          relation: "colleague",
          name: "Lina",
        },
        {
          op: "fact_add",
          person_ref: "new:1",
          source: "stated",
          confidence: 0.9,
          evidence_quote: "she's an S",
          fact_type: "size",
          garment_type: "tops",
          value: { system: "alpha", value: "S" },
        },
      ],
      ambiguous_subjects: [],
    });
    assert.equal(ops.ops[0]?.op, "new_person");
    assert.equal(ops.ops[1]?.op, "fact_add");
    assert.equal(ops.ops[1]?.person_ref, "new:1");
    assert.equal(
      findRosterDuplicateForNewPerson({
        people: [motherRima],
        relation: "colleague",
        name: "Lina",
      }),
      null,
    );
  });
});

describe("friend_vs_colleague_ambiguous", () => {
  it("does not auto-merge friend/colleague; expects ambiguous_subject with zero new_person", () => {
    // Adapter must NOT treat friend Sam as a duplicate of colleague Sam —
    // that cross-bucket case is for the LLM via ambiguous_subject.
    assert.equal(
      findRosterDuplicateForNewPerson({
        people: [colleagueSam],
        relation: "friend",
        name: "Sam",
      }),
      null,
    );

    const prompt = buildFashionExtractionPrompt();
    assert.match(prompt, /my friend Sam/);
    assert.match(prompt, /ambiguous_subject/);

    const ops = recordFashionOpsResultSchema.parse({
      ops: [],
      ambiguous_subjects: [
        {
          description: "friend Sam vs existing colleague Sam",
          candidate_person_refs: ["person-sam"],
          evidence_quote: "my friend Sam wants sneakers",
        },
      ],
    });
    assert.equal(ops.ops.length, 0);
    assert.equal(ops.ops.some((o) => o.op === "new_person"), false);
    assert.equal(ops.ambiguous_subjects.length, 1);
  });
});
