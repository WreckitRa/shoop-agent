#!/usr/bin/env npx tsx
try {
  process.loadEnvFile?.(".env");
} catch {
  /* ambient env */
}

import { runMemoryEval } from "@/lib/fashion-memory/eval-memory/run";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const storeRaw = arg("--store") ?? "both";
  if (storeRaw !== "supabase" && storeRaw !== "local" && storeRaw !== "both") {
    throw new Error("--store must be supabase|local|both");
  }
  const caseRaw = arg("--case");
  const result = await runMemoryEval({
    store: storeRaw,
    caseIds: caseRaw
      ? caseRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
  });
  console.log(`\nRun dir: ${result.runDir}`);
  console.log(`Report:  ${result.reportPath}`);
  console.log(
    `passed ${result.aggregate.passed}/${result.aggregate.cases}  wrong-person ${result.aggregate.wrong_person_rate}  forbidden ${result.aggregate.forbidden_rate}  flake ${result.aggregate.flakes}/${result.aggregate.retried}`,
  );
  if (
    result.aggregate.wrong_person_rate > 0 ||
    result.aggregate.forbidden_rate > 0
  ) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
