/**
 * Person identity: relation beats name.
 * QA: "hoodie for my 8 year old son" must never offer brother Gabriel as a
 * name chip; two Gabriels coexist; first unique relation needs no name.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findRosterDuplicateForNewPerson,
  normalizeRelationAlias,
} from "../extraction/relation-aliases";
import {
  ambiguousNameMatches,
  formatPersonChoiceLabel,
  isNameOptionalForRelation,
  PERSON_NAME_SKIP_OPTION,
  rosterDisplayNames,
} from "../extraction/person-identity";
import { formatRosterLine } from "../extraction/context-format";
import { sanitizeClarificationQuestions } from "../intake/clarification-sanitize";
import {
  ensureClarificationQuickOptions,
  ensureQuestionsHaveQuickOptions,
} from "../router/clarification-defaults";
import { buildFashionRouterPrompt } from "../router/prompt";
import {
  needsIntakeFacts,
  parseDepartmentFromMessage,
} from "../intake/identity-gate";
import { departmentForProposedPerson } from "../resolve-person";
import {
  emptyGuestFashionMemorySnapshot,
  FashionLocalStore,
} from "../local/store";
import type { PersonRow } from "../types";
import { setTestPipelineEventCapture } from "../observability/trace";

function person(
  overrides: Partial<PersonRow> & Pick<PersonRow, "id" | "relation">,
): PersonRow {
  return {
    user_id: "u1",
    name: null,
    birthday: null,
    notes: null,
    intake_completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const SON_ASK = "hoodie for my 8 year old son";

describe("son_name_no_roster_options", () => {
  it("prompt forbids roster names on new-person name questions", () => {
    const prompt = buildFashionRouterPrompt({
      roster: "#b1 brother (Gabriel)",
      profiles: "## #b1 brother (Gabriel)\nshop men's",
      currentDate: "2026-07-15",
    });
    assert.match(prompt, /NAME QUESTIONS FOR A NEW PERSON/);
    assert.match(prompt, /NEVER offer existing\s+roster names/);
    assert.match(prompt, /DISTINCT RELATIONS ARE DISTINCT PEOPLE/);
    assert.match(prompt, /optional when the relation is unique/);
  });

  it("strips roster names from person_name quick_options; Skip only remains", () => {
    const brother = person({
      id: "11111111-1111-4111-8111-111111111111",
      relation: "brother",
      name: "Gabriel",
    });
    const cap: import("../observability/trace").CapturedPipelineEvent[] = [];
    setTestPipelineEventCapture(cap);
    try {
      // Sanitize LLM output first (logs strip), then defaults enforce Skip-only.
      const sanitized = ensureQuestionsHaveQuickOptions(
        sanitizeClarificationQuestions({
          questions: [
            {
              text: "What's your son's name?",
              gap: "person_name",
              quick_options: ["Gabriel", "Skip", "Other"],
            },
            {
              text: "Tops size?",
              gap: "size",
              garment_type: "tops",
              quick_options: ["XS", "S", "M", "L", "XL"],
            },
          ],
          rosterNames: rosterDisplayNames([brother]),
          stripPersonNameQuestions: false,
        }),
      );

      const nameQ = sanitized.find((q) => q.gap === "person_name");
      assert.ok(nameQ);
      assert.deepEqual(nameQ!.quick_options, [{ id: "skip", label: PERSON_NAME_SKIP_OPTION }]);
      assert.equal(
        nameQ!.quick_options?.some((o) =>
          /gabriel/i.test(typeof o === "string" ? o : o.label),
        ),
        false,
      );
      assert.ok(
        cap.some((e) => e.payload.decision === "roster_name_option_stripped"),
      );

      assert.equal(parseDepartmentFromMessage(SON_ASK), null);
      assert.equal(
        departmentForProposedPerson({
          relation: "son",
          departmentHint: null,
          ageHint: 8,
        }),
        "boys",
      );
    } finally {
      setTestPipelineEventCapture(null);
    }
  });

  it("defaults person_name chips to Skip only", () => {
    const filled = ensureClarificationQuickOptions({
      text: "Name?",
      gap: "person_name",
      quick_options: ["Gabriel", "Joe"],
    });
    assert.deepEqual(filled.quick_options, [{ id: "skip", label: PERSON_NAME_SKIP_OPTION }]);
  });
});

describe("two_gabriels_coexist", () => {
  it("brother Gabriel + son Gabriel stay distinct; facts attach to son", () => {
    const snapshot = emptyGuestFashionMemorySnapshot();
    const store = new FashionLocalStore(snapshot);
    const brother = store.resolvePerson({
      userId: "guest-1",
      relation: "brother",
      name: "Gabriel",
    });
    assert.equal(brother.relation, "brother");
    assert.equal(brother.name, "Gabriel");

    assert.equal(
      findRosterDuplicateForNewPerson({
        people: [brother],
        relation: "son",
        name: "Gabriel",
      }),
      null,
    );
    assert.equal(normalizeRelationAlias("son"), "son");
    assert.equal(normalizeRelationAlias("brother"), "brother");

    const son = store.resolvePerson({
      userId: "guest-1",
      relation: "son",
      name: "Gabriel",
    });
    assert.notEqual(son.id, brother.id);
    assert.equal(son.relation, "son");
    assert.equal(son.name, "Gabriel");

    store.upsertFashionFact({
      userId: "guest-1",
      personId: son.id,
      factType: "size",
      garmentType: "tops",
      value: { system: "alpha", value: "M" },
      sourceQuote: "he's an M",
    });

    const brotherFacts = snapshot.fashion_facts.filter(
      (f) => f.person_id === brother.id && f.status === "active",
    );
    assert.equal(brotherFacts.length, 0);
    const sonFacts = snapshot.fashion_facts.filter(
      (f) => f.person_id === son.id && f.status === "active",
    );
    assert.equal(sonFacts.length, 1);
    assert.equal((sonFacts[0]!.value as { value: string }).value, "M");

    const shortIds: Record<string, string> = {
      b000: brother.id,
      s000: son.id,
    };
    assert.equal(
      formatRosterLine(brother, shortIds),
      `#b000 brother (Gabriel)`,
    );
    assert.equal(formatRosterLine(son, shortIds), `#s000 son (Gabriel)`);
    assert.equal(formatPersonChoiceLabel(brother), "brother (Gabriel)");
    assert.equal(formatPersonChoiceLabel(son), "son (Gabriel)");

    const ambiguous = ambiguousNameMatches({
      userText: "get Gabriel a shirt",
      people: [brother, son],
    });
    assert.ok(ambiguous);
    assert.equal(ambiguous!.length, 2);
    const labels = ambiguous!.map(formatPersonChoiceLabel).sort();
    assert.deepEqual(labels, ["brother (Gabriel)", "son (Gabriel)"]);

    assert.equal(
      ambiguousNameMatches({
        userText: "get my son Gabriel a shirt",
        people: [brother, son],
      }),
      null,
    );
  });

  it("unique-slot mother merges on canonical key only", () => {
    const mother = person({
      id: "22222222-2222-4222-8222-222222222222",
      relation: "mother",
      name: "Rima",
    });
    const dup = findRosterDuplicateForNewPerson({
      people: [mother],
      relation: "mother",
      name: null,
    });
    assert.equal(dup?.id, mother.id);
    assert.equal(
      findRosterDuplicateForNewPerson({
        people: [mother],
        relation: "mama",
        name: null,
      }),
      null,
    );
  });
});

describe("unique_relation_name_optional", () => {
  it("first my son — name not required; department+size still gate", () => {
    const people = [
      person({
        id: "33333333-3333-4333-8333-333333333333",
        relation: "brother",
        name: "Gabriel",
      }),
    ];
    assert.equal(isNameOptionalForRelation(people, "son"), true);

    const stripped = sanitizeClarificationQuestions({
      questions: [
        { text: "What's his name?", gap: "person_name", quick_options: ["Skip"] },
        {
          text: "Tops size?",
          gap: "size",
          garment_type: "tops",
          quick_options: ["XS", "S", "M", "L", "XL", "Other"],
        },
      ],
      rosterNames: rosterDisplayNames(people),
      stripPersonNameQuestions: true,
    });
    assert.equal(
      stripped.some((q) => q.gap === "person_name"),
      false,
    );
    assert.equal(stripped.some((q) => q.gap === "size"), true);

    const withSon = [
      ...people,
      person({
        id: "44444444-4444-4444-8444-444444444444",
        relation: "son",
        name: null,
      }),
    ];
    assert.equal(isNameOptionalForRelation(withSon, "son"), false);

    const brief = {
      recipient_person_id: "new",
      request_type: "single_item" as const,
      garments: ["hoodie"],
      occasion_context: "general",
      quantity_hint: "one",
      must_haves: [],
      nice_to_haves: [],
      budget_context: { stated: false },
      style_direction: "hoodie",
      department_scope: "boys" as const,
    };
    assert.equal(
      needsIntakeFacts({
        facts: [],
        brief,
        person: { relation: "son" },
      }),
      true,
    );
    assert.equal(
      needsIntakeFacts({
        facts: [
          {
            id: "f1",
            user_id: "u1",
            person_id: "p",
            fact_type: "size",
            garment_type: "tops",
            value: { system: "alpha", value: "M" },
            status: "active",
            source_quote: null,
            superseded_by: null,
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          },
        ],
        brief,
        person: { relation: "son" },
      }),
      false,
    );
  });
});
