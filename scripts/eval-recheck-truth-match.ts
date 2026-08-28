#!/usr/bin/env npx tsx
/**
 * Re-score an existing eval run's JSON through the fixed truth_match check
 * without regenerating appointments.
 *
 *   npx tsx scripts/eval-recheck-truth-match.ts [runDir]
 */
try {
  process.loadEnvFile?.(".env");
} catch {
  /* ambient */
}

import { readdir, readFile } from "node:fs/promises";
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
    : path.join(runsRoot, "1-2026-08-25T12-33-48-238Z");

  const files = (await readdir(runDir)).filter(
    (f) => f.endsWith(".json") && f !== "summary.json",
  );

  let scored = 0;
  let pass = 0;
  let wasPass = 0;
  const flips: Array<{ id: string; before: boolean; after: boolean; reason: string }> =
    [];

  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(runDir, file), "utf8")) as {
      persona: PersonaRunResult["persona"];
      transcript: PersonaRunResult["transcript"];
      brief: PersonaRunResult["brief"];
      shopper_leak: PersonaRunResult["shopper_leak"];
      excluded?: boolean;
      question_rounds: number;
      impatient: boolean;
      stage?: PersonaRunResult["stage"];
      traceId: string;
      conversationId: string;
      userId: string;
      checks?: Array<{ id: string; pass: boolean; reason: string }>;
    };
    if (raw.shopper_leak || raw.excluded) continue;
    scored += 1;
    const before = raw.checks?.find((c) => c.id === "truth_match");
    if (before?.pass) wasPass += 1;

    const result: PersonaRunResult = {
      persona: raw.persona,
      stage: raw.stage ?? "router",
      transcript: raw.transcript,
      brief: raw.brief,
      shopper_leak: raw.shopper_leak,
      excluded: Boolean(raw.excluded),
      question_rounds: raw.question_rounds,
      impatient: raw.impatient,
      traceId: raw.traceId,
      conversationId: raw.conversationId,
      userId: raw.userId,
    };
    process.env.EVAL_TRUTH_MATCH_NO_HAIKU = process.env.EVAL_TRUTH_MATCH_NO_HAIKU ?? "0";
    const checks = await runDeterministicChecks(result);
    const after = checks.find((c) => c.id === "truth_match")!;
    if (after.pass) pass += 1;
    if (Boolean(before?.pass) !== after.pass) {
      flips.push({
        id: raw.persona.id,
        before: Boolean(before?.pass),
        after: after.pass,
        reason: after.reason,
      });
    }
  }

  const rate = scored ? Math.round((pass / scored) * 1000) / 10 : 0;
  const wasRate = scored ? Math.round((wasPass / scored) * 1000) / 10 : 0;
  console.log(`Run: ${runDir}`);
  console.log(`truth_match scored=${scored}`);
  console.log(`  before (stored): ${wasPass}/${scored} (${wasRate}%)`);
  console.log(`  after (family):  ${pass}/${scored} (${rate}%)`);
  if (flips.length) {
    console.log("Flips:");
    for (const f of flips.slice(0, 20)) {
      console.log(
        `  ${f.id}: ${f.before} → ${f.after} (${f.reason.slice(0, 80)})`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
