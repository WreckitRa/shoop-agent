import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coerceLookScanPayload } from "./look-scan-verdict";

describe("coerceLookScanPayload", () => {
  it("accepts the canonical snake_case shape", () => {
    const out = coerceLookScanPayload({
      verdict_title: "Love-it territory",
      verdict_body: "The **black tee** lands clean.",
      annotations: ["a", "b", "c", "d"],
      whispers: ["w1", "w2", "w3", "w4"],
      checks: { fit: "pass", palette: "caution", nolist: "fail" },
    }) as Record<string, unknown>;

    assert.equal(out.verdict_title, "Love-it territory");
    assert.equal(out.verdict_body, "The **black tee** lands clean.");
    assert.deepEqual(out.annotations, ["a", "b", "c", "d"]);
    assert.deepEqual(out.checks, {
      fit: "pass",
      palette: "caution",
      nolist: "fail",
    });
  });

  it("recovers camelCase aliases and pads missing lists", () => {
    const out = coerceLookScanPayload({
      verdictTitle: "Keep it",
      verdictBody: "Shoulders sit right.",
      checks: { fit: "ok", palette: "warn", noList: "clear" },
    }) as Record<string, unknown>;

    assert.equal(out.verdict_title, "Keep it");
    assert.equal(out.verdict_body, "Shoulders sit right.");
    assert.equal((out.annotations as string[]).length, 4);
    assert.equal((out.whispers as string[]).length, 4);
    assert.deepEqual(out.checks, {
      fit: "pass",
      palette: "caution",
      nolist: "pass",
    });
  });

  it("unwraps nested verdict + title/body aliases", () => {
    const out = coerceLookScanPayload({
      verdict: {
        title: "Almost",
        body: "Hem wants **one size up**.",
        annotations: ["hem"],
      },
      checks: { fit: "caution", palette: "pass", nolist: "pass" },
    }) as Record<string, unknown>;

    assert.equal(out.verdict_title, "Almost");
    assert.equal(out.verdict_body, "Hem wants **one size up**.");
    assert.equal((out.annotations as string[])[0], "hem");
    assert.equal((out.annotations as string[]).length, 4);
  });

  it("unwraps parseLlmJsonObject wrapper if passed by mistake", () => {
    const out = coerceLookScanPayload({
      value: {
        verdict_title: "Yes",
        verdict_body: "Works.",
        checks: { fit: "pass", palette: "pass", nolist: "pass" },
      },
      salvaged: false,
    }) as Record<string, unknown>;

    assert.equal(out.verdict_title, "Yes");
    assert.equal(out.verdict_body, "Works.");
  });
});
