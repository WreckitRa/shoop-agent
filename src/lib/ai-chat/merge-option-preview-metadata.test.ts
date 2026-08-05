import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeOptionPreviewMetadata, clearOptionPreviewExpectations } from "./merge-option-preview-metadata";
import type { MessageMetadata } from "./types";

const previewImage = {
  url: "https://cdn.example.com/a.jpg",
  title: "Sample",
  productId: "gid://shopify/p/1",
};

describe("mergeOptionPreviewMetadata", () => {
  it("clearOptionPreviewExpectations stops poll loops", () => {
    const cleared = clearOptionPreviewExpectations({
      fashionRouter: {
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
    });
    assert.equal(cleared?.fashionRouter?.expectsOptionPreviews, false);
  });

  it("keeps fashion router preview images when done arrives early", () => {
    const stored: MessageMetadata = {
      fashionRouter: {
        version: 1,
        move: "ask_clarification",
        expectsOptionPreviews: false,
        questions: [
          {
            text: "Style?",
            gap: "occasion",
            quick_options: [
              {
                id: "minimal",
                label: "Minimal",
                previewQuery: "minimalist menswear",
                previewImages: [previewImage],
              },
            ],
          },
        ],
      },
    };
    const incoming: MessageMetadata = {
      fashionRouter: {
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
    };
    const merged = mergeOptionPreviewMetadata(stored, incoming);
    const opt = merged?.fashionRouter?.questions?.[0]?.quick_options?.[0];
    assert.ok(opt && typeof opt !== "string");
    assert.deepEqual(opt.previewImages, [previewImage]);
  });
});
