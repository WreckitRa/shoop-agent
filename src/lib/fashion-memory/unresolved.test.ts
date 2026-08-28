import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { giftRejectionTarget } from "./curation/interaction-signals";
import type { AmbiguousSubject } from "../extraction/tool-schema";
import type { PersonRow } from "../types";
import {
  bundleUnresolvedRecipientAsk,
  nextRouterAsksFromUnresolved,
  personFromRecipientChip,
} from "./unresolved";

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

describe("unresolved recipient asks", () => {
  it("builds chips from candidate refs", () => {
    const friend = person({
      id: "11111111-1111-4111-8111-111111111111",
      relation: "friend",
      name: "Sam",
    });
    const colleague = person({
      id: "22222222-2222-4222-8222-222222222222",
      relation: "colleague",
      name: "Sam",
    });
    const subjects: AmbiguousSubject[] = [
      {
        description: "Sam",
        candidate_person_refs: [friend.id, colleague.id],
        evidence_quote: "Sam likes navy",
      },
    ];
    const asks = nextRouterAsksFromUnresolved({
      subjects,
      people: [friend, colleague],
    });
    assert.equal(asks[0]?.gap, "recipient");
    assert.ok(asks[0]?.chips.includes("friend (Sam)"));
    assert.ok(asks[0]?.chips.includes("colleague (Sam)"));
    assert.equal(
      personFromRecipientChip("friend (Sam)", [friend, colleague])?.id,
      friend.id,
    );
  });

  it("bundles a recipient question onto off-topic", () => {
    const friend = person({
      id: "11111111-1111-4111-8111-111111111111",
      relation: "friend",
      name: "Andrew",
    });
    const bundled = bundleUnresolvedRecipientAsk({
      result: { move: "respond_off_topic", reply: "Sure." },
      subjects: [
        {
          description: "Andrew",
          candidate_person_refs: [friend.id],
          evidence_quote: "Andrea wants sneakers",
        },
      ],
      people: [friend],
      isRefinement: false,
      alreadyAsked: false,
    });
    assert.equal(bundled.move, "ask_clarification");
    if (bundled.move !== "ask_clarification") return;
    assert.equal(bundled.questions[0]?.gap, "recipient");
  });

  it("skips on refinement turns", () => {
    const result = bundleUnresolvedRecipientAsk({
      result: { move: "respond_off_topic", reply: "Sure." },
      subjects: [
        {
          description: "Sam",
          candidate_person_refs: ["x"],
          evidence_quote: "Sam",
        },
      ],
      people: [],
      isRefinement: true,
      alreadyAsked: false,
    });
    assert.equal(result.move, "respond_off_topic");
  });
});

describe("giftRejectionTarget", () => {
  it("routes gift rejections to the recipient at 0.3 candidate", () => {
    const hit = giftRejectionTarget({
      selfPersonId: "self",
      recipient: { personId: "mother", isSelf: false },
    });
    assert.deepEqual(hit, {
      personId: "mother",
      confidence: 0.3,
      status: "candidate",
    });
    assert.equal(
      giftRejectionTarget({
        selfPersonId: "self",
        recipient: { personId: "self", isSelf: true },
      }),
      null,
    );
  });
});
