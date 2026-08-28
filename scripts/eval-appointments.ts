#!/usr/bin/env npx tsx
/**
 * Shoop appointment eval runner.
 *
 *   npm run eval:appointments -- --seed 1 --stage router
 *   npm run eval:appointments -- --seed 1 --generate-only
 *   npm run eval:appointments -- --seed 1 --stage full --skip-judge --weights v3-brand --label v3-brand
 *   npm run eval:appointments -- --seed 1 --stage full --skip-judge --weights v4-taste --label v4-taste --compare-with <v3-run-dir>
 *   npm run eval:appointments -- --seed 1 --resume 1-2026-08-26T09-18-59-339Z --skip-generate --skip-judge
 *   npm run eval:appointments -- --seed 1 --subset 12 --max-usd 10
 */
try {
  process.loadEnvFile?.(".env");
} catch {
  /* ambient env */
}

import { runAppointmentEval } from "@/lib/fashion-memory/eval/run";
import type { EvalStage } from "@/lib/fashion-memory/eval/run-persona";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  const seed = Number(arg("--seed") ?? "1");
  if (!Number.isFinite(seed)) throw new Error("--seed must be a number");
  const stage = (arg("--stage") ?? "router") as EvalStage;
  if (stage !== "router" && stage !== "full") {
    throw new Error("--stage must be router|full");
  }
  const parallelism = arg("--parallelism")
    ? Number(arg("--parallelism"))
    : undefined;
  const limit = arg("--limit") ? Number(arg("--limit")) : undefined;
  const languagesRaw = arg("--languages");
  const languages = languagesRaw
    ? (languagesRaw.split(",").map((s) => s.trim()).filter(Boolean) as Array<
        "en" | "fr" | "ar"
      >)
    : undefined;
  const resume = arg("--resume");
  const subset = arg("--subset") ? Number(arg("--subset")) : undefined;
  const maxUsd = arg("--max-usd") ? Number(arg("--max-usd")) : undefined;

  const weightsRaw = arg("--weights");
  const weightsVersion =
    weightsRaw === "v3-brand" || weightsRaw === "v4-taste"
      ? weightsRaw
      : undefined;
  if (weightsRaw && !weightsVersion) {
    throw new Error("--weights must be v3-brand|v4-taste");
  }
  if (weightsVersion) process.env.SCORING_WEIGHTS_VERSION = weightsVersion;

  const result = await runAppointmentEval({
    seed,
    stage,
    parallelism,
    generateOnly: has("--generate-only"),
    skipJudge: has("--skip-judge"),
    skipGenerate: has("--skip-generate"),
    goldenOnly: has("--golden-only"),
    knownClientOnly: has("--known-client-only"),
    withSampled: has("--with-sampled"),
    limit,
    subset,
    maxUsd,
    languages,
    resume,
    weightsVersion,
    compareWith: arg("--compare-with"),
    label: arg("--label"),
  });

  console.log(`\nRun dir: ${result.runDir}`);
  console.log(`Report:  ${result.reportPath}`);
  console.log(`Scored:  ${result.scored.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
