import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { photoScanPhase } from "./scan-phase";
import type { PhotoAnalysisPublic } from "./types";
import type { StyleUserReview } from "./review";

function review(): StyleUserReview {
  return {
    confirmed_paths: [],
    corrections: [],
    rejected_paths: [],
    notes: [],
    submitted_at: new Date().toISOString(),
  };
}

function row(
  over: Partial<PhotoAnalysisPublic> = {},
): PhotoAnalysisPublic {
  return {
    id: "1",
    photoHash: "abc",
    status: "done",
    gate: null,
    result: {
      analysis_status: { usable: true },
    } as PhotoAnalysisPublic["result"],
    userReview: null,
    verdict: null,
    verdictStatus: "idle",
    verdictError: null,
    verdictMs: null,
    verdictModel: null,
    error: null,
    ms: null,
    model: null,
    engineVersion: "test",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("photoScanPhase", () => {
  it("stays on review until the user confirms", () => {
    assert.equal(photoScanPhase(row()), "review");
  });

  it("treats a saved review as writing even after reload", () => {
    assert.equal(
      photoScanPhase(row({ userReview: review() })),
      "writing",
    );
    assert.equal(
      photoScanPhase(row({ verdictStatus: "running" })),
      "writing",
    );
  });

  it("is done only when a verdict exists", () => {
    assert.equal(
      photoScanPhase(
        row({
          verdictStatus: "done",
          verdict: { user_facing_verdict: { headline: "x" } } as never,
        }),
      ),
      "done",
    );
  });

  it("reads until analysis lands", () => {
    assert.equal(photoScanPhase(null), "reading");
    assert.equal(photoScanPhase(row({ status: "running" })), "reading");
  });
});
