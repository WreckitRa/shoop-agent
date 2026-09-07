import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFittingTraceId,
  sanitizeFittingTraceValue,
} from "./fitting-trace-shared";
import { logFitting, runWithFittingTrace } from "./fitting-trace";

describe("fitting-trace", () => {
  it("accepts uuid ids only", () => {
    assert.equal(
      isFittingTraceId("3fa85f64-5717-4562-b3fc-2c963f66afa6"),
      true,
    );
    assert.equal(isFittingTraceId("nophoto"), false);
    assert.equal(isFittingTraceId(""), false);
  });

  it("strips image payloads and caps long strings", () => {
    const cleaned = sanitizeFittingTraceValue({
      photo: "data:image/jpeg;base64,aaaa",
      brief: "x".repeat(21_000),
      nested: [{ url: "https://cdn.example.com/look.png" }],
    }) as Record<string, unknown>;
    assert.match(String(cleaned.photo), /^\[image \d+ chars\]$/);
    assert.equal(typeof cleaned.brief, "string");
    assert.match(String(cleaned.brief), /\+1000\]$/);
    const nested = cleaned.nested as unknown[];
    assert.deepEqual(nested, [{ url: "https://cdn.example.com/look.png" }]);
  });

  it("does not write files during unit tests", () => {
    runWithFittingTrace("3fa85f64-5717-4562-b3fc-2c963f66afa6", () => {
      logFitting("test.noop", { ok: true });
    });
  });
});
