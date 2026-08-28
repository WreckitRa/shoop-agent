try {
  process.loadEnvFile?.(".env");
} catch {
  /* ambient */
}
import { readFile } from "node:fs/promises";
import { judgePersonaRun } from "@/lib/fashion-memory/eval/judge";
import type { PersonaRunResult } from "@/lib/fashion-memory/eval/run-persona";

async function main() {
  const raw = JSON.parse(
    await readFile(
      "src/lib/fashion-memory/eval/runs/1-2026-08-27T09-22-14-850Z/03aaaf481cdbaaa0.json",
      "utf8",
    ),
  ) as PersonaRunResult & { checks?: unknown[]; stage?: string };

  const grade = await judgePersonaRun({
    result: {
      ...raw,
      stage: (raw.stage as "router" | "full") ?? "router",
      excluded: Boolean(raw.excluded),
    },
    checks: Array.isArray(raw.checks) ? raw.checks : [],
    traceId: raw.traceId || crypto.randomUUID(),
  });
  console.log(JSON.stringify(grade, null, 2));
  if (grade) {
    const dims = [
      "recognized",
      "asked_right",
      "not_interrogated",
      "no_silent_guess",
      "accuracy",
      "voice",
      "would_proceed",
    ] as const;
    console.log(
      "defaulted",
      dims.some((d) => grade[d].why === "dimension defaulted"),
    );
    console.log(
      "scores",
      Object.fromEntries(dims.map((d) => [d, grade[d].score])),
    );
  } else {
    console.log("GRADE_NULL");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
