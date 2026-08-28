import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPersonShortIdMap } from "./extraction/context-format";
import { canonicalizeRelation } from "./extraction/relation-aliases";
import {
  departmentForProposedPerson,
  MATCH_EXISTING_THRESHOLD,
  resolveProposedPerson,
} from "./resolve-person";
import type { PersonRow } from "./types";

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

describe("canonicalizeRelation", () => {
  it("maps sister's child to nephew", () => {
    assert.equal(canonicalizeRelation("sister's child"), "nephew");
    assert.equal(canonicalizeRelation("sister's son"), "nephew");
    assert.equal(
      canonicalizeRelation("sister's child", "girls"),
      "niece",
    );
  });

  it("does not alias mom/mama to mother", () => {
    assert.equal(canonicalizeRelation("mother"), "mother");
    assert.equal(canonicalizeRelation("mama"), "mama");
    assert.equal(canonicalizeRelation("mom"), "mom");
  });
});

describe("departmentForProposedPerson", () => {
  it("uses age_hint to pick boys over mens for nephew", () => {
    assert.equal(
      departmentForProposedPerson({
        relation: "nephew",
        ageHint: 8,
      }),
      "boys",
    );
  });

  it("prefers department_hint", () => {
    assert.equal(
      departmentForProposedPerson({
        relation: "nephew",
        departmentHint: "boys",
      }),
      "boys",
    );
  });
});

describe("resolveProposedPerson", () => {
  const brother = person({
    id: "11111111-1111-4111-8111-111111111111",
    relation: "brother",
    name: "Gabriel",
  });
  const mother = person({
    id: "22222222-2222-4222-8222-222222222222",
    relation: "mother",
    name: null,
  });
  const andrew = person({
    id: "33333333-3333-4333-8333-333333333333",
    relation: "friend",
    name: "Andrew",
  });
  const andre = person({
    id: "44444444-4444-4444-8444-444444444444",
    relation: "friend",
    name: "Andre",
  });
  const friendSam = person({
    id: "55555555-5555-4555-8555-555555555555",
    relation: "friend",
    name: "Sam",
  });
  const colleagueSam = person({
    id: "66666666-6666-4666-8666-666666666666",
    relation: "colleague",
    name: "Sam",
  });
  const son = person({
    id: "77777777-7777-4777-8777-777777777777",
    relation: "son",
    name: null,
  });

  it("creates son Gabriel without merging brother Gabriel", () => {
    const people = [brother];
    const decision = resolveProposedPerson({
      people,
      personShortIds: buildPersonShortIdMap(people),
      relation: "son",
      name: "Gabriel",
      matchExisting: {
        personRef: brother.id,
        confidence: 0.95,
      },
    });
    assert.equal(decision.action, "create");
    if (decision.action === "create") {
      assert.equal(decision.relation, "son");
      assert.equal(decision.name, "Gabriel");
    }
  });

  it("does not attach a relation word as a display name", () => {
    const people = [mother];
    const decision = resolveProposedPerson({
      people,
      personShortIds: buildPersonShortIdMap(people),
      relation: "mother",
      name: "mama",
    });
    assert.equal(decision.action, "merge");
    if (decision.action === "merge") {
      assert.equal(decision.attachName, undefined);
    }
  });

  it("merges canonical mother onto unique mother slot", () => {
    const people = [mother];
    const decision = resolveProposedPerson({
      people,
      personShortIds: buildPersonShortIdMap(people),
      relation: "mother",
    });
    assert.equal(decision.action, "merge");
    if (decision.action === "merge") {
      assert.equal(decision.person.id, mother.id);
    }
  });

  it("attaches Leo to the unnamed son", () => {
    const people = [son];
    const decision = resolveProposedPerson({
      people,
      personShortIds: buildPersonShortIdMap(people),
      relation: "son",
      name: "Leo",
    });
    assert.equal(decision.action, "merge");
    if (decision.action === "merge") {
      assert.equal(decision.attachName, "Leo");
    }
  });

  it("asks on a near-name even when match_existing is above the bar", () => {
    const people = [andrew];
    const shortIds = buildPersonShortIdMap(people);
    const short = Object.keys(shortIds)[0]!;
    const decision = resolveProposedPerson({
      people,
      personShortIds: shortIds,
      relation: "friend",
      name: "Andro",
      matchExisting: { personRef: short, confidence: 0.9 },
    });
    assert.equal(decision.action, "ambiguous");
    if (decision.action === "ambiguous") {
      assert.equal(decision.candidates[0]?.id, andrew.id);
    }
  });

  it("asks when creating Andrea next to friend Andrew", () => {
    const people = [andrew];
    const decision = resolveProposedPerson({
      people,
      personShortIds: buildPersonShortIdMap(people),
      relation: "friend",
      name: "Andrea",
    });
    assert.equal(decision.action, "ambiguous");
    if (decision.action === "ambiguous") {
      assert.equal(decision.candidates[0]?.id, andrew.id);
    }
  });

  it("asks when creating Sami next to son Sam", () => {
    const sonSam = person({
      id: "88888888-8888-4888-8888-888888888888",
      relation: "son",
      name: "Sam",
    });
    const brotherSam = person({
      id: "99999999-9999-4999-8999-999999999999",
      relation: "brother",
      name: "Sam",
    });
    const people = [sonSam, brotherSam];
    const decision = resolveProposedPerson({
      people,
      personShortIds: buildPersonShortIdMap(people),
      relation: "son",
      name: "Sami",
      matchExisting: {
        personRef: sonSam.id,
        confidence: 0.95,
      },
    });
    assert.equal(decision.action, "ambiguous");
    if (decision.action === "ambiguous") {
      assert.equal(decision.candidates[0]?.id, sonSam.id);
    }
  });

  it("asks when match_existing is below threshold", () => {
    const people = [andrew];
    const shortIds = buildPersonShortIdMap(people);
    const short = Object.keys(shortIds)[0]!;
    const decision = resolveProposedPerson({
      people,
      personShortIds: shortIds,
      relation: "friend",
      name: "Andrea",
      matchExisting: {
        personRef: short,
        confidence: MATCH_EXISTING_THRESHOLD - 0.1,
      },
    });
    assert.equal(decision.action, "ambiguous");
  });

  it("treats André and Andre as the same name", () => {
    const people = [andre];
    const decision = resolveProposedPerson({
      people,
      personShortIds: buildPersonShortIdMap(people),
      name: "André",
    });
    assert.equal(decision.action, "merge");
    if (decision.action === "merge") {
      assert.equal(decision.person.id, andre.id);
    }
  });

  it("asks when two people share a name and no relation is given", () => {
    const people = [friendSam, colleagueSam];
    const decision = resolveProposedPerson({
      people,
      personShortIds: buildPersonShortIdMap(people),
      name: "Sam",
    });
    assert.equal(decision.action, "ambiguous");
    if (decision.action === "ambiguous") {
      assert.equal(decision.candidates.length, 2);
    }
  });

  it("skips mentioned-only people", () => {
    const decision = resolveProposedPerson({
      people: [],
      personShortIds: {},
      relation: "sister",
      isRecipient: false,
    });
    assert.equal(decision.action, "skip");
  });

  it("creates nephew from sister's child", () => {
    const decision = resolveProposedPerson({
      people: [],
      personShortIds: {},
      relation: "sister's child",
      departmentHint: "boys",
    });
    assert.equal(decision.action, "create");
    if (decision.action === "create") {
      assert.equal(decision.relation, "nephew");
    }
  });
});
