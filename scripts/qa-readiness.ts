/**
 * Pre-QA verification — run fixture suites + mocked e2e and emit QA-READINESS report.
 *
 * Usage: npx tsx scripts/qa-readiness.ts
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type SuiteResult = {
  id: string;
  label: string;
  status: "pass" | "fail" | "skip";
  failingTests: string[];
  command: string;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd: string, args: string[]): { ok: boolean; output: string } {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  return { ok: res.status === 0, output };
}

function extractFailingTests(output: string): string[] {
  const lines = output.split("\n");
  const fails: string[] = [];
  for (const line of lines) {
    if (/^✖/.test(line) || /not ok/.test(line)) {
      fails.push(line.trim());
    }
  }
  return [...new Set(fails)].slice(0, 12);
}

function runTsxTest(files: string[]): SuiteResult {
  const command = `npx --yes tsx --test ${files.join(" ")}`;
  const { ok, output } = run("npx", ["--yes", "tsx", "--test", ...files]);
  return {
    id: files[0] ?? "unknown",
    label: files.map((f) => path.basename(f)).join(", "),
    status: ok ? "pass" : "fail",
    failingTests: ok ? [] : extractFailingTests(output),
    command,
  };
}

function shopDepartmentsReviewFlag(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(ROOT, "src/lib/fashion-memory/shop-departments.ts")) as {
      SHOP_DEPARTMENT_SEED: Array<{ confidence?: string }>;
    };
    const seed = mod.SHOP_DEPARTMENT_SEED;
    const inferred = seed.filter((r) => r.confidence === "inferred").length;
    const manual = seed.filter((r) => r.confidence === "manual").length;
    if (inferred > 0 && manual === 0) {
      return "shop_departments seed is entirely unreviewed (all inferred)";
    }
    if (inferred > manual) {
      return `shop_departments: ${inferred} inferred vs ${manual} manual — review backlog`;
    }
    return null;
  } catch {
    return "could not inspect shop_departments seed";
  }
}

const SUITES: Array<{ id: string; label: string; files: string[] }> = [
  {
    id: "joe",
    label: "Joe fixes (stated_facts, registration, meta-question, dedup)",
    files: ["src/lib/fashion-memory/fixtures/joe-incident.test.ts"],
  },
  {
    id: "blind_guards",
    label: "Blind guards (Rima re-ask, single-match, dodge vs answer)",
    files: ["src/lib/fashion-memory/fixtures/blind-guards.test.ts"],
  },
  {
    id: "slot_collapse",
    label: "Slot-collapse / planner invalidity",
    files: [
      "src/lib/fashion-memory/budget/budget-reality.test.ts",
      "src/lib/fashion-memory/fixtures/pipeline-fixtures.test.ts",
      "src/lib/fashion-memory/search-planner/search-planner.test.ts",
    ],
  },
  {
    id: "curation",
    label: "Curation trace fixes (veto harvest, attire, wall-clock, departments)",
    files: [
      "src/lib/fashion-memory/curation/curation.test.ts",
      "src/lib/fashion-memory/fixtures/shop-departments.test.ts",
      "src/lib/fashion-memory/fixtures/attire-conflict.test.ts",
    ],
  },
  {
    id: "relevance_guard",
    label: "Relevance guard (priced lanes, junk-share)",
    files: ["src/lib/fashion-memory/fixtures/relevance-guard.test.ts"],
  },
  {
    id: "capsule_budget",
    label: "Capsule budget math",
    files: ["src/lib/fashion-memory/budget/budgetAllocation.test.ts"],
  },
  {
    id: "presentation",
    label: "Presentation wiring (pool, TTL, swaps, degradation)",
    files: ["src/lib/fashion-memory/curation/presentation-wiring.test.ts"],
  },
  {
    id: "accessories",
    label: "Accessories incident (router coercion, coverage, badges, each)",
    files: ["src/lib/fashion-memory/fixtures/accessories-incident.test.ts"],
  },
  {
    id: "person_identity",
    label: "Person identity (relation beats name)",
    files: ["src/lib/fashion-memory/fixtures/person-identity.test.ts"],
  },
];

function main() {
  const results: SuiteResult[] = [];

  for (const suite of SUITES) {
    results.push({
      ...runTsxTest(suite.files.map((f) => path.join(ROOT, f))),
      id: suite.id,
      label: suite.label,
    });
  }

  const e2eCmd = "npm run test:e2e";
  const e2e = run("npm", ["run", "test:e2e"]);
  let e2eFails: string[] = [];
  if (!e2e.ok) {
    e2eFails = extractFailingTests(e2e.output);
    try {
      const report = JSON.parse(
        readFileSync(path.join(ROOT, "e2e-report.json"), "utf8"),
      ) as {
        results?: Array<{
          scenario: string;
          ok: boolean;
          failures?: string[];
        }>;
        scenarios?: Array<{ name: string; passed: boolean; errors?: string[] }>;
      };
      for (const s of report.results ?? []) {
        if (!s.ok) {
          e2eFails.push(
            `${s.scenario}: ${(s.failures ?? []).join("; ") || "failed"}`,
          );
        }
      }
      for (const s of report.scenarios ?? []) {
        if (!s.passed) {
          e2eFails.push(`${s.name}: ${(s.errors ?? []).join("; ")}`);
        }
      }
    } catch {
      // ignore stale/missing report
    }
    if (!e2eFails.length) {
      const crashLine =
        e2e.output
          .split("\n")
          .map((l) => l.trim())
          .find((l) => /^Error:/.test(l) || /exit code|failed/i.test(l)) ??
        "e2e exited non-zero (no scenario names captured)";
      e2eFails.push(crashLine.slice(0, 400));
    }
  }

  results.push({
    id: "e2e_mocked",
    label: "E2E net (mocked scenarios)",
    status: e2e.ok ? "pass" : "fail",
    failingTests: e2eFails,
    command: e2eCmd,
  });

  const shopFlag = shopDepartmentsReviewFlag();

  const lines: string[] = [
    "# QA-READINESS Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
  ];

  if (shopFlag) {
    lines.push(`> ⚠️ **shop_departments**: ${shopFlag}`, "");
  }

  let blocking = 0;
  for (const r of results) {
    const icon = r.status === "pass" ? "✅" : "❌";
    if (r.status === "fail") blocking += 1;
    lines.push(`## ${icon} ${r.label}`);
    lines.push(`- Command: \`${r.command}\``);
    if (r.failingTests.length) {
      lines.push("- Failing:");
      for (const t of r.failingTests) {
        lines.push(`  - ${t}`);
      }
    }
    lines.push("");
  }

  const allGreen = results.every((r) => r.status === "pass");
  lines.push(
    allGreen
      ? `**Verdict: QA-ready** — all ${results.length} checklist items green.`
      : `**Verdict: BLOCKED** — ${blocking} suite(s) failing. Fix before manual QA.`,
  );

  const reportPath = path.join(ROOT, "qa-readiness-report.md");
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
  console.log(`\nWrote ${reportPath}`);

  if (!allGreen) process.exit(1);
}

main();
