import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseClarificationAnswersFromMessage,
} from "../intake/apply-intake-reply";
import {
  filterQuestionsSatisfiedByConversation,
  type AnsweredGapEntry,
} from "../intake/clarification-dedup";
import type { FashionClarificationQuestion } from "../router/types";

const sizeTrio: FashionClarificationQuestion[] = [
  {
    text: "What size in tops?",
    gap: "size",
    field: "size_tops",
    garment_type: "tops",
    kind: "blocking",
    quick_options: ["XS", "S", "M", "L", "XL"],
  },
  {
    text: "And bottoms?",
    gap: "size",
    field: "size_bottoms",
    garment_type: "bottoms",
    kind: "blocking",
    quick_options: ["28", "30", "32", "34", "36"],
  },
  {
    text: "Shoe size?",
    gap: "size",
    field: "size_shoes",
    garment_type: "shoes",
    kind: "blocking",
    quick_options: ["8", "9", "10", "11", "12"],
  },
];

describe("partial_size_answer_remaining_families", () => {
  it("bare L after tops+bottoms+shoes ask → only tops answered", () => {
    const answers = parseClarificationAnswersFromMessage("L", sizeTrio);
    assert.equal(answers.size_tops, "L");
    assert.equal(answers.size_bottoms, undefined);
    assert.equal(answers.size_shoes, undefined);
  });

  it("ledger with only tops → follow-up keeps bottoms + shoes", () => {
    const ledger: AnsweredGapEntry[] = [
      { gap: "size", garment_type: "tops", source: "clarification_apply" },
    ];
    const remaining = filterQuestionsSatisfiedByConversation({
      questions: sizeTrio,
      facts: [],
      brief: { garments: ["shirt", "trousers", "shoes"] },
      answeredLedger: ledger,
    });
    const families = remaining
      .filter((q) => q.gap === "size")
      .map((q) => q.garment_type)
      .sort();
    assert.deepEqual(families, ["bottoms", "shoes"]);
  });
});
