/**
 * Export 10 judged transcripts spanning overall 2.0–4.5 for human calibration.
 *   npx tsx scripts/export-judge-calibration.ts
 */
import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const DIMS = [
  "recognized",
  "asked_right",
  "not_interrogated",
  "no_silent_guess",
  "accuracy",
  "voice",
  "would_proceed",
] as const;

const SOURCE_RUNS = [
  "1-2026-08-26T09-18-59-339Z",
  "2-2026-08-27T08-11-34-446Z",
];
const TARGETS = [2.0, 2.3, 2.6, 2.9, 3.2, 3.5, 3.8, 4.1, 4.3, 4.5];

type DimBlock = { score: number; why?: string };

async function main() {
  const root = path.join("src/lib/fashion-memory/eval");
  const outDir = path.join(root, "calibration");
  await mkdir(outDir, { recursive: true });

  const rows: Array<{
    id: string;
    source_run: string;
    overall: number;
    persona: {
      name: string;
      opening_message: string;
      truth: { request_type: string };
      specificity: string;
      profile: { state: string };
    };
    transcript: Array<{
      role: string;
      content: string;
      router?: {
        move?: string;
        questions?: Array<{ gap: string; text: string }>;
      };
    }>;
    brief: unknown;
    judge: Record<string, DimBlock | number | undefined>;
    question_rounds: number;
  }> = [];

  for (const sourceRun of SOURCE_RUNS) {
    const runDir = path.join(root, "runs", sourceRun);
    for (const f of await readdir(runDir)) {
      if (!f.endsWith(".json") || f === "summary.json") continue;
      const j = JSON.parse(await readFile(path.join(runDir, f), "utf8")) as {
        persona: (typeof rows)[0]["persona"];
        transcript: (typeof rows)[0]["transcript"];
        brief: unknown;
        judge?: { overall?: number } & Record<string, DimBlock>;
        question_rounds?: number;
      };
      const overall = j.judge?.overall;
      if (typeof overall !== "number") continue;
      if (overall < 2.0 || overall > 4.5) continue;
      rows.push({
        id: f.replace(/\.json$/, ""),
        source_run: sourceRun,
        overall,
        persona: j.persona,
        transcript: j.transcript,
        brief: j.brief,
        judge: j.judge as Record<string, DimBlock | number | undefined>,
        question_rounds: j.question_rounds ?? 0,
      });
    }
  }
  rows.sort((a, b) => a.overall - b.overall);

  const picked: typeof rows = [];
  const used = new Set<string>();
  for (const t of TARGETS) {
    let best: (typeof rows)[0] | null = null;
    let bestD = 99;
    for (const r of rows) {
      if (used.has(r.id)) continue;
      const d = Math.abs(r.overall - t);
      if (d < bestD) {
        best = r;
        bestD = d;
      }
    }
    if (best) {
      used.add(best.id);
      picked.push(best);
    }
  }
  picked.sort((a, b) => a.overall - b.overall);

  for (const f of await readdir(outDir)) {
    if (f.startsWith("cal-") || f === "INDEX.md" || f === "index.json") {
      await unlink(path.join(outDir, f));
    }
  }

  const index: Array<{
    file: string;
    calibration_id: string;
    persona_id: string;
    source_run: string;
    cell: string;
    judge_overall: number;
    dims: Record<string, number | null>;
  }> = [];

  for (let i = 0; i < picked.length; i++) {
    const r = picked[i]!;
    const dims: Record<string, DimBlock | null> = {};
    for (const d of DIMS) {
      const block = r.judge[d];
      dims[d] =
        block && typeof block === "object" && "score" in block
          ? { score: block.score, why: block.why }
          : null;
    }
    const calibration_id = `cal-${String(i + 1).padStart(2, "0")}`;
    const cell = `${r.persona.truth.request_type}×${r.persona.specificity}`;
    const artifact = {
      calibration_id,
      source_run: r.source_run,
      persona_id: r.id,
      persona_name: r.persona.name,
      cell,
      profile_state: r.persona.profile.state,
      judge_overall: r.overall,
      judge_dimensions: dims,
      human_overall: null,
      human_dimensions: null,
      human_notes: null,
      agreement: null,
      truth: r.persona.truth,
      opening_message: r.persona.opening_message,
      brief: r.brief,
      question_rounds: r.question_rounds,
      transcript: r.transcript.map((t) => ({
        role: t.role,
        content: t.content,
        move: t.router?.move,
        questions:
          t.router?.move === "ask_clarification"
            ? (t.router.questions ?? []).map((q) => ({
                gap: q.gap,
                text: q.text,
              }))
            : undefined,
      })),
    };
    const file = `${calibration_id}-${r.id.slice(0, 12)}.json`;
    await writeFile(
      path.join(outDir, file),
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    index.push({
      file,
      calibration_id,
      persona_id: r.id,
      source_run: r.source_run,
      cell,
      judge_overall: r.overall,
      dims: Object.fromEntries(DIMS.map((d) => [d, dims[d]?.score ?? null])),
    });
    console.log(
      calibration_id,
      r.overall.toFixed(2),
      cell,
      r.source_run.slice(0, 12),
    );
  }

  const indexMd = `# Judge calibration pack

Sources: seed 1 + seed 2 judged runs. Span: judge overall **2.0–4.5**.

**Stop for human pass.** Do not tune the router until human↔judge agreement ≥ 80%.

For each JSON: fill \`human_overall\`, \`human_dimensions\` (same 7 dims), \`human_notes\`; then set \`agreement\`.

| id | judge overall | cell | persona | run | file |
|---|---:|---|---|---|---|
${index
  .map(
    (x) =>
      `| ${x.calibration_id} | ${x.judge_overall.toFixed(2)} | ${x.cell} | ${x.persona_id.slice(0, 12)} | ${x.source_run.slice(0, 16)}… | ${x.file} |`,
  )
  .join("\n")}

## Per-dimension judge scores

| id | rec | ask | not_int | no_silent | acc | voice | proceed |
|---|---:|---:|---:|---:|---:|---:|---:|
${index
  .map(
    (x) =>
      `| ${x.calibration_id} | ${x.dims.recognized} | ${x.dims.asked_right} | ${x.dims.not_interrogated} | ${x.dims.no_silent_guess} | ${x.dims.accuracy} | ${x.dims.voice} | ${x.dims.would_proceed} |`,
  )
  .join("\n")}
`;
  await writeFile(path.join(outDir, "INDEX.md"), indexMd);
  await writeFile(
    path.join(outDir, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  console.log(`wrote ${picked.length} → ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
