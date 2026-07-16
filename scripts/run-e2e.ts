#!/usr/bin/env npx tsx
/**
 * End-to-end fashion pipeline regression runner.
 *
 * Usage:
 *   npx tsx scripts/run-e2e.ts --mode mocked [--filter name] [--runs N] [--update-golden] [--serial]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ALL_SCENARIOS, scenarioByName } from "../e2e/scenarios";
import { executeScenario } from "../e2e/harness/execute-scenario";
import { diffStructuralTraces } from "../e2e/harness/golden-trace";
import type { E2eMode, StructuralTrace } from "../e2e/types";

function parseArgs(argv: string[]) {
  const mode = (argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ??
    (argv.includes("--mode")
      ? argv[argv.indexOf("--mode") + 1]
      : "mocked")) as E2eMode;
  const filter = argv.find((a) => a.startsWith("--filter="))?.split("=")[1] ??
    (argv.includes("--filter") ? argv[argv.indexOf("--filter") + 1] : undefined);
  const runs = Number(
    argv.find((a) => a.startsWith("--runs="))?.split("=")[1] ??
      (argv.includes("--runs") ? argv[argv.indexOf("--runs") + 1] : "1"),
  );
  const updateGolden = argv.includes("--update-golden");
  const parallel = argv.includes("--parallel");
  return { mode, filter, runs: Math.max(1, runs), updateGolden, parallel };
}

const GOLDEN_DIR = join(process.cwd(), "e2e", "golden-traces");
const REPORT_PATH = join(process.cwd(), "e2e-report.json");
const LIVE_BASELINE_PATH = join(process.cwd(), "e2e", "live-baseline.json");

function goldenPath(name: string) {
  return join(GOLDEN_DIR, `${name}.json`);
}

function loadGolden(name: string): StructuralTrace | null {
  const p = goldenPath(name);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as StructuralTrace;
}

function saveGolden(name: string, trace: StructuralTrace) {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  writeFileSync(goldenPath(name), `${JSON.stringify(trace, null, 2)}\n`);
}

type LiveBaseline = {
  minPassRate: number;
  scenarios?: Record<string, number>;
};

function loadLiveBaseline(): LiveBaseline {
  if (!existsSync(LIVE_BASELINE_PATH)) {
    return { minPassRate: 0.8 };
  }
  return JSON.parse(readFileSync(LIVE_BASELINE_PATH, "utf8")) as LiveBaseline;
}

async function runScenarioOnce(
  scenarioName: string,
  mode: E2eMode,
  updateGolden: boolean,
) {
  const scenario = scenarioByName(scenarioName);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioName}`);
  const result = await executeScenario(scenario, mode);

  if (mode === "mocked") {
    const golden = loadGolden(scenario.name);
    if (!golden) {
      if (updateGolden || process.env.E2E_UPDATE_GOLDEN === "1") {
        saveGolden(scenario.name, result.structuralTrace);
        console.log(`  📝 golden trace written: ${scenario.name}`);
      } else if (result.ok) {
        console.warn(
          `  ⚠ no golden trace for ${scenario.name} — run with --update-golden`,
        );
      }
    } else if (updateGolden || process.env.E2E_UPDATE_GOLDEN === "1") {
      const drift = diffStructuralTraces(golden, result.structuralTrace);
      saveGolden(scenario.name, result.structuralTrace);
      if (drift.length) {
        console.log(
          `  📝 golden trace updated: ${scenario.name} (${drift.length} drift(s))`,
        );
      } else {
        console.log(`  📝 golden trace refreshed: ${scenario.name}`);
      }
    } else {
      const drift = diffStructuralTraces(golden, result.structuralTrace);
      if (drift.length) {
        result.failures.push(...drift.map((d) => `golden: ${d}`));
        result.ok = false;
      }
    }
  }

  return result;
}

async function main() {
  const { mode, filter, runs, updateGolden, parallel } = parseArgs(process.argv.slice(2));
  const scenarios = filter
    ? ALL_SCENARIOS.filter((s) => s.name.includes(filter))
    : ALL_SCENARIOS;

  if (!scenarios.length) {
    console.error(`No scenarios matched filter: ${filter}`);
    process.exit(1);
  }

  console.log(
    `E2E ${mode} — ${scenarios.length} scenario(s), ${runs} run(s) each${parallel ? " (parallel)" : " (serial)"}\n`,
  );

  const passRates = new Map<string, { pass: number; total: number; worst?: string }>();
  const reportRows: Array<{
    scenario: string;
    ok: boolean;
    failures: string[];
    traceId: string;
    passRate?: number;
  }> = [];
  let failed = false;

  for (let run = 0; run < runs; run += 1) {
    const label = runs > 1 ? ` (run ${run + 1}/${runs})` : "";

    const runOne = async (scenario: (typeof scenarios)[number]) => {
      const result = await runScenarioOnce(scenario.name, mode, updateGolden);
      return { scenario, result, label };
    };

    const outcomes = parallel
      ? await Promise.all(scenarios.map(runOne))
      : [];

    if (!parallel) {
      for (const scenario of scenarios) {
        outcomes.push(await runOne(scenario));
      }
    }

    for (const { scenario, result, label: runLabel } of outcomes) {
      const prev = passRates.get(scenario.name) ?? { pass: 0, total: 0 };
      prev.total += 1;

      if (result.ok) {
        prev.pass += 1;
        console.log(`  ✓ ${scenario.name}${runLabel}`);
      } else {
        failed = true;
        prev.worst = result.traceId;
        console.error(`  ✗ ${scenario.name}${runLabel}`);
        for (const f of result.failures) {
          console.error(`      ${f}`);
        }
      }

      passRates.set(scenario.name, prev);
      reportRows.push({
        scenario: scenario.name,
        ok: result.ok,
        failures: result.failures,
        traceId: result.traceId,
      });
    }
  }

  console.log("\n--- Pass rates ---");
  const baseline = mode === "live" ? loadLiveBaseline() : null;
  for (const [name, { pass, total, worst }] of passRates) {
    const pct = Math.round((pass / total) * 100);
    console.log(`  ${name}: ${pass}/${total} (${pct}%)${worst ? ` worst=${worst}` : ""}`);

    if (baseline) {
      const minPct = Math.round(
        (baseline.scenarios?.[name] ?? baseline.minPassRate) * 100,
      );
      if (pct < minPct) {
        failed = true;
        console.error(
          `      ✗ below live baseline (${minPct}% required, got ${pct}%)`,
        );
      }
    }
  }

  writeFileSync(
    REPORT_PATH,
    `${JSON.stringify(
      {
        mode,
        runs,
        timestamp: new Date().toISOString(),
        passRates: Object.fromEntries(passRates),
        results: reportRows,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nReport: ${REPORT_PATH}`);

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
