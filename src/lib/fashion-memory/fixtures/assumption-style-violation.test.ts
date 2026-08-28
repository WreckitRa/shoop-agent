import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASSUMPTION_STYLE_BANNED_RE,
  flagAssumptionStyleViolations,
  repairUnspokenAssumptions,
} from "../curation/narration-sanitize";
import { ROUTER_PROMPT_STATIC } from "../router/prompt";
import {
  setTestPipelineEventCapture,
  type CapturedPipelineEvent,
} from "../observability/trace";

describe("assumption_style_violation", () => {
  it("prompt requires client-facing assumption speech", () => {
    assert.match(
      ROUTER_PROMPT_STATIC,
      /ONE sentence you would say to the client's\s+face/,
    );
    assert.match(ROUTER_PROMPT_STATIC, /wasn't specified/);
    assert.match(
      ROUTER_PROMPT_STATIC,
      /I went with one look and a few options\s+each/,
    );
  });

  it("assumption text with depth fires assumption_style_violation", () => {
    const cap: CapturedPipelineEvent[] = [];
    setTestPipelineEventCapture(cap);
    try {
      const line =
        "Assumed 1 complete outfit with a few options per item since depth wasn't specified";
      assert.equal(ASSUMPTION_STYLE_BANNED_RE.test(line), true);
      flagAssumptionStyleViolations({
        assumptions: [line],
        traceId: "t-assump",
      });
      assert.equal(
        cap.filter(
          (e) =>
            (e.payload as { kind?: string }).kind ===
            "assumption_style_violation",
        ).length,
        1,
      );

      const opening = repairUnspokenAssumptions({
        opening: "Here is your baptism look.",
        assumptions: [line],
        traceId: "t-assump-2",
      });
      assert.match(opening, /Assumed 1 complete outfit/);
      assert.match(opening, /baptism look/);
    } finally {
      setTestPipelineEventCapture(null);
    }
  });
});
