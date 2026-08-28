import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPersonShortIdMap,
  formatMessageWindowBlock,
  formatRosterLine,
  isMessageAfterWatermark,
  personMentionedInText,
  personShortId,
  selectSnapshotPersonIds,
} from "./context-format";
import type { PersonRow } from "../types";

function person(overrides: Partial<PersonRow> & Pick<PersonRow, "id" | "relation">): PersonRow {
  return {
    user_id: "user-1",
    name: null,
    birthday: null,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("assembleExtractionContext helpers", () => {
  it("formats roster lines with optional names", () => {
    const shortIds = {
      a1b2: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      c3d4: "cccccccc-dddd-eeee-ffff-gggggggggggg",
    };
    assert.equal(
      formatRosterLine(
        person({
          id: shortIds.a1b2,
          relation: "self",
          name: "Raphael",
        }),
        shortIds,
      ),
      "#a1b2 self (Raphael)",
    );
    assert.equal(
      formatRosterLine(
        person({ id: shortIds.c3d4, relation: "wife" }),
        shortIds,
      ),
      "#c3d4 wife",
    );
  });

  it("uses first four hex chars as short ids", () => {
    const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    assert.equal(personShortId(id), "a1b2");
  });

  it("detects relation and name mentions in message text", () => {
    const brother = person({
      id: "1",
      relation: "brother",
      name: "Gabriel",
    });
    assert.equal(
      personMentionedInText(brother, "Need a gift for my brother"),
      true,
    );
    assert.equal(
      personMentionedInText(brother, "Gabriel hates polyester"),
      true,
    );
    assert.equal(personMentionedInText(brother, "black boots for me"), false);
  });

  it("always includes self and sticky ids in snapshot selection", () => {
    const people = [
      person({ id: "self-id", relation: "self", name: "Raphael" }),
      person({ id: "bro-id", relation: "brother", name: "Gabriel" }),
      person({ id: "wife-id", relation: "wife" }),
    ];
    const selected = selectSnapshotPersonIds({
      people,
      messageWindowText: "show me sneakers",
      stickyPersonIds: ["wife-id"],
    });
    assert.deepEqual(selected, ["self-id", "wife-id"]);
  });

  it("includes people matched in the message window", () => {
    const people = [
      person({ id: "self-id", relation: "self" }),
      person({ id: "bro-id", relation: "brother", name: "Gabriel" }),
    ];
    const selected = selectSnapshotPersonIds({
      people,
      messageWindowText: "Gabriel needs a jacket",
      stickyPersonIds: [],
    });
    assert.deepEqual(selected, ["self-id", "bro-id"]);
  });

  it("tags messages as CONTEXT or NEW relative to watermark", () => {
    const t0 = new Date("2026-07-07T10:00:00.000Z");
    const t1 = new Date("2026-07-07T10:01:00.000Z");
    const watermark = { id: "m1", createdAt: t0 };
    assert.equal(
      isMessageAfterWatermark({ id: "m0", createdAt: t0 }, watermark),
      false,
    );
    assert.equal(
      isMessageAfterWatermark({ id: "m2", createdAt: t1 }, watermark),
      true,
    );

    const block = formatMessageWindowBlock({
      watermarkMessageId: "m1",
      watermarkCreatedAt: t0,
      messages: [
        {
          id: "m0",
          role: "assistant",
          content: "slim like usual?",
          metadata: null,
          createdAt: t0,
        },
        {
          id: "m2",
          role: "user",
          content: "yeah",
          metadata: null,
          createdAt: t1,
        },
      ],
    });
    assert.match(block, /\[CONTEXT\] assistant: slim like usual\?/);
    assert.match(block, /\[NEW\] user: yeah/);
  });

  it("marks chip taps as [tap] on the NEW line", () => {
    const t1 = new Date("2026-07-07T10:01:00.000Z");
    const block = formatMessageWindowBlock({
      watermarkMessageId: null,
      watermarkCreatedAt: null,
      messages: [
        {
          id: "m2",
          role: "user",
          content: "You decide",
          metadata: { fashionChipTap: true },
          createdAt: t1,
        },
      ],
    });
    assert.match(block, /\[NEW\] \[tap\] user: You decide/);
  });

  it("matches relation aliases like mom → mother", () => {
    const mother = person({ id: "2", relation: "mother", name: "Sarah" });
    assert.equal(personMentionedInText(mother, "gift for mom"), true);
  });

  it("resolves short id collisions with six-char fallback", () => {
    const people = [
      person({ id: "aaaaaaaa-1111-2222-3333-444444444444", relation: "self" }),
      person({ id: "aaaaaaaa-5555-6666-7777-888888888888", relation: "wife" }),
    ];
    const map = buildPersonShortIdMap(people);
    assert.equal(Object.keys(map).length, 2);
    assert.notEqual(map.aaaa, map.aaaaaa);
  });
});
