import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dumpStateKey,
  hasHardZeroViolation,
  mergeFlakeAttempt,
  shouldRetryCase,
} from "./flake";
import type { CaseResult, StoreDump } from "./types";

const emptyDiff = {
  missing: [],
  extra: [],
  forbidden: [],
  wrong_person: [],
  status_mismatch: [],
};

function result(over: Partial<CaseResult>): CaseResult {
  return {
    id: "x",
    store: "local",
    pass: false,
    diff: emptyDiff,
    clerk: [],
    counts: {
      missing: 1,
      extra: 0,
      forbidden: 0,
      wrong_person: 0,
      expected_items: 1,
    },
    attempts: 1,
    stateKey: "a",
    ...over,
  };
}

describe("memory eval flake policy", () => {
  it("does not retry wrong-person or forbidden", () => {
    assert.equal(
      shouldRetryCase(
        result({
          counts: {
            missing: 0,
            extra: 0,
            forbidden: 1,
            wrong_person: 0,
            expected_items: 1,
          },
          diff: { ...emptyDiff, forbidden: ["x"] },
        }),
      ),
      false,
    );
    assert.equal(shouldRetryCase(result({})), true);
  });

  it("counts fail-then-pass as a flake pass", () => {
    const merged = mergeFlakeAttempt(
      result({ stateKey: "a" }),
      result({ pass: true, stateKey: "b", counts: { ...result({}).counts, missing: 0 } }),
    );
    assert.equal(merged.pass, true);
    assert.equal(merged.flake, true);
    assert.equal(merged.attempts, 2);
  });

  it("keeps a stable fail when dumps match", () => {
    const merged = mergeFlakeAttempt(
      result({ stateKey: "same" }),
      result({ stateKey: "same" }),
    );
    assert.equal(merged.pass, false);
    assert.equal(merged.flake, false);
    assert.equal(merged.flake_unstable, false);
  });

  it("fingerprints dumps without ids", () => {
    const dump = (name: string): StoreDump => ({
      people: [{ id: name, relation: "self", name: null }],
      facts: [],
      signals: [],
      request_events: [],
      ambiguous_subjects: 0,
      next_router_asks: [],
      recent_picks_line: null,
      watermark: null,
    });
    assert.equal(dumpStateKey(dump("a")), dumpStateKey(dump("b")));
  });

  it("never lets a hard-zero retry become a pass", () => {
    const merged = mergeFlakeAttempt(
      result({
        counts: {
          missing: 0,
          extra: 0,
          forbidden: 1,
          wrong_person: 0,
          expected_items: 1,
        },
        diff: { ...emptyDiff, forbidden: ["x"] },
      }),
      result({ pass: true, counts: { ...result({}).counts, missing: 0, forbidden: 0 } }),
    );
    assert.equal(merged.pass, false);
    assert.equal(hasHardZeroViolation(merged), true);
  });
});
