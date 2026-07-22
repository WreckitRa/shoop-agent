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
  it("keeps stored preview images when incoming metadata lacks them", () => {
    const stored: MessageMetadata = {
      giftDirections: {
        version: 1,
        recipientLabel: "Brother",
        pickCount: 2,
        status: "pending",
        directions: [
          {
            id: "cozy",
            label: "Cozy",
            previewQuery: "cozy gift",
            previewImages: [previewImage],
          },
        ],
        expectsOptionPreviews: false,
      },
    };

    const incoming: MessageMetadata = {
      giftDirections: {
        version: 1,
        recipientLabel: "Brother",
        pickCount: 2,
        status: "pending",
        directions: [{ id: "cozy", label: "Cozy", previewQuery: "cozy gift" }],
        expectsOptionPreviews: true,
      },
      shoppingMode: { version: 1, mode: "directional", source: "auto" },
    };

    const merged = mergeOptionPreviewMetadata(stored, incoming);
    assert.deepEqual(merged?.giftDirections?.directions[0]?.previewImages, [
      previewImage,
    ]);
    assert.deepEqual(merged?.shoppingMode, incoming.shoppingMode);
  });

  it("clearOptionPreviewExpectations stops poll loops", () => {
    const cleared = clearOptionPreviewExpectations({
      giftDirections: {
        version: 1,
        recipientLabel: "Brother",
        pickCount: 2,
        status: "pending",
        directions: [{ id: "cozy", label: "Cozy", previewQuery: "cozy gift" }],
        expectsOptionPreviews: true,
      },
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
    assert.equal(cleared?.giftDirections?.expectsOptionPreviews, false);
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
