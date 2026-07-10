import assert from "node:assert/strict";
import test from "node:test";
import {
  coerceDeliverCurationInput,
  extractDeliverCurationBlockDetailed,
  parseDeliverCurationInput,
} from "./tool-schema";

test("coerceDeliverCurationInput recovers missing vetoes and short strings", () => {
  const coerced = coerceDeliverCurationInput({
    slots: [
      {
        slot_id: "blazer",
        picks: [
          { ref: "blazer_1", role: "hero", stylist_line: "Good" },
        ],
      },
    ],
    narration: { opening: "Hi" },
  });
  const parsed = parseDeliverCurationInput(coerced);
  assert.ok(parsed);
  assert.equal(parsed!.vetoes.length, 0);
  assert.equal(parsed!.slots[0]!.picks[0]!.role, "anchor");
  assert.ok(parsed!.narration.opening.length >= 8);
  assert.ok(parsed!.slots[0]!.picks[0]!.stylist_line.length >= 8);
});

test("extractDeliverCurationBlockDetailed reports zod parse errors", () => {
  const result = extractDeliverCurationBlockDetailed([
    {
      type: "tool_use",
      id: "t1",
      name: "deliver_curation",
      input: { slots: [], narration: {} },
    },
  ]);
  assert.equal(result.hadToolUse, true);
  assert.equal(result.toolName, "deliver_curation");
  assert.equal(result.output, null);
  assert.ok(result.parseError);
  assert.match(result.parseError!, /slots|narration/i);
});

test("coerceDeliverCurationInput truncates over-long narration notes", () => {
  const long = "x".repeat(900);
  const parsed = parseDeliverCurationInput({
    slots: [
      { slot_id: "tie", picks: [{ ref: "tie_1", role: "support", stylist_line: "Good tie here" }] },
    ],
    vetoes: [],
    narration: {
      opening: long,
      budget_note: long,
      thin_note: long,
    },
  });
  assert.ok(parsed);
  assert.ok(parsed!.narration.opening.length <= 800);
  assert.ok((parsed!.narration.budget_note ?? "").length <= 400);
  assert.ok((parsed!.narration.thin_note ?? "").length <= 400);
});
