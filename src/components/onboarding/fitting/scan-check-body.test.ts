import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StylePhotoAnalysis } from "@/lib/photo-analysis/result";
import {
  inferBodyFromPhotoAnalysis,
  resolveScanCheckBody,
} from "./scan-check-body";

function analysisWith(parts: {
  visual_frame?: string;
  body_shape_summary?: string;
  visible_muscular_distribution?: string;
}): StylePhotoAnalysis {
  const a = (value: string | undefined) => ({
    value: value ?? null,
    confidence: 0.7,
    evidence: "test",
    caveats: [],
  });
  return {
    visible_profile: {
      body_proportions: {
        visual_frame: a(parts.visual_frame),
        body_shape_summary: a(parts.body_shape_summary),
        visible_muscular_distribution: a(parts.visible_muscular_distribution),
      },
    },
  } as unknown as StylePhotoAnalysis;
}

describe("resolveScanCheckBody", () => {
  it("keeps explicit Fit selections", () => {
    const out = resolveScanCheckBody(
      { build: "plus", muscularity: "low", bodyShape: "oval" },
      analysisWith({
        visual_frame: "slim",
        body_shape_summary: "hourglass",
        visible_muscular_distribution: "defined",
      }),
    );
    assert.deepEqual(out, {
      build: "plus",
      muscularity: "low",
      bodyShape: "oval",
    });
  });

  it("defaults definition from build when Fit left it unset", () => {
    const athletic = resolveScanCheckBody({
      build: "athletic",
      muscularity: null,
      bodyShape: null,
    });
    const slim = resolveScanCheckBody({
      build: "slim",
      muscularity: null,
      bodyShape: null,
    });
    const avg = resolveScanCheckBody({
      build: "average",
      muscularity: null,
      bodyShape: null,
    });
    assert.equal(athletic.muscularity, "high");
    assert.equal(slim.muscularity, "low");
    assert.equal(avg.muscularity, "moderate");
    assert.equal(athletic.bodyShape, null);
  });

  it("defaults unset build to average", () => {
    const out = resolveScanCheckBody({
      build: null,
      muscularity: null,
      bodyShape: null,
    });
    assert.equal(out.build, "average");
    assert.equal(out.muscularity, "moderate");
  });

  it("fills shape from photo analysis without overriding Fit build or definition", () => {
    const out = resolveScanCheckBody(
      { build: "athletic", muscularity: null, bodyShape: null },
      analysisWith({
        visual_frame: "slim",
        body_shape_summary: "inverted triangle",
        visible_muscular_distribution: "soft",
      }),
    );
    assert.equal(out.build, "athletic");
    assert.equal(out.muscularity, "high");
    assert.equal(out.bodyShape, "inverted_triangle");
  });
});

describe("inferBodyFromPhotoAnalysis", () => {
  it("maps free-text assessments onto bands", () => {
    const out = inferBodyFromPhotoAnalysis(
      analysisWith({
        visual_frame: "broad solid frame",
        body_shape_summary: "pear / triangle",
        visible_muscular_distribution: "defined musculature",
      }),
    );
    assert.equal(out.build, "broad");
    assert.equal(out.bodyShape, "triangle");
    assert.equal(out.muscularity, "high");
  });
});
