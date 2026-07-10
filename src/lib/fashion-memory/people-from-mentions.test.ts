import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractMentionedRelations,
  extractMentionedRelationsFromMessages,
} from "./people-from-mentions";
import { FashionLocalStore } from "./local/store";
import { ensureMentionedPeopleLocal } from "./people-from-mentions";

describe("extractMentionedRelations", () => {
  it("detects for my mother / mom aliases", () => {
    assert.deepEqual(
      extractMentionedRelations(
        "looking for a colorful v neck long dress for formal outing for my mother",
      ),
      ["mother"],
    );
    assert.deepEqual(extractMentionedRelations("gift for mom"), ["mother"]);
    assert.deepEqual(extractMentionedRelations("something for my mum"), [
      "mother",
    ]);
  });

  it("detects my wife / for dad patterns", () => {
    assert.deepEqual(extractMentionedRelations("blazer for my wife"), ["wife"]);
    assert.deepEqual(extractMentionedRelations("shoes for dad"), ["father"]);
  });

  it("ignores bare relation words without gift/my cue", () => {
    assert.deepEqual(
      extractMentionedRelations("the mother of pearl buttons look nice"),
      [],
    );
  });

  it("dedupes across messages", () => {
    assert.deepEqual(
      extractMentionedRelationsFromMessages([
        { role: "user", content: "dress for my mother" },
        { role: "assistant", content: "What's her size?" },
        { role: "user", content: "also something for mom later" },
      ]),
      ["mother"],
    );
  });
});

describe("ensureMentionedPeopleLocal", () => {
  it("creates a mother person on the guest roster", () => {
    const store = new FashionLocalStore({
      version: 1,
      people: [],
      fashion_facts: [],
      style_signals: [],
      request_events: [],
      extraction_runs: [],
    });
    const userId = "guest_test";
    store.ensureSelfPerson(userId);

    const created = ensureMentionedPeopleLocal({
      userId,
      store,
      messages: [
        {
          role: "user",
          content: "colorful v neck long dress for my mother",
        },
      ],
    });

    assert.equal(created.length, 1);
    assert.equal(created[0]!.relation, "mother");
    assert.ok(
      store.snapshot.people.some(
        (p) => p.user_id === userId && p.relation === "mother",
      ),
    );
    // Idempotent
    ensureMentionedPeopleLocal({
      userId,
      store,
      messages: [{ role: "user", content: "gift for mom" }],
    });
    assert.equal(
      store.snapshot.people.filter((p) => p.relation === "mother").length,
      1,
    );
  });
});
