import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  duplicateIdsInTurn,
  headerContentMismatches,
  shortBenchThinNote,
} from "./composition-invariants";

describe("composition_invariants", () => {
  it("shortBenchThinNote is honest for empty and short benches", () => {
    assert.match(
      shortBenchThinNote({ eligibleCount: 0, garmentLabel: "two-piece swimsuit" })!,
      /Nothing solid/,
    );
    assert.match(
      shortBenchThinNote({ eligibleCount: 1, garmentLabel: "two-piece swimsuit" })!,
      /Only 1 true/,
    );
    assert.equal(
      shortBenchThinNote({ eligibleCount: 4, garmentLabel: "swimsuit" }),
      undefined,
    );
  });

  it("headerContentMismatches catches construction lies", () => {
    const mismatches = headerContentMismatches([
      {
        garment: "two-piece swimsuit",
        title: "Bahamas One Piece",
        id: "1",
      },
    ]);
    assert.ok(mismatches.length >= 1);
    assert.equal(
      headerContentMismatches([
        {
          garment: "two-piece swimsuit",
          title: "Classic Triangle Bikini Set",
          id: "2",
        },
      ]).length,
      0,
    );
  });

  it("duplicateIdsInTurn flags repeats", () => {
    assert.deepEqual(
      duplicateIdsInTurn([
        { id: "a", garment: "shirt", title: "A" },
        { id: "b", garment: "shirt", title: "B" },
        { id: "a", garment: "shirt", title: "A again" },
      ]),
      ["a"],
    );
  });
});
