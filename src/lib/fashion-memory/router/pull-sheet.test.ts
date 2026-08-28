import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  YOU_DECIDE_LABEL,
  YOU_DECIDE_OPTION_ID,
} from "./consultation";
import {
  buildDoneAnswers,
  buildEscapeAnswers,
  canEscapePullSheet,
  clampStepper,
  defaultDisplayForGap,
  formatCountLabel,
  formatPullSheetMessage,
  formatPullSheetRecap,
  preselectedOptionIds,
  resolveQuestionDisplay,
  seedStepperValue,
  STEPPER_MAX,
  STEPPER_MIN,
} from "./pull-sheet";
import type { FashionClarificationQuestion } from "./types";

const slotsQuestion = (): FashionClarificationQuestion => ({
  text: "What should I pull?",
  gap: "slots",
  kind: "consult",
  allow_multiple: true,
  display: "checklist",
  quick_options: [
    { id: "tee", label: "T-shirt", preselected: true },
    { id: "shorts", label: "Shorts", preselected: true },
    { id: "sunglasses", label: "Sunglasses", preselected: false },
    { id: YOU_DECIDE_OPTION_ID, label: YOU_DECIDE_LABEL },
  ],
});

const depthQuestion = (): FashionClarificationQuestion => ({
  text: "How many looks?",
  gap: "depth",
  kind: "consult",
  quick_options: ["2 looks", "3 looks", "5 looks", YOU_DECIDE_LABEL],
});

const anchorQuestion = (): FashionClarificationQuestion => ({
  text: "Stay close to your navy-and-cream lane?",
  gap: "preference_anchor",
  kind: "consult",
  why: "Your last office pull was navy",
  quick_options: [
    "Keep it me",
    "Push me a little",
    "Something new",
    YOU_DECIDE_LABEL,
  ],
});

const sizeQuestion = (): FashionClarificationQuestion => ({
  text: "What size in tops?",
  gap: "size",
  kind: "blocking",
  garment_type: "tops",
  quick_options: ["S", "M", "L"],
});

describe("pull sheet", () => {
  it("Done on slots posts only ticked labels; Escape posts the preselected set", () => {
    const slots = slotsQuestion();
    const ticked = {
      [slots.text]: { selected: ["tee", "shorts", "sunglasses"] },
    };
    const done = buildDoneAnswers([slots], ticked);
    assert.equal(
      formatPullSheetMessage([slots], done),
      "slots: T-shirt, Shorts, Sunglasses",
    );

    const untouched = {
      [slots.text]: { selected: preselectedOptionIds(slots) },
    };
    const escaped = buildEscapeAnswers([slots], untouched);
    assert.ok(escaped);
    assert.equal(
      formatPullSheetMessage([slots], escaped),
      "slots: T-shirt, Shorts",
    );
  });

  it("slots + depth + preference_anchor submit as one pipe-joined message", () => {
    const questions = [slotsQuestion(), depthQuestion(), anchorQuestion()];
    const answers = {
      [questions[0]!.text]: { selected: ["tee", "shorts", "sunglasses"] },
      [questions[1]!.text]: { selected: [], customText: "3" },
      [questions[2]!.text]: { selected: ["keep_it_me"] },
    };
    const done = buildDoneAnswers(questions, answers);
    assert.equal(
      formatPullSheetMessage(questions, done),
      "slots: T-shirt, Shorts, Sunglasses | depth: 3 | preference_anchor: Keep it me",
    );
  });

  it("depth stepper is bounded 1–8 and seeds from the first numeric chip", () => {
    assert.equal(STEPPER_MIN, 1);
    assert.equal(STEPPER_MAX, 8);
    assert.equal(clampStepper(0), 1);
    assert.equal(clampStepper(9), 8);
    assert.equal(seedStepperValue(depthQuestion()), 2);
  });

  it("Escape on a card with blocking size still requires size", () => {
    const questions = [sizeQuestion(), slotsQuestion()];
    const empty = {
      [questions[1]!.text]: { selected: preselectedOptionIds(questions[1]!) },
    };
    assert.equal(canEscapePullSheet(questions, empty), false);
    assert.equal(buildEscapeAnswers(questions, empty), null);

    const sized = {
      ...empty,
      [questions[0]!.text]: { selected: ["m"] },
    };
    assert.equal(canEscapePullSheet(questions, sized), true);
    const escaped = buildEscapeAnswers(questions, sized);
    assert.ok(escaped);
    assert.equal(
      formatPullSheetMessage(questions, escaped),
      "size: M | slots: T-shirt, Shorts",
    );
  });

  it("falls back to the per-gap display unless the LLM sets one", () => {
    assert.equal(defaultDisplayForGap("slots"), "checklist");
    assert.equal(defaultDisplayForGap("depth"), "stepper");
    assert.equal(
      resolveQuestionDisplay({
        text: "How many looks?",
        gap: "depth",
        kind: "consult",
        quick_options: ["2 looks", "3 looks"],
      }),
      "stepper",
    );
    assert.equal(
      resolveQuestionDisplay({
        text: "How many looks?",
        gap: "depth",
        kind: "consult",
        display: "chips",
        quick_options: ["2 looks", "3 looks"],
      }),
      "chips",
    );
  });

  it("recap pluralizes 1 look vs 3 looks", () => {
    assert.equal(formatCountLabel(1, "look", "looks"), "1 look");
    assert.equal(formatCountLabel(3, "look", "looks"), "3 looks");
    assert.match(
      formatPullSheetRecap({
        garments: ["shirt"],
        request_type: "outfit",
        depth: { looks_wanted: 1, source: "stated" },
      }) ?? "",
      /\b1 look\b/,
    );
  });
});
