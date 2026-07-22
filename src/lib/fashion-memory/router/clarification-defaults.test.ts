import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLARIFICATION_OTHER_OPTION,
  CLARIFICATION_OTHER_OPTION_ID,
  collectFashionPreviewRequests,
  defaultQuickOptionsForGap,
  ensureClarificationQuickOptions,
  ensureQuestionsHaveQuickOptions,
  ensureRideAlongDefaults,
  formatClarificationAnswerDisplay,
  mergeOptionPreviewsIntoFashionRouter,
  optionLabels,
} from "./clarification-defaults";

describe("clarification quick_options defaults", () => {
  it("fills shoe size chips when LLM omits options", () => {
    const filled = ensureClarificationQuickOptions({
      text: "What's his shoe size?",
      gap: "size",
      garment_type: "shoes",
    });
    assert.deepEqual(optionLabels(filled.quick_options), [
      "7",
      "8",
      "9",
      "10",
      "11",
      CLARIFICATION_OTHER_OPTION,
    ]);
    assert.equal(filled.allow_multiple, false);
  });

  it("appends Other when LLM provides chips without it", () => {
    const filled = ensureClarificationQuickOptions({
      text: "Which section?",
      gap: "department",
      quick_options: ["Men's", "Women's", "Mix it"],
    });
    assert.ok(optionLabels(filled.quick_options).includes("Men's"));
    assert.equal(
      optionLabels(filled.quick_options).at(-1),
      CLARIFICATION_OTHER_OPTION,
    );
  });

  it("defaults occasion to allow_multiple", () => {
    const filled = ensureClarificationQuickOptions({
      text: "What's the occasion?",
      gap: "occasion",
    });
    assert.equal(filled.allow_multiple, true);
  });

  it("defaults recipient and garment gaps", () => {
    assert.ok(defaultQuickOptionsForGap("recipient").includes("For me"));
    assert.ok(defaultQuickOptionsForGap("garment").includes("One piece"));
  });

  it("ensures a whole questions array", () => {
    const out = ensureQuestionsHaveQuickOptions([
      { text: "Shoe size?", gap: "size", garment_type: "shoes" },
      {
        text: "On roster?",
        gap: "recipient",
        quick_options: ["He's in my contacts", "New person"],
      },
    ]);
    assert.equal(optionLabels(out[0]?.quick_options).includes("9"), true);
    assert.equal(
      optionLabels(out[1]?.quick_options).at(-1),
      CLARIFICATION_OTHER_OPTION,
    );
  });

  it("normalizes string chips to rich options with ids", () => {
    const filled = ensureClarificationQuickOptions({
      text: "Style?",
      gap: "occasion",
      quick_options: [
        {
          id: "minimal",
          label: "Minimal",
          previewQuery: "minimalist menswear",
        },
        "Streetwear",
      ],
    });
    const street = filled.quick_options?.find(
      (o) => typeof o !== "string" && o.label === "Streetwear",
    );
    assert.ok(street && typeof street !== "string");
    assert.equal(street.id, "streetwear");
    const minimal = filled.quick_options?.find(
      (o) => typeof o !== "string" && o.id === "minimal",
    );
    assert.ok(minimal && typeof minimal !== "string");
    assert.equal(minimal.previewQuery, "minimalist menswear");
  });

  it("ride_along defaults to multi + Other", () => {
    const ride = ensureRideAlongDefaults({
      text: "Any vibe?",
      quick_options: ["Quiet luxury", "Street"],
    });
    assert.equal(ride?.allow_multiple, true);
    assert.equal(
      optionLabels(ride?.quick_options).at(-1),
      CLARIFICATION_OTHER_OPTION,
    );
  });

  it("formats multi + custom answers", () => {
    const display = formatClarificationAnswerDisplay(
      {
        selected: ["work", "weekend"],
        customText: "garden party",
      },
      [
        { id: "work", label: "Work" },
        { id: "weekend", label: "Weekend" },
        { id: CLARIFICATION_OTHER_OPTION_ID, label: CLARIFICATION_OTHER_OPTION },
      ],
    );
    assert.equal(display, "Work, Weekend, garden party");
  });

  it("merges preview images into fashion router options", () => {
    const merged = mergeOptionPreviewsIntoFashionRouter(
      {
        version: 1,
        move: "ask_clarification",
        expectsOptionPreviews: true,
        questions: [
          {
            text: "Style?",
            gap: "occasion",
            quick_options: [
              {
                id: "minimal",
                label: "Minimal",
                previewQuery: "minimalist menswear",
              },
            ],
          },
        ],
      },
      {
        minimal: [
          { url: "https://example.com/a.jpg", title: "A", productId: "1" },
        ],
      },
    );
    const opt = merged.questions?.[0]?.quick_options?.[0];
    assert.ok(opt && typeof opt !== "string");
    assert.equal(opt.previewImages?.[0]?.url, "https://example.com/a.jpg");
    assert.equal(merged.expectsOptionPreviews, false);
  });

  it("collects fashion preview requests", () => {
    const reqs = collectFashionPreviewRequests({
      questions: [
        {
          text: "Style?",
          gap: "occasion",
          quick_options: [
            {
              id: "minimal",
              label: "Minimal",
              previewQuery: "minimalist menswear",
            },
            { id: "size_m", label: "M" },
          ],
        },
      ],
    });
    assert.deepEqual(reqs, [
      { id: "minimal", previewQuery: "minimalist menswear" },
    ]);
  });
});
