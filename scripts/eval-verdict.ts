#!/usr/bin/env npx tsx
/**
 * Verdict-card eval.
 *
 *   npm run eval:verdict                 # JSON fixtures, card-text checks
 *   npm run eval:verdict -- --judge      # + LLM grades on those fixtures
 *   npm run eval:verdict -- --generate   # Prisma-seed 6 profiles, run J4, Jaccard
 *
 * Similarity is scored only on --generate. JSON fixtures are card-text only.
 * Effort stays `low`. If the judge bar (≥4) fails after two copy iterations,
 * raise VERDICT_TIMEOUT_MS before touching reasoning effort.
 */
try {
  process.loadEnvFile?.(".env");
} catch {
  /* ambient env */
}

import { GENERATED_SIMILARITY_MAX } from "@/lib/photo-analysis/eval/similarity";
import { runVerdictEval } from "@/lib/photo-analysis/eval/run";

async function main() {
  const judge = process.argv.includes("--judge");
  const generate = process.argv.includes("--generate");
  const result = await runVerdictEval({ judge, generate });
  for (const row of result.rows) {
    const fail = row.checks.filter((c) => !c.ok).map((c) => c.id);
    const grade = row.grade
      ? `  judge ${row.grade.saw_me}/${row.grade.believe_it}/${row.grade.want_the_offer}`
      : "";
    console.log(
      `${row.passed ? "ok" : "FAIL"}  ${row.id}${fail.length ? `  ${fail.join(",")}` : ""}${grade}`,
    );
  }
  if (result.similarity) {
    console.log(
      `similarity openings max ${result.similarity.maxOpening.toFixed(3)}  rules max ${result.similarity.maxRules.toFixed(3)}  (bar ${GENERATED_SIMILARITY_MAX})`,
    );
    console.log(JSON.stringify(result.similarity.openings, null, 2));
  }
  if (result.mean != null) {
    console.log(`mean ${result.mean.toFixed(2)} (bar 4.0)`);
  }
  if (!result.passed) process.exit(1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
