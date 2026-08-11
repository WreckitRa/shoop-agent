import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  asNormalizedOptions,
  CLARIFICATION_OTHER_OPTION,
  CLARIFICATION_OTHER_OPTION_ID,
  collectFashionPaletteRequests,
  collectFashionPreviewRequests,
  defaultQuickOptionsForGap,
  ensureClarificationQuickOptions,
  ensureQuestionsHaveQuickOptions,
  ensureRideAlongDefaults,
  formatClarificationAnswerDisplay,
  mergeOptionPalettesIntoFashionRouter,
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
    assert.ok(defaultQuickOptionsForGap("garment").includes("Shirt or top"));
    assert.ok(defaultQuickOptionsForGap("garment").includes("Dress"));
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
      {
        id: "minimal",
        previewQuery: "minimalist menswear",
        label: "Minimal",
      },
    ]);
  });

  it("skips color questions for image previews and collects palettes", () => {
    const meta = {
      questions: [
        {
          text: "Any color preference?",
          gap: "occasion" as const,
          quick_options: [
            {
              id: "neutral_tones",
              label: "Neutral tones",
              previewQuery: "neutral clothing",
            },
            {
              id: "dark_colors",
              label: "Dark colors",
              previewQuery: "dark clothing",
            },
          ],
        },
      ],
    };
    assert.deepEqual(collectFashionPreviewRequests(meta), []);
    assert.deepEqual(collectFashionPaletteRequests(meta), [
      {
        id: "neutral_tones",
        label: "Neutral tones",
        questionText: "Any color preference?",
      },
      {
        id: "dark_colors",
        label: "Dark colors",
        questionText: "Any color preference?",
      },
    ]);
  });

  it("cmsod35 pant vibe chips are color quiz not catalog previews", () => {
    const question = {
      text: "What's your vibe for the pant—neutral to echo the blazer, or a subtle contrast (charcoal, soft grey, warm taupe)?",
      gap: "garment" as const,
      quick_options: [
        {
          id: "neutral_cream_off_white_light_grey",
          label: "Neutral (cream, off-white, light grey)",
          previewQuery: "neutral cream light grey men's trousers slim fit",
        },
        {
          id: "charcoal_or_dark_grey",
          label: "Charcoal or dark grey",
          previewQuery: "charcoal dark grey men's trousers slim fit",
        },
        {
          id: "warm_taupe_or_soft_beige",
          label: "Warm taupe or soft beige",
          previewQuery: "taupe beige men's trousers slim fit",
        },
      ],
    };
    const meta = { questions: [question] };
    assert.deepEqual(collectFashionPreviewRequests(meta), []);
    assert.deepEqual(collectFashionPaletteRequests(meta), [
      {
        id: "neutral_cream_off_white_light_grey",
        label: "Neutral (cream, off-white, light grey)",
        questionText: question.text,
      },
      {
        id: "charcoal_or_dark_grey",
        label: "Charcoal or dark grey",
        questionText: question.text,
      },
      {
        id: "warm_taupe_or_soft_beige",
        label: "Warm taupe or soft beige",
        questionText: question.text,
      },
    ]);
    const stripped = ensureQuestionsHaveQuickOptions([question])[0]!;
    for (const o of stripped.quick_options ?? []) {
      if (typeof o === "string") continue;
      assert.equal(o.previewQuery, undefined);
      assert.equal(o.previewImages, undefined);
      // Palettes are LLM-hydrated async — emit must not store heuristics.
      assert.equal(o.paletteColors, undefined);
    }
  });

  it("ride-along color chips strip catalog previews and queue LLM palettes", () => {
    const rideText = "Any color preferences, or should I surprise you?";
    const ride = ensureRideAlongDefaults({
      text: rideText,
      quick_options: [
        { id: "surprise_me", label: "Surprise me" },
        { id: "neutral_tones", label: "Neutral tones" },
        { id: "dark_colors", label: "Dark colors" },
      ],
    });
    assert.ok(ride);
    const opts = asNormalizedOptions(ride!.quick_options);
    const neutral = opts.find((o) => o.id === "neutral_tones");
    const dark = opts.find((o) => o.id === "dark_colors");
    assert.equal(neutral?.paletteColors, undefined);
    assert.equal(dark?.paletteColors, undefined);
    assert.deepEqual(collectFashionPaletteRequests({ ride_along: ride }), [
      {
        id: "neutral_tones",
        label: "Neutral tones",
        questionText: rideText,
      },
      {
        id: "dark_colors",
        label: "Dark colors",
        questionText: rideText,
      },
    ]);
  });

  it("merges palette colors into fashion router options", () => {
    const merged = mergeOptionPalettesIntoFashionRouter(
      {
        version: 1,
        move: "ask_clarification",
        questions: [
          {
            text: "Color vibe?",
            gap: "occasion",
            quick_options: [
              { id: "neutral_tones", label: "Neutral tones" },
              { id: "dark_colors", label: "Dark colors" },
            ],
          },
        ],
      },
      {
        neutral_tones: ["#f2f2ee", "#cfcfc9", "#8a8a93", "#a8a29e"],
        dark_colors: ["#0f0f12", "#1f1f24", "#3a3a42", "#5c5c66"],
      },
    );
    const opts = merged.questions?.[0]?.quick_options ?? [];
    const neutral = opts.find(
      (o) => typeof o !== "string" && o.id === "neutral_tones",
    );
    const dark = opts.find(
      (o) => typeof o !== "string" && o.id === "dark_colors",
    );
    assert.ok(neutral && typeof neutral !== "string");
    assert.ok(dark && typeof dark !== "string");
    assert.deepEqual(neutral.paletteColors?.[0], "#f2f2ee");
    assert.deepEqual(dark.paletteColors?.[0], "#0f0f12");
    assert.notEqual(neutral.paletteColors?.[0], dark.paletteColors?.[0]);
  });
});
