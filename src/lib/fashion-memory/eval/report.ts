import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { takeBriefHardsetCounts } from "../intake/consistency-gate";
import type { CheckResult } from "./checks";
import type { RunCostSummary } from "./cost";
import type { PromptHashes } from "./grade-reuse";
import { judgeHasDefaultedDims, type JudgeGrade } from "./judge-prompt";
import { personaCellKey } from "./subset";
import type { PersonaRunResult } from "./run-persona";
import type { LineReuseMetrics } from "../router/voice-line-reuse";
import {
  fullStageSearchMarkdown,
  searchRowsFromResults,
} from "./search-report";

export type ScoredPersona = {
  result: PersonaRunResult;
  checks: CheckResult[];
  judge: JudgeGrade | null;
  judge_opus?: JudgeGrade | null;
  grade_reused?: boolean;
  grade_fingerprint?: string;
  cost_usd?: number;
  file: string;
  judge_failure?: string | null;
};

function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function groupMean(
  rows: ScoredPersona[],
  keyFn: (r: ScoredPersona) => string,
  scoreFn: (r: ScoredPersona) => number | null,
): Array<{ key: string; mean: number; n: number }> {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const s = scoreFn(r);
    if (s == null) continue;
    const k = keyFn(r);
    const arr = map.get(k) ?? [];
    arr.push(s);
    map.set(k, arr);
  }
  return [...map.entries()]
    .map(([key, vals]) => ({
      key,
      mean: Math.round(mean(vals) * 100) / 100,
      n: vals.length,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

type CellDimRow = {
  cell: string;
  n: number;
  not_interrogated: number | null;
  overall: number | null;
  truth_match_pct: number | null;
};

function dimsByCell(
  rows: ScoredPersona[],
  primaryOf: (r: ScoredPersona) => JudgeGrade | null,
): CellDimRow[] {
  const map = new Map<string, ScoredPersona[]>();
  for (const r of rows) {
    const key = personaCellKey(r.result.persona);
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return [...map.entries()]
    .map(([cell, cellRows]) => {
      const judged = cellRows.filter((r) => {
        const g = primaryOf(r);
        return g && !judgeHasDefaultedDims(g);
      });
      const ni = judged
        .map((r) => primaryOf(r)!.not_interrogated.score)
        .filter((s) => s > 0);
      const ov = judged.map((r) => primaryOf(r)!.overall);
      const tmPass = cellRows.filter(
        (r) => r.checks.find((c) => c.id === "truth_match")?.pass,
      ).length;
      return {
        cell,
        n: cellRows.length,
        not_interrogated: ni.length
          ? Math.round(mean(ni) * 100) / 100
          : null,
        overall: ov.length ? Math.round(mean(ov) * 100) / 100 : null,
        truth_match_pct:
          cellRows.length === 0
            ? null
            : Math.round((tmPass / cellRows.length) * 1000) / 10,
      };
    })
    .sort((a, b) => a.cell.localeCompare(b.cell));
}

export async function writeRunArtifacts(params: {
  runDir: string;
  scored: ScoredPersona[];
  seed: number;
  stage: string;
  previousRunDir?: string | null;
  promptHashes: PromptHashes;
  cost: RunCostSummary;
  lineReuse: string[];
  lineReuseMetrics?: LineReuseMetrics;
  lineReuseRatePct?: {
    line_reuse_rate: number;
    retry_rate: number;
    persisted_rate: number;
  };
  cacheHitRate: number | null;
  /**
   * Headline grade. Opus only — Sonnet retired (compresses the top of the scale).
   */
  judgePrimary?: "opus";
}): Promise<string> {
  await mkdir(params.runDir, { recursive: true });
  for (const row of params.scored) {
    const file = path.join(
      params.runDir,
      `${row.result.persona.id}.json`,
    );
    await writeFile(
      file,
      `${JSON.stringify(
        {
          persona: row.result.persona,
          transcript: row.result.transcript,
          brief: row.result.brief,
          checks: row.checks,
          judge: row.judge,
          judge_opus: row.judge_opus ?? row.judge,
          grade_reused: row.grade_reused ?? false,
          grade_fingerprint: row.grade_fingerprint,
          cost_usd: row.cost_usd,
          prompt_hashes: params.promptHashes,
          shopper_leak: row.result.shopper_leak,
          excluded: row.result.excluded,
          error: row.result.error,
          question_rounds: row.result.question_rounds,
          impatient: row.result.impatient,
          traceId: row.result.traceId,
          search_observability: row.result.search_observability,
          lane_distribution: row.result.lane_distribution,
          scoring_weights_version: row.result.scoring_weights_version,
          refinement_mode: row.result.refinement_mode,
          refinement_garments_unchanged: row.result.refinement_garments_unchanged,
          refinement_latency_ms: row.result.refinement_latency_ms,
          refinement_taste_cache_hits: row.result.refinement_taste_cache_hits,
          refinement_taste_calls: row.result.refinement_taste_calls,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    row.file = file;
  }

  const eligible = params.scored.filter(
    (s) => !s.result.excluded && !s.result.shopper_leak && s.result.brief,
  );
  const primaryOf = (s: ScoredPersona): JudgeGrade | null =>
    s.judge_opus ?? s.judge;
  const scoredIn = eligible.filter((s) => {
    const g = primaryOf(s);
    return g != null && !judgeHasDefaultedDims(g);
  });
  const judgeFailed = eligible.filter((s) => {
    const g = primaryOf(s);
    return !g || judgeHasDefaultedDims(g);
  }).length;
  const defaultedRate =
    eligible.length === 0
      ? 0
      : Math.round((judgeFailed / eligible.length) * 1000) / 10;
  const judgedTotalLabel = `${scoredIn.length}/${eligible.length}`;

  const dims = [
    "recognized",
    "asked_right",
    "not_interrogated",
    "no_silent_guess",
    "accuracy",
    "voice",
    "would_proceed",
    "would_buy",
  ] as const;

  const dimMeans = dims
    .map((d) => {
      const scores = scoredIn
        .map((s) => primaryOf(s)![d].score)
        .filter((n) => n > 0);
      if (!scores.length) return null;
      return {
        dim: d,
        mean: Math.round(mean(scores) * 100) / 100,
        n: scores.length,
      };
    })
    .filter(
      (
        x,
      ): x is { dim: (typeof dims)[number]; mean: number; n: number } =>
        x != null,
    );

  // Headline = Opus (Sonnet retired).
  const overallMean = scoredIn.length
    ? Math.round(mean(scoredIn.map((s) => primaryOf(s)!.overall)) * 100) / 100
    : 0;

  const opusRegraded = scoredIn;
  const opusOverallMean = overallMean;

  const histogram: Record<string, number> = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };
  for (const s of scoredIn) {
    for (const d of dims) {
      const sc = primaryOf(s)![d].score;
      if (sc >= 1 && sc <= 5) histogram[String(sc)]!++;
    }
  }

  const checkIds = [
    ...new Set(params.scored.flatMap((s) => s.checks.map((c) => c.id))),
  ];
  const checkRates = checkIds.map((id) => {
    const rows = params.scored.filter((s) => !s.result.excluded);
    const hits = rows.filter((s) => s.checks.find((c) => c.id === id)?.pass);
    return {
      id,
      pass_rate:
        rows.length === 0
          ? 0
          : Math.round((hits.length / rows.length) * 1000) / 10,
      n: rows.length,
    };
  });

  const cellTable = dimsByCell(eligible, primaryOf);

  const worst = [...scoredIn]
    .sort((a, b) => primaryOf(a)!.overall - primaryOf(b)!.overall)
    .slice(0, 10);

  const byRequest = groupMean(
    scoredIn,
    (r) => r.result.persona.truth.request_type,
    (r) => primaryOf(r)!.overall,
  );
  const byProfile = groupMean(
    scoredIn,
    (r) => r.result.persona.profile.state,
    (r) => primaryOf(r)!.overall,
  );
  const byLang = groupMean(
    scoredIn,
    (r) => r.result.persona.language,
    (r) => primaryOf(r)!.overall,
  );
  const byPatience = groupMean(
    scoredIn,
    (r) => r.result.persona.patience,
    (r) => primaryOf(r)!.overall,
  );

  let diffSection = "_No previous run for this seed._\n";
  if (params.previousRunDir) {
    try {
      const prevReport = await readFile(
        path.join(params.previousRunDir, "summary.json"),
        "utf8",
      );
      const prev = JSON.parse(prevReport) as {
        overall_mean?: number;
        check_rates: Array<{ id: string; pass_rate: number }>;
      };
      const prevOpus = prev.overall_mean ?? 0;
      const deltas = checkRates.map((c) => {
        const p = prev.check_rates.find((x) => x.id === c.id);
        return {
          id: c.id,
          delta: Math.round((c.pass_rate - (p?.pass_rate ?? 0)) * 10) / 10,
        };
      });
      diffSection = [
        `Previous Opus mean: ${prevOpus} → now ${overallMean} (Δ ${Math.round((overallMean - prevOpus) * 100) / 100})`,
        "",
        "| check | Δ pass% |",
        "|---|---:|",
        ...deltas.map((d) => `| ${d.id} | ${d.delta} |`),
      ].join("\n");
    } catch {
      diffSection = "_Could not load previous summary._\n";
    }
  }

  const leaks = params.scored.filter((s) => s.result.shopper_leak).length;
  const hardsetCounts = takeBriefHardsetCounts();
  const hardsetLines = Object.entries(hardsetCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([gap, n]) => `| ${gap} | ${n} |`);

  const lineReuseLabel =
    params.lineReuse.length > 0
      ? params.lineReuse.join(", ")
      : "_(none)_";
  const rates = params.lineReuseRatePct;
  const metrics = params.lineReuseMetrics;
  const rateLine = rates
    ? `- line_reuse rate: **${rates.line_reuse_rate}%** · retry: **${rates.retry_rate}%** · persisted: **${rates.persisted_rate}%**` +
      (metrics
        ? ` _(flagged ${metrics.flagged}/${metrics.spoken_turns}, retries ${metrics.retries}, persisted ${metrics.persisted})_`
        : "")
    : "- line_reuse rates: _(not wired)_";

  const cacheLabel =
    params.cacheHitRate == null
      ? "_(not wired)_"
      : `${params.cacheHitRate}%`;

  const searchRows = searchRowsFromResults(params.scored.map((s) => s.result));
  const searchSection =
    params.stage === "full" ? `\n${fullStageSearchMarkdown(searchRows)}\n` : "";

  const md = `# Appointment eval report

- judged/total: **${judgedTotalLabel}**
- **defaulted_rate: ${defaultedRate}%**
- cost: projected **$${params.cost.projected_usd.toFixed(2)}** / actual **$${params.cost.actual_usd.toFixed(2)}**
- cache_hit_rate: ${cacheLabel}
- line_reuse samples: ${lineReuseLabel}
${rateLine}
- seed: **${params.seed}** · stage: **${params.stage}**
- personas: ${params.scored.length} (eligible ${eligible.length}, leaks excluded ${leaks})
- judge: **Opus** (Sonnet retired)
- **Opus mean: ${overallMean}**
${searchSection}
## Dims by cell (profile.state × request_type) — Opus

| cell | n | not_interrogated | truth_match% | overall |
|---|---:|---:|---:|---:|
${cellTable
  .map(
    (c) =>
      `| ${c.cell} | ${c.n} | ${c.not_interrogated ?? "-"} | ${c.truth_match_pct ?? "-"} | ${c.overall ?? "-"} |`,
  )
  .join("\n")}

## Dimension means (Opus)

| dim | mean | n (judged) |
|---|---:|---:|
${dimMeans.map((d) => `| ${d.dim} | ${d.mean} | ${d.n} |`).join("\n")}

## Score histogram (all dims, Opus judged only)

| score | count |
|---|---:|
${Object.entries(histogram)
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join("\n")}

## By request_type

| key | mean | n |
|---|---:|---:|
${byRequest.map((r) => `| ${r.key} | ${r.mean} | ${r.n} |`).join("\n")}

## By profile.state

| key | mean | n |
|---|---:|---:|
${byProfile.map((r) => `| ${r.key} | ${r.mean} | ${r.n} |`).join("\n")}

## By language

| key | mean | n |
|---|---:|---:|
${byLang.map((r) => `| ${r.key} | ${r.mean} | ${r.n} |`).join("\n")}

## By patience

| key | mean | n |
|---|---:|---:|
${byPatience.map((r) => `| ${r.key} | ${r.mean} | ${r.n} |`).join("\n")}

## Deterministic pass rates

| check | pass% | n |
|---|---:|---:|
${checkRates.map((c) => `| ${c.id} | ${c.pass_rate} | ${c.n} |`).join("\n")}

## brief_hardset counts (chip→brief)

| gap | n |
|---|---:|
${hardsetLines.length ? hardsetLines.join("\n") : "| _(none)_ | 0 |"}

## Worst 10

${worst
  .map(
    (w, i) =>
      `### ${i + 1}. ${w.result.persona.id} (Opus overall ${primaryOf(w)!.overall})\n` +
      `- file: \`${path.basename(w.file)}\`\n` +
      `- worst: “${primaryOf(w)!.worst_moment.quote}”\n` +
      `- better: ${primaryOf(w)!.worst_moment.better}\n`,
  )
  .join("\n")}

## Diff vs previous same seed

${diffSection}
`;

  await writeFile(path.join(params.runDir, "report.md"), md, "utf8");
  await writeFile(
    path.join(params.runDir, "summary.json"),
    `${JSON.stringify(
      {
        seed: params.seed,
        stage: params.stage,
        defaulted_rate: defaultedRate,
        judged: scoredIn.length,
        eligible: eligible.length,
        judged_total: judgedTotalLabel,
        judge_primary: "opus",
        overall_mean: overallMean,
        opus_regraded: opusRegraded.length,
        opus_overall_mean: opusOverallMean,
        dim_means: dimMeans,
        dims_by_cell: cellTable,
        score_histogram: histogram,
        check_rates: checkRates,
        brief_hardset: hardsetCounts,
        leaks,
        scored: scoredIn.length,
        total: params.scored.length,
        prompt_hashes: params.promptHashes,
        line_reuse: params.lineReuse,
        line_reuse_metrics: params.lineReuseMetrics ?? null,
        line_reuse_rate_pct: params.lineReuseRatePct ?? null,
        cache_hit_rate: params.cacheHitRate,
        cost: params.cost,
        search: searchRows,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return path.join(params.runDir, "report.md");
}

export async function findPreviousRunDir(
  runsRoot: string,
  seed: number,
  currentDir: string,
): Promise<string | null> {
  try {
    const entries = await readdir(runsRoot, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith(`${seed}-`))
      .map((e) => e.name)
      .sort();
    const prev = dirs.filter((d) => path.join(runsRoot, d) !== currentDir).at(-1);
    return prev ? path.join(runsRoot, prev) : null;
  } catch {
    return null;
  }
}
