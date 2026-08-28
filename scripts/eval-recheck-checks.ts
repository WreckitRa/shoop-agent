/**
 * Re-score deterministic checks on an existing eval run (no LLM).
 *   npx tsx scripts/eval-recheck-checks.ts [runDir]
 */
try {
  process.loadEnvFile?.(".env");
} catch {
  /* ambient */
}

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runDeterministicChecks } from "@/lib/fashion-memory/eval/checks";
import type { PersonaRunResult } from "@/lib/fashion-memory/eval/run-persona";

async function main() {
  const arg = process.argv[2];
  const runsRoot = path.join(
    process.cwd(),
    "src/lib/fashion-memory/eval/runs",
  );
  const runDir = arg
    ? path.isAbsolute(arg)
      ? arg
      : path.join(process.cwd(), arg)
    : path.join(runsRoot, "1-2026-08-27T09-22-14-850Z");

  const files = (await readdir(runDir)).filter(
    (f) => f.endsWith(".json") && f !== "summary.json",
  );
  const rates = new Map<string, { pass: number; n: number }>();
  let n = 0;
  const focus = [
    "stated_sizes_named_families",
    "known_summary_template",
    "pull_sheet_split",
    "anchor_asked",
    "truth_match",
  ] as const;
  const beforeFocus: Record<string, number> = Object.fromEntries(
    focus.map((k) => [k, 0]),
  );

  for (const file of files) {
    const raw = JSON.parse(
      await readFile(path.join(runDir, file), "utf8"),
    ) as PersonaRunResult & {
      checks?: Array<{ id: string; pass: boolean; reason: string }>;
    };
    if (raw.shopper_leak || raw.excluded) continue;
    n++;
    for (const id of focus) {
      if (
        Array.isArray(raw.checks) &&
        raw.checks.find((c) => c.id === id)?.pass
      ) {
        beforeFocus[id]!++;
      }
    }
    const checks = await runDeterministicChecks({
      ...raw,
      stage: raw.stage ?? "router",
      excluded: Boolean(raw.excluded),
    });
    (raw as { checks: typeof checks }).checks = checks;
    await writeFile(path.join(runDir, file), `${JSON.stringify(raw, null, 2)}\n`);
    for (const c of checks) {
      const a = rates.get(c.id) ?? { pass: 0, n: 0 };
      a.n++;
      if (c.pass) a.pass++;
      rates.set(c.id, a);
    }
  }

  console.log(`rechecked ${n} personas in ${runDir}`);
  for (const id of focus) {
    const r = rates.get(id);
    if (!r) continue;
    console.log(
      `${id}: ${beforeFocus[id]}/${n} → ${r.pass}/${r.n} (${((100 * r.pass) / r.n).toFixed(1)}%)`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
