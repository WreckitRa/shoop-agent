import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { optionLabels } from "../router/clarification-defaults";
import type { FashionClarificationQuestion } from "../router/types";
import {
  flattenClarificationAnswers,
  parseClarificationAnswersFromMessage,
} from "./apply-intake-reply";
import { normalizeGarmentClarificationAnswer } from "./garment-answer";

const questions: FashionClarificationQuestion[] = [
  {
    text: "Which section should I shop for you?",
    gap: "department",
    field: "gender_presentation",
    quick_options: ["Men's", "Women's", "Mix it"],
  },
  {
    text: "What size do you usually wear in tops?",
    gap: "size",
    field: "size_tops",
    quick_options: ["XS", "S", "M", "L", "XL"],
  },
  {
    text: "And for bottoms — waist/size?",
    gap: "size",
    field: "size_bottoms",
    quick_options: ["28", "30", "32", "34", "36"],
  },
];

describe("parseClarificationAnswersFromMessage", () => {
  it("parses batched clarification replies from FashionRouterControls format", () => {
    const text =
      "Which section should I shop for you? Men's. What size do you usually wear in tops? M. And for bottoms — waist/size? 32";
    const answers = parseClarificationAnswersFromMessage(text, questions);
    assert.equal(answers.gender_presentation, "Men's");
    assert.equal(answers.size_tops, "M");
    assert.equal(answers.size_bottoms, "32");
  });

  it("parses bare single-question chip reply (e.g. M)", () => {
    const answers = parseClarificationAnswersFromMessage("M", [
      {
        text: "What size do you usually wear in tops?",
        gap: "size",
        field: "size_tops",
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
        optionLabels(garmentQ.quick_options),
      ),
      ["bracelets"],
    );
  });

  it("flattens structured multi-select answers", () => {
    const flat = flattenClarificationAnswers(
      {
        "What's the occasion?": {
          selected: ["work", "weekend"],
          customText: "brunch",
        },
      },
      [
        {
          text: "What's the occasion?",
          gap: "occasion",
          allow_multiple: true,
          quick_options: [
            { id: "work", label: "Work" },
            { id: "weekend", label: "Weekend" },
          ],
        },
      ],
    );
    assert.equal(flat.occasion, "Work, Weekend, brunch");
  });

  it("takes first chip for exclusive size when multi arrives", () => {
    const flat = flattenClarificationAnswers(
      {
        "Shoe size?": { selected: ["9", "10"] },
      },
      [
        {
          text: "Shoe size?",
          gap: "size",
          quick_options: [
            { id: "9", label: "9" },
            { id: "10", label: "10" },
          ],
        },
      ],
    );
    assert.equal(flat.size_shoes, "9");
  });
});
