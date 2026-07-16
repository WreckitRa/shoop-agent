import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  FashionClarificationQuestion,
  FashionIntakeQuestion,
} from "../router/types";
import { parseClarificationAnswersFromMessage, parseIntakeAnswersFromMessage } from "./apply-intake-reply";
import { normalizeGarmentClarificationAnswer } from "./garment-answer";

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

describe("garment clarification chip → concrete garments", () => {
  const garmentQ: FashionClarificationQuestion = {
    text: "What's Gabriel's size for the accessories you're picturing — like shoes, or are we talking watches, belts, bags?",
    gap: "garment",
    quick_options: [
      "Shoes (and other accessories)",
      "Watches, belts, bags, bracelets — no shoes",
      "Mix of both",
      "Other",
    ],
  };

  it("maps a bare bracelets reply through the single-question parser", () => {
    const answers = parseClarificationAnswersFromMessage("bracelets", [
      {
        text: garmentQ.text,
        gap: garmentQ.gap,
        quick_options: garmentQ.quick_options,
      },
    ]);
    assert.equal(answers.garment, "bracelets");
    assert.deepEqual(
      normalizeGarmentClarificationAnswer(
        answers.garment!,
        garmentQ.quick_options,
      ),
      ["bracelets"],
    );
  });
});
