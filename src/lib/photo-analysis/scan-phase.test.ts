import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { photoScanPhase, pinVerdictFinale, verdictUiFinale } from "./scan-phase";
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

  it("surfaces a verdict failure as error, not writing", () => {
    assert.equal(
      photoScanPhase(
        row({
          userReview: review(),
          verdictStatus: "done",
          verdictError: "Couldn’t finish writing your verdict — try again.",
        }),
      ),
      "error",
    );
  });
});

describe("verdictUiFinale", () => {
  it("keeps a photo on scan until she confirms — even with no row yet", () => {
    assert.equal(verdictUiFinale(null, true), "scan");
    assert.equal(verdictUiFinale(row(), true), "scan");
    assert.equal(verdictUiFinale(row({ status: "running" }), true), "scan");
    assert.equal(verdictUiFinale(row({ userReview: review() }), true), "scan");
  });

  it("locks the card only after a verdict, or when there was no photo", () => {
    assert.equal(verdictUiFinale(null, false), "card");
    assert.equal(
      verdictUiFinale(
        row({
          verdictStatus: "done",
          verdict: { user_facing_verdict: { headline: "x" } } as never,
        }),
        true,
      ),
      "card",
    );
  });

  it("does not treat a failed read as a skip", () => {
    assert.equal(verdictUiFinale(row({ error: "nope" }), true), "scan");
  });

  it("keeps the card once she has continued past scan", () => {
    assert.equal(pinVerdictFinale("card", "scan"), "card");
    assert.equal(pinVerdictFinale("scan", "scan"), "scan");
    assert.equal(pinVerdictFinale("scan", "card"), "card");
  });
});
