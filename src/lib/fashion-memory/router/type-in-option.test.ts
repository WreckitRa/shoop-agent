import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  answerFromTypeIn,
  applyTypedOption,
  customOptionId,
} from "./type-in-option";

const known = [
  { id: "work", label: "Work" },
  { id: "weekend", label: "Weekend" },
  { id: "other", label: "Other" },
];

describe("applyTypedOption", () => {
  it("creates a selected custom chip and leaves room to type another", () => {
    const first = applyTypedOption(
      { selected: ["work"], customLabels: [] },
      "brunch",
      known,
      true,
    );
    assert.deepEqual(first.customLabels, ["brunch"]);
    assert.deepEqual(first.selected, ["work", customOptionId("brunch")]);

    const second = applyTypedOption(first, "garden party", known, true);
    assert.deepEqual(second.customLabels, ["brunch", "garden party"]);
    assert.deepEqual(second.selected, [
      "work",
      customOptionId("brunch"),
      customOptionId("garden party"),
    ]);
  });

  it("selects a matching known option instead of duplicating it", () => {
    const next = applyTypedOption(
      { selected: [], customLabels: [] },
      "weekend",
      known,
      true,
    );
    assert.deepEqual(next.selected, ["weekend"]);
    assert.deepEqual(next.customLabels, []);
  });

  it("replaces the selection when the question is single-pick", () => {
    const next = applyTypedOption(
      { selected: ["work"], customLabels: [] },
      "42",
      known,
      false,
    );
    assert.deepEqual(next.selected, [customOptionId("42")]);
    assert.deepEqual(next.customLabels, ["42"]);
  });
});

describe("answerFromTypeIn", () => {
  it("joins selected custom chips into customText", () => {
    const answer = answerFromTypeIn([
      "work",
      customOptionId("brunch"),
      customOptionId("garden party"),
    ]);
    assert.deepEqual(answer, {
      selected: ["work"],
      customText: "brunch, garden party",
    });
  });
});
