import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CaseResult, MemoryEvalAggregate } from "./types";

export function aggregateResults(results: CaseResult[]): MemoryEvalAggregate {
  const scored = results.filter((r) => !r.skipped);
  const expected = scored.reduce((n, r) => n + r.counts.expected_items, 0);
  const missing = scored.reduce((n, r) => n + r.counts.missing, 0);
  const extra = scored.reduce((n, r) => n + r.counts.extra, 0);
  const forbidden = scored.reduce((n, r) => n + r.counts.forbidden, 0);
  const wrong = scored.reduce((n, r) => n + r.counts.wrong_person, 0);
  const actualApprox = expected - missing + extra;
  const retried = scored.filter((r) => (r.attempts ?? 1) > 1).length;
  const flakes = scored.filter((r) => r.flake).length;
  return {
    cases: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: scored.filter((r) => !r.pass).length,
    skipped: results.filter((r) => r.skipped).length,
    retried,
    flakes,
    flake_rate: scored.length ? flakes / scored.length : 0,
    flake_unstable: scored.filter((r) => r.flake_unstable).length,
    wrong_person_rate: expected ? wrong / expected : 0,
    forbidden_rate: expected ? forbidden / expected : 0,
    missed_rate: expected ? missing / expected : 0,
    extra_rate: actualApprox > 0 ? extra / actualApprox : 0,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatClerkTrace(t: NonNullable<CaseResult["clerk"]>[number]): string[] {
  if (t.skipped) return [`    clerk: skipped (${t.skipped})`];
  if (!t.traces.length) return ["    clerk: (no ops)"];
  return t.traces.map((op) => {
    const status = op.accepted
      ? "accepted"
      : `rejected${op.reason ? ` ${op.reason}` : ""}`;
    const bits = [op.op];
    const e = op.emitted;
    if (typeof e.fact_type === "string") bits.push(e.fact_type);
    if (typeof e.garment_type === "string") bits.push(e.garment_type);
    if (typeof e.signal_type === "string") bits.push(e.signal_type);
    if (typeof e.signal_value === "string") bits.push(e.signal_value);
    if (typeof e.relation === "string") bits.push(e.relation);
    if (e.value != null) bits.push(JSON.stringify(e.value));
    return `    clerk: ${status} — ${bits.join(" ")}`;
  });
}

function formatCase(r: CaseResult): string {
  if (r.skipped) return `- ${r.id} [${r.store}] SKIP ${r.skipped}`;
  if (r.error) return `- ${r.id} [${r.store}] ERROR ${r.error}`;
  const mark = r.pass ? (r.flake ? "FLAKE PASS" : "PASS") : "FAIL";
  const bits = [
    `missing ${r.counts.missing}`,
    `extra ${r.counts.extra}`,
    `forbidden ${r.counts.forbidden}`,
    `wrong-person ${r.counts.wrong_person}`,
  ];
  const lines = [`- ${r.id} [${r.store}] ${mark} (${bits.join(", ")})`];
  for (const turn of r.clerk ?? []) {
    lines.push(...formatClerkTrace(turn));
  }
  if (!r.pass) {
    for (const m of r.diff.missing) lines.push(`    missing: ${m}`);
    for (const m of r.diff.wrong_person) lines.push(`    wrong-person: ${m}`);
    for (const m of r.diff.forbidden) lines.push(`    forbidden: ${m}`);
    for (const extra of r.diff.extra.filter((e) => e.startsWith("person "))) {
      lines.push(`    extra: ${extra}`);
    }
    for (const m of r.diff.next_router_asks ?? []) lines.push(`    ask: ${m}`);
    for (const m of r.diff.request_events ?? []) lines.push(`    events: ${m}`);
    for (const m of r.diff.recent_picks ?? []) lines.push(`    picks: ${m}`);
  }
  return lines.join("\n");
}

export function renderReport(params: {
  label: string;
  results: CaseResult[];
  aggregate: MemoryEvalAggregate;
}): string {
  const { label, results, aggregate: a } = params;
  return [
    `# Memory eval — ${label}`,
    "",
    `cases ${a.cases}  passed ${a.passed}  failed ${a.failed}  skipped ${a.skipped}`,
    "",
    `| rate | value | must be 0 |`,
    `|---|---|---|`,
    `| wrong-person | ${pct(a.wrong_person_rate)} | yes |`,
    `| forbidden | ${pct(a.forbidden_rate)} | yes |`,
    `| missed | ${pct(a.missed_rate)} | |`,
    `| extra | ${pct(a.extra_rate)} | |`,
    `| flake | ${pct(a.flake_rate)} (${a.flakes} recovered / ${a.retried} retried, ${a.flake_unstable} unstable) | |`,
    "",
    "## Cases",
    "",
    ...results.map(formatCase),
    "",
  ].join("\n");
}

export async function writeMemoryRun(params: {
  results: CaseResult[];
  aggregate: MemoryEvalAggregate;
}): Promise<{ runDir: string; reportPath: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(
    process.cwd(),
    "src/lib/fashion-memory/eval-memory/runs",
    stamp,
  );
  await mkdir(runDir, { recursive: true });
  const reportPath = path.join(runDir, "report.md");
  await writeFile(
    reportPath,
    renderReport({
      label: stamp,
      results: params.results,
      aggregate: params.aggregate,
    }),
  );
  await writeFile(
    path.join(runDir, "summary.json"),
    JSON.stringify(
      { aggregate: params.aggregate, results: params.results },
      null,
      2,
    ),
  );
  return { runDir, reportPath };
}
