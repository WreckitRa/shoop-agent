import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_SCENARIOS } from "./scenarios";
import { executeScenario } from "./harness/execute-scenario";
import { diffStructuralTraces } from "./harness/golden-trace";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const GOLDEN_DIR = join(process.cwd(), "e2e", "golden-traces");

function loadGolden(name: string) {
  const p = join(GOLDEN_DIR, `${name}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

describe("fashion e2e (mocked)", () => {
  for (const scenario of ALL_SCENARIOS) {
    it(scenario.name, async () => {
      const result = await executeScenario(scenario, "mocked");
      if (!result.ok) {
        assert.fail(result.failures.join("\n"));
      }

      const golden = loadGolden(scenario.name);
      if (golden) {
        const drift = diffStructuralTraces(golden, result.structuralTrace);
        assert.equal(drift.length, 0, drift.join("\n"));
      }
    });
  }
});
