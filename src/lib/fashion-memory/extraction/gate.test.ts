import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateFashionExtractionGate } from "./gate";

describe("evaluateFashionExtractionGate", () => {
  it("always proceeds on a chip tap, even a short ack", () => {
    const tap = {
      id: "u1",
      role: "user",
      content: "You decide",
      metadata: { fashionChipTap: true },
    };
    const gate = evaluateFashionExtractionGate({
      newUserMessages: [tap],
      orderedMessages: [tap],
    });
    assert.deepEqual(gate, { proceed: true });
  });
});
