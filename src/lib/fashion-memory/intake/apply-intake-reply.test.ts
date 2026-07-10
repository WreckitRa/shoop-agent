import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FashionIntakeQuestion } from "../router/types";
import { parseIntakeAnswersFromMessage } from "./apply-intake-reply";

const questions: FashionIntakeQuestion[] = [
  {
    field: "gender_presentation",
    question: "Which section should I shop for you?",
    quick_options: ["Men's", "Women's", "Mix it"],
  },
  {
    field: "size_tops",
    question: "What size do you usually wear in tops?",
    quick_options: ["XS", "S", "M", "L", "XL"],
  },
  {
    field: "size_bottoms",
    question: "And for bottoms — waist/size?",
    quick_options: ["28", "30", "32", "34", "36"],
  },
];

describe("parseIntakeAnswersFromMessage", () => {
  it("parses batched intake replies from FashionRouterControls format", () => {
    const text =
      "Which section should I shop for you? Men's. What size do you usually wear in tops? M. And for bottoms — waist/size? 32";
    const answers = parseIntakeAnswersFromMessage(text, questions);
    assert.equal(answers.gender_presentation, "Men's");
    assert.equal(answers.size_tops, "M");
    assert.equal(answers.size_bottoms, "32");
  });

  it("parses bare single-question chip reply (e.g. M)", () => {
    const answers = parseIntakeAnswersFromMessage("M", [
      {
        field: "size_tops",
        question: "What size do you usually wear in tops?",
        quick_options: ["XS", "S", "M", "L", "XL"],
      },
    ]);
    assert.equal(answers.size_tops, "M");
  });
});
