import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createInMemoryPrismaStore,
  installInMemoryPrisma,
  uninstallInMemoryPrisma,
} from "../../../../e2e/harness/in-memory-prisma";
import { runDeterministicChecks } from "./checks";
import {
  estimatePersonaPipelineUsd,
  loadPreviousRunAvgPersonaUsd,
  projectedRunUsd,
} from "./cost";
import {
  generatePersonas,
  loadGoldenPersonas,
  loadKnownClientPersonas,
  loadOrGeneratePersonas,
  stableRunId,
} from "./generate-personas";
import {
  canReuseGrade,
  currentPromptHashes,
  loadPreviousPersonaArtifact,
  transcriptGradeFingerprint,
  withGradeReuseMeta,
  type PromptHashes,
} from "./grade-reuse";
import {
  judgePersonaRunOpus,
} from "./judge";
import {
  judgeHasDefaultedDims,
  type JudgeGrade,
} from "./judge-prompt";
import type { Persona } from "./persona";
import { findPreviousRunDir, writeRunArtifacts, type ScoredPersona } from "./report";
import {
  loadSearchRowsFromRunDir,
  searchRowsFromResults,
  tastePairMarkdown,
} from "./search-report";
import {
  beginLineReuseRun,
  endLineReuseRun,
  lineReuseRates,
  snapshotLineReuseMetrics,
} from "../router/voice-line-reuse";
import { runPersonaAppointment, type EvalStage } from "./run-persona";
import {
  GOLDEN_VISIT_2_ID,
  GOLDEN_VISIT_2_PERSONA,
  runGoldenVisit2,
} from "./golden-visit-2";
import { stratifiedSubset } from "./subset";
import {
  assertOrgSpendLimitRaised,
  fetchOrgSpendHeadroom,
  printOrgSpendHeadroom,
} from "./anthropic-spend";

export type EvalCliOptions = {
  seed: number;
  stage: EvalStage;
  parallelism?: number;
  generateOnly?: boolean;
  skipJudge?: boolean;
  skipGenerate?: boolean;
  goldenOnly?: boolean;
  limit?: number;
  /** Stratified sample size (profile.state × request_type). */
  subset?: number;
  /** Halt when projected or actual spend exceeds this USD ceiling. */
  maxUsd?: number;
  /** Default English-only. e.g. ["fr","ar"] for a later multilingual seed. */
  languages?: Array<"en" | "fr" | "ar">;
  /** Resume an existing run dir (basename), only personas without a brief. */
  resume?: string;
  /** `v3-brand` | `v4-taste` — written to env before scoring. */
  weightsVersion?: "v3-brand" | "v4-taste";
  knownClientOnly?: boolean;
  /** Stage full defaults to golden + known-client; this adds the sampled 60. */
  withSampled?: boolean;
  /** Prior full-stage run dir to pair against (writes s0-s1-comparison.md). */
  compareWith?: string;
  label?: string;
};

export function isUsageLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /\b429\b/.test(msg) ||
    /usage limits?/i.test(msg) ||
    /credit balance is too low/i.test(msg) ||
    /rate.?limit/i.test(msg) ||
    /max-usd/i.test(msg) ||
    /projected cost/i.test(msg)
  );
}

async function personaNeedsResume(
  runDir: string,
  personaId: string,
): Promise<boolean> {
  const file = path.join(runDir, `${personaId}.json`);
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as {
      brief?: unknown;
      error?: string;
    };
    if (raw.error) return true;
    if (!raw.brief) return true;
    return false;
  } catch {
    return true;
  }
}

async function personaNeedsJudge(
  runDir: string,
  personaId: string,
): Promise<boolean> {
  const file = path.join(runDir, `${personaId}.json`);
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as {
      brief?: unknown;
      error?: string;
      excluded?: boolean;
      judge?: JudgeGrade | null;
    };
    if (raw.error || !raw.brief || raw.excluded) return false;
    if (!raw.judge || typeof raw.judge.overall !== "number") return true;
    if (judgeHasDefaultedDims(raw.judge)) return true;
    return false;
  } catch {
    return false;
  }
}

async function loadScoredPersonaFromDisk(
  runDir: string,
  personaId: string,
  stage: EvalStage,
): Promise<ScoredPersona | null> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(runDir, `${personaId}.json`), "utf8"),
    ) as {
      persona: Persona;
      transcript: ScoredPersona["result"]["transcript"];
      brief: ScoredPersona["result"]["brief"];
      checks: ScoredPersona["checks"];
      judge: ScoredPersona["judge"];
      judge_opus?: ScoredPersona["judge_opus"];
      grade_reused?: boolean;
      grade_fingerprint?: string;
      cost_usd?: number;
      prompt_hashes?: PromptHashes;
      shopper_leak: ScoredPersona["result"]["shopper_leak"];
      excluded: boolean;
      error?: string;
      question_rounds: number;
      impatient: boolean;
      traceId: string;
      visit1_transcript?: ScoredPersona["result"]["visit1_transcript"];
      search_observability?: ScoredPersona["result"]["search_observability"];
      lane_distribution?: ScoredPersona["result"]["lane_distribution"];
      scoring_weights_version?: string;
    };
    if (!raw.brief) return null;
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
        visit1_transcript: raw.visit1_transcript,
        search_observability: raw.search_observability,
        lane_distribution: raw.lane_distribution,
        scoring_weights_version: raw.scoring_weights_version,
      },
      checks: raw.checks,
      judge: raw.judge_opus ?? raw.judge,
      judge_opus: raw.judge_opus ?? raw.judge,
      grade_reused: raw.grade_reused,
      grade_fingerprint: raw.grade_fingerprint,
      cost_usd: raw.cost_usd,
      file: path.join(runDir, `${personaId}.json`),
    };
  } catch {
    return null;
  }
}

async function writePersonaArtifact(
  runDir: string,
  row: ScoredPersona,
  promptHashes: PromptHashes,
): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const file = path.join(runDir, `${row.result.persona.id}.json`);
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
        prompt_hashes: promptHashes,
        shopper_leak: row.result.shopper_leak,
        excluded: row.result.excluded,
        error: row.result.error,
        question_rounds: row.result.question_rounds,
        impatient: row.result.impatient,
        traceId: row.result.traceId,
        visit1_transcript: row.result.visit1_transcript,
        search_observability: row.result.search_observability,
        lane_distribution: row.result.lane_distribution,
        scoring_weights_version: row.result.scoring_weights_version,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  row.file = file;
}

async function mapPoolAbortable<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  shouldStop: () => boolean,
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      if (shouldStop()) return;
      const i = next++;
      if (i >= items.length) return;
      if (shouldStop()) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function truthMatchPass(checks: ScoredPersona["checks"]): boolean {
  return checks.find((c) => c.id === "truth_match")?.pass ?? false;
}

async function opusJudgeRow(params: {
  row: ScoredPersona;
  previousRunDir: string | null;
  promptHashes: PromptHashes;
  onSpend: (usd: number) => void;
}): Promise<void> {
  const { row, previousRunDir, promptHashes, onSpend } = params;
  if (row.result.excluded || row.result.shopper_leak || row.result.error) return;

  const fingerprint =
    row.grade_fingerprint ??
    transcriptGradeFingerprint(row.result.transcript);
  row.grade_fingerprint = fingerprint;

  const previous = await loadPreviousPersonaArtifact(
    previousRunDir,
    row.result.persona.id,
  );
  const reusable = previous?.judge_opus ?? previous?.judge ?? null;
  if (
    canReuseGrade({
      fingerprint,
      currentPromptHashes: promptHashes,
      previous,
    }) &&
    reusable
  ) {
    row.grade_reused = true;
    row.judge = withGradeReuseMeta(reusable, true);
    row.judge_opus = row.judge;
    row.cost_usd = (row.cost_usd ?? 0);
    return;
  }

  const out = await judgePersonaRunOpus({
    result: row.result,
    checks: row.checks,
    traceId: row.result.traceId,
  });
  onSpend(out.usd);
  row.judge = out.grade;
  row.judge_opus = out.grade;
  row.cost_usd = (row.cost_usd ?? 0) + out.usd;
}

export async function runAppointmentEval(
  opts: EvalCliOptions,
): Promise<{ runDir: string; reportPath: string; scored: ScoredPersona[] }> {
  if (opts.weightsVersion) {
    process.env.SCORING_WEIGHTS_VERSION = opts.weightsVersion;
  }
  const parallelism =
    opts.parallelism ?? (opts.stage === "full" ? 2 : 6);
  const maxUsd = opts.maxUsd ?? 25;
  const promptHashes = currentPromptHashes();
  const runsRoot = path.join(
    process.cwd(),
    "src/lib/fashion-memory/eval/runs",
  );
  await mkdir(runsRoot, { recursive: true });

  // Every run (including generate-only): print limit + headroom; block until raised.
  {
    const headroom = await fetchOrgSpendHeadroom();
    printOrgSpendHeadroom(headroom);
    if (!opts.generateOnly) assertOrgSpendLimitRaised(headroom);
  }

  if (opts.generateOnly) {
    const gen = await generatePersonas({
      seed: opts.seed,
      useLlm: process.env.EVAL_PERSONA_LLM === "1",
      languages: opts.languages,
    });
    return {
      runDir: path.dirname(gen.path),
      reportPath: gen.path,
      scored: [],
    };
  }

  const golden = await loadGoldenPersonas();
  const knownClient = await loadKnownClientPersonas();
  let sampled: Persona[] = [];
  const fullDefault =
    opts.stage === "full" &&
    !opts.goldenOnly &&
    !opts.knownClientOnly &&
    !opts.withSampled;
  if (opts.knownClientOnly) {
    sampled = [];
  } else if (fullDefault) {
    sampled = [];
  } else if (!opts.goldenOnly) {
    sampled = opts.skipGenerate
      ? await loadOrGeneratePersonas({ seed: opts.seed, useLlm: false })
      : (
          await generatePersonas({
            seed: opts.seed,
            useLlm: process.env.EVAL_PERSONA_LLM === "1",
            languages: opts.languages,
          })
        ).personas;
  }
  let personas: Persona[];
  if (opts.knownClientOnly) {
    personas = knownClient;
  } else if (fullDefault) {
    personas = [...golden, ...knownClient];
  } else if (opts.stage === "full" && opts.withSampled) {
    personas = [...golden, ...knownClient, ...sampled];
  } else {
    personas = [...golden, ...sampled];
  }
  if (
    !opts.knownClientOnly &&
    !personas.some((p) => p.id === GOLDEN_VISIT_2_ID)
  ) {
    personas.push(GOLDEN_VISIT_2_PERSONA);
  }
  const idFilter = process.env.EVAL_PERSONA_IDS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (idFilter?.length) {
    personas = personas.filter((p) => idFilter.includes(p.id));
  }
  if (opts.subset && opts.subset > 0) {
    personas = stratifiedSubset(personas, opts.subset, opts.seed);
    console.log(
      `[eval] subset ${opts.subset}: ${personas.length} personas (stratified)`,
    );
  }
  if (opts.limit && opts.limit > 0) {
    personas = personas.slice(0, opts.limit);
  }

  const runId = opts.resume?.trim() || stableRunId(opts.seed, opts.label);
  const runDir = path.join(runsRoot, runId);
  await mkdir(runDir, { recursive: true });
  console.log(
    `[eval] weights ${process.env.SCORING_WEIGHTS_VERSION ?? "v4-taste"} · ${personas.length} personas · stage ${opts.stage}`,
  );

  const previousRunDir = await findPreviousRunDir(runsRoot, opts.seed, runDir);
  const perPersonaAvg = await loadPreviousRunAvgPersonaUsd(previousRunDir);
  const projectedUsd = projectedRunUsd({
    personaCount: personas.length,
    perPersonaAvgUsd: perPersonaAvg,
  });
  console.log(
    `[eval] projected cost: $${projectedUsd.toFixed(2)} (${personas.length} personas × $${(perPersonaAvg ?? estimatePersonaPipelineUsd(opts.stage)).toFixed(2)} avg)`,
  );

  let judgeOnly = false;
  if (opts.resume) {
    const before = personas.length;
    const needBrief: Persona[] = [];
    for (const p of personas) {
      if (await personaNeedsResume(runDir, p.id)) needBrief.push(p);
    }
    if (needBrief.length) {
      personas = needBrief;
      console.log(
        `[eval] resume ${opts.resume}: ${personas.length}/${before} personas missing brief`,
      );
    } else if (!opts.skipJudge) {
      const needJudge: Persona[] = [];
      for (const p of personas) {
        if (await personaNeedsJudge(runDir, p.id)) needJudge.push(p);
      }
      personas = needJudge;
      judgeOnly = true;
      console.log(
        `[eval] resume ${opts.resume}: ${personas.length}/${before} personas missing judge`,
      );
    } else {
      personas = [];
      console.log(
        `[eval] resume ${opts.resume}: nothing to do (all have briefs)`,
      );
    }
  }

  if (projectedUsd > maxUsd && personas.length > 0) {
    const haltReason = `projected cost $${projectedUsd.toFixed(2)} exceeds --max-usd $${maxUsd}`;
    console.error(`[eval] STOP — ${haltReason}`);
    await writeFile(path.join(runDir, "HALTED.txt"), `${haltReason}\n`, "utf8");
    const reportPath = await writeRunArtifacts({
      runDir,
      scored: [],
      seed: opts.seed,
      stage: opts.stage,
      previousRunDir,
      promptHashes,
      cost: {
        projected_usd: projectedUsd,
        actual_usd: 0,
        per_persona_avg_usd: perPersonaAvg ?? 0,
      },
      lineReuse: [],
      cacheHitRate: null,
    });
    return { runDir, reportPath, scored: [] };
  }

  const store = createInMemoryPrismaStore();
  installInMemoryPrisma(store, { userId: "guest-eval-shared" });
  beginLineReuseRun();

  let haltReason: string | null = null;
  let actualUsd = 0;
  const scoredPartial: ScoredPersona[] = [];

  const onSpend = (usd: number) => {
    actualUsd += usd;
    if (actualUsd > maxUsd && !haltReason) {
      haltReason = `actual cost $${actualUsd.toFixed(2)} exceeds --max-usd $${maxUsd}`;
      console.error(`[eval] STOP — ${haltReason}`);
    }
  };

  try {
    await mapPoolAbortable(
      personas,
      parallelism,
      async (persona) => {
        if (haltReason) return undefined;
        console.log(`[eval] start ${persona.id} (${persona.name})`);

        if (judgeOnly) {
          const existing = await loadScoredPersonaFromDisk(
            runDir,
            persona.id,
            opts.stage,
          );
          if (!existing) {
            console.warn(`[eval] judge-only skip ${persona.id}: no artifact`);
            return undefined;
          }
          try {
            await opusJudgeRow({
              row: existing,
              previousRunDir,
              promptHashes,
              onSpend,
            });
          } catch (e) {
            if (isUsageLimitError(e)) {
              haltReason =
                e instanceof Error ? e.message : "usage limit / 429";
              console.error(
                `[eval] STOP on usage/429 (judge). ${haltReason}`,
              );
              return undefined;
            }
            console.warn(
              `[eval] judge failed ${persona.id}:`,
              e instanceof Error ? e.message : e,
            );
          }
          console.log(
            `[eval] opus ${persona.id} overall=${existing.judge?.overall ?? "-"} reused=${Boolean(existing.grade_reused)}`,
          );
          await writePersonaArtifact(runDir, existing, promptHashes);
          scoredPartial.push(existing);
          return existing;
        }

        let result;
        let extraChecks: Awaited<ReturnType<typeof runDeterministicChecks>> =
          [];
        try {
          if (persona.id === GOLDEN_VISIT_2_ID) {
            const gv = await runGoldenVisit2({
              stage: opts.stage,
              store,
            });
            result = gv.result;
            extraChecks = gv.extraChecks;
          } else {
            result = await runPersonaAppointment({
              persona,
              stage: opts.stage,
              store,
            });
          }
        } catch (e) {
          if (isUsageLimitError(e)) {
            haltReason =
              e instanceof Error ? e.message : "usage limit / 429";
            console.error(
              `[eval] STOP on usage/429 — persisting partial run. ${haltReason}`,
            );
            return undefined;
          }
          throw e;
        }
        if (result.error && isUsageLimitError(result.error)) {
          haltReason = result.error;
          console.error(
            `[eval] STOP on usage/429 — persisting partial run. ${haltReason}`,
          );
        }
        const checks = [
          ...(await runDeterministicChecks(result)),
          ...extraChecks,
        ];
        const searchUsd = result.search_observability?.cost.usd ?? 0;
        if (searchUsd) onSpend(searchUsd);
        const row: ScoredPersona = {
          result,
          checks,
          judge: null,
          judge_opus: null,
          file: "",
          grade_fingerprint: transcriptGradeFingerprint(result.transcript),
          cost_usd: searchUsd || estimatePersonaPipelineUsd(opts.stage),
        };

        if (!opts.skipJudge && !result.excluded && !result.error) {
          try {
            await opusJudgeRow({
              row,
              previousRunDir,
              promptHashes,
              onSpend,
            });
          } catch (e) {
            if (isUsageLimitError(e)) {
              haltReason =
                e instanceof Error ? e.message : "usage limit / 429";
              console.error(
                `[eval] STOP on usage/429 (judge). ${haltReason}`,
              );
            } else {
              console.warn(
                `[eval] judge failed ${persona.id}:`,
                e instanceof Error ? e.message : e,
              );
            }
          }
        }

        console.log(
          `[eval] done ${persona.id} brief=${Boolean(result.brief)} leak=${Boolean(result.shopper_leak)} overall=${row.judge?.overall ?? "-"}`,
        );
        await writePersonaArtifact(runDir, row, promptHashes);
        scoredPartial.push(row);
        if (haltReason) return undefined;
        return row;
      },
      () => Boolean(haltReason),
    );

    let scored = scoredPartial;
    if (opts.resume) {
      const files = await readdir(runDir);
      const byId = new Map(scored.map((s) => [s.result.persona.id, s]));
      for (const f of files) {
        if (!f.endsWith(".json") || f === "summary.json") continue;
        const id = f.replace(/\.json$/, "");
        if (byId.has(id)) continue;
        try {
          const loaded = await loadScoredPersonaFromDisk(runDir, id, opts.stage);
          if (!loaded) continue;
          byId.set(id, loaded);
        } catch {
          /* skip corrupt */
        }
      }
      scored = [...byId.values()];
    }

    const lineReuse = [
      ...new Set(
        scored.flatMap((s) => {
          const c = s.checks.find((x) => x.id === "line_reuse" && !x.pass);
          return c ? [c.reason] : [];
        }),
      ),
    ];
    const lineReuseMetrics = snapshotLineReuseMetrics();
    const lineReuseRatePct = lineReuseRates(lineReuseMetrics);

    const reportPath = await writeRunArtifacts({
      runDir,
      scored,
      seed: opts.seed,
      stage: opts.stage,
      previousRunDir,
      promptHashes,
      cost: {
        projected_usd: projectedUsd,
        actual_usd: Math.round(actualUsd * 100) / 100,
        per_persona_avg_usd:
          scored.length > 0
            ? Math.round((actualUsd / scored.length) * 10_000) / 10_000
            : perPersonaAvg ?? 0,
      },
      lineReuse,
      lineReuseMetrics,
      lineReuseRatePct,
      cacheHitRate: null,
    });
    if (opts.compareWith) {
      const prior = await loadSearchRowsFromRunDir(opts.compareWith);
      const current = searchRowsFromResults(scored.map((s) => s.result));
      const md = tastePairMarkdown(prior, current);
      await writeFile(path.join(runDir, "s0-s1-comparison.md"), md, "utf8");
      console.log(`[eval] pair report: ${path.join(runDir, "s0-s1-comparison.md")}`);
    }
    if (haltReason) {
      await writeFile(
        path.join(runDir, "HALTED.txt"),
        `${haltReason}\n`,
        "utf8",
      );
    }
    return { runDir, reportPath, scored };
  } finally {
    endLineReuseRun();
    uninstallInMemoryPrisma();
  }
}
