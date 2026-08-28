/**
 * Judge-only Opus regrade on an existing run's transcripts.
 * No router regen. Writes Opus as judge + regenerates report.
 *
 *   npx tsx scripts/eval-opus-full-regrade.ts <run-dir>
 */
try {
  process.loadEnvFile?.(".env");
} catch {
  /* ambient */
}

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { judgePersonaRunOpus } from "@/lib/fashion-memory/eval/judge";
import { currentPromptHashes } from "@/lib/fashion-memory/eval/grade-reuse";
import {
  writeRunArtifacts,
  type ScoredPersona,
} from "@/lib/fashion-memory/eval/report";
import type { JudgeGrade } from "@/lib/fashion-memory/eval/judge-prompt";
import type { EvalStage } from "@/lib/fashion-memory/eval/run-persona";
import { isUsageLimitError } from "@/lib/fashion-memory/eval/run";

async function loadRow(
  runDir: string,
  file: string,
  stage: EvalStage,
): Promise<ScoredPersona | null> {
  const raw = JSON.parse(await readFile(path.join(runDir, file), "utf8")) as {
    persona: ScoredPersona["result"]["persona"];
    transcript: ScoredPersona["result"]["transcript"];
    brief: ScoredPersona["result"]["brief"];
    checks: ScoredPersona["checks"];
    judge: JudgeGrade | null;
    judge_opus?: JudgeGrade | null;
    grade_reused?: boolean;
    grade_fingerprint?: string;
    cost_usd?: number;
    shopper_leak: ScoredPersona["result"]["shopper_leak"];
    excluded: boolean;
    error?: string;
    question_rounds: number;
    impatient: boolean;
    traceId: string;
  };
  if (!raw.brief || raw.error || raw.excluded || raw.shopper_leak) return null;
  return {
    result: {
      persona: raw.persona,
      stage,
      transcript: raw.transcript,
      brief: raw.brief,
      shopper_leak: raw.shopper_leak,
      excluded: raw.excluded,
      question_rounds: raw.question_rounds,
      impatient: raw.impatient,
      traceId: raw.traceId,
      conversationId: "",
      userId: "",
      error: raw.error,
    },
    checks: raw.checks,
    judge: raw.judge_opus ?? raw.judge,
    judge_opus: raw.judge_opus ?? raw.judge,
    grade_reused: raw.grade_reused,
    grade_fingerprint: raw.grade_fingerprint,
    cost_usd: raw.cost_usd,
    file: path.join(runDir, file),
  };
}

async function persist(row: ScoredPersona): Promise<void> {
  await writeFile(
    row.file,
    `${JSON.stringify(
      {
        persona: row.result.persona,
        transcript: row.result.transcript,
        brief: row.result.brief,
        checks: row.checks,
        judge: row.judge_opus ?? row.judge,
        judge_opus: row.judge_opus ?? row.judge,
        grade_reused: row.grade_reused ?? false,
        grade_fingerprint: row.grade_fingerprint,
        cost_usd: row.cost_usd,
        prompt_hashes: currentPromptHashes(),
        shopper_leak: row.result.shopper_leak,
        excluded: row.result.excluded,
        error: row.result.error,
        question_rounds: row.result.question_rounds,
        impatient: row.result.impatient,
        traceId: row.result.traceId,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function main() {
  const runDir = process.argv[2];
  if (!runDir) {
    throw new Error("usage: eval-opus-full-regrade.ts <run-dir>");
  }
  const stage: EvalStage = "router";
  const files = (await readdir(runDir)).filter(
    (f) => f.endsWith(".json") && f !== "summary.json",
  );
  const scored: ScoredPersona[] = [];
  for (const f of files) {
    const row = await loadRow(runDir, f, stage);
    if (row) scored.push(row);
  }
  console.log(`[opus-full] loaded ${scored.length} from ${runDir}`);

  let spend = 0;
  for (const row of scored) {
    if (row.judge_opus?.judge_model === "claude-opus-4-8") {
      row.judge = row.judge_opus;
      continue;
    }
    try {
      const out = await judgePersonaRunOpus({
        result: row.result,
        checks: row.checks,
        traceId: row.result.traceId,
      });
      spend += out.usd;
      row.judge = out.grade;
      row.judge_opus = out.grade;
      row.cost_usd = (row.cost_usd ?? 0) + out.usd;
      await persist(row);
      console.log(
        `[opus-full] ${row.result.persona.id} overall=${out.grade?.overall ?? "null"} $${out.usd.toFixed(3)}`,
      );
    } catch (e) {
      if (isUsageLimitError(e)) throw e;
      console.error(`[opus-full] fail ${row.result.persona.id}`, e);
    }
  }

  const seedMatch = path.basename(runDir).match(/^(\d+)/);
  const seed = seedMatch ? Number(seedMatch[1]) : 1;
  const reportPath = await writeRunArtifacts({
    runDir,
    scored,
    seed,
    stage,
    previousRunDir: null,
    promptHashes: currentPromptHashes(),
    cost: {
      projected_usd: spend,
      actual_usd: spend,
      per_persona_avg_usd:
        scored.length > 0 ? spend / scored.length : 0,
    },
    lineReuse: [],
    cacheHitRate: null,
    judgePrimary: "opus",
  });
  console.log(`[opus-full] wrote ${reportPath} (spend $${spend.toFixed(2)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
