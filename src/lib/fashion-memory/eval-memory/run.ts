import {
  createInMemoryPrismaStore,
  installInMemoryPrisma,
  uninstallInMemoryPrisma,
} from "../../../../e2e/harness/in-memory-prisma";
import { isSupabaseAuthConfigured } from "@/lib/auth/env";
import {
  fetchOrgSpendHeadroom,
  printOrgSpendHeadroom,
} from "../eval/anthropic-spend";
import { MEMORY_CASES } from "./cases";
import { runMemoryCase } from "./driver";
import { mergeFlakeAttempt, shouldRetryCase } from "./flake";
import { aggregateResults, writeMemoryRun } from "./report";
import { closeSession, openSession } from "./seed";
import type { CaseResult, MemoryEvalAggregate, StoreKind } from "./types";

export type MemoryEvalCli = {
  store: "supabase" | "local" | "both";
  caseIds?: string[];
};

function selectedCases(ids?: string[]) {
  if (!ids?.length) return MEMORY_CASES;
  const set = new Set(ids);
  const hit = MEMORY_CASES.filter((c) => set.has(c.id));
  const missing = ids.filter((id) => !hit.some((c) => c.id === id));
  if (missing.length) throw new Error(`unknown cases: ${missing.join(", ")}`);
  return hit;
}

async function runStore(
  kind: StoreKind,
  cases: typeof MEMORY_CASES,
): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  for (const cse of cases) {
    const firstSession = await openSession(kind);
    let result: CaseResult;
    try {
      process.stdout.write(`  ${cse.id} [${kind}] ... `);
      result = await runMemoryCase({
        cse,
        session: firstSession,
        traceId: `eval-memory:${cse.id}:${kind}`,
      });
    } finally {
      await closeSession(firstSession);
    }

    if (shouldRetryCase(result)) {
      process.stdout.write("retry ... ");
      const secondSession = await openSession(kind);
      try {
        const second = await runMemoryCase({
          cse,
          session: secondSession,
          traceId: `eval-memory:${cse.id}:${kind}:retry`,
        });
        result = mergeFlakeAttempt(result, second);
      } finally {
        await closeSession(secondSession);
      }
    }

    console.log(
      result.skipped
        ? `SKIP ${result.skipped}`
        : result.error && !result.pass
          ? `ERROR ${result.error}`
          : result.pass
            ? result.flake
              ? "FLAKE PASS"
              : "PASS"
            : "FAIL",
    );
    out.push(result);
  }
  return out;
}

export async function runMemoryEval(
  opts: MemoryEvalCli,
): Promise<{
  runDir: string;
  reportPath: string;
  results: CaseResult[];
  aggregate: MemoryEvalAggregate;
}> {
  const cases = selectedCases(opts.caseIds);
  const stores: StoreKind[] =
    opts.store === "both" ? ["supabase", "local"] : [opts.store];

  if (stores.includes("supabase") && !isSupabaseAuthConfigured()) {
    throw new Error(
      "supabase store requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY",
    );
  }

  try {
    const headroom = await fetchOrgSpendHeadroom();
    printOrgSpendHeadroom(headroom);
  } catch (err) {
    console.log(
      `[eval] spend headroom unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const prismaStore = createInMemoryPrismaStore();
  installInMemoryPrisma(prismaStore);

  try {
    const results: CaseResult[] = [];
    for (const kind of stores) {
      console.log(`\nstore ${kind} (${cases.length} cases)`);
      results.push(...(await runStore(kind, cases)));
    }
    const aggregate = aggregateResults(results);
    const written = await writeMemoryRun({ results, aggregate });
    return { ...written, results, aggregate };
  } finally {
    uninstallInMemoryPrisma();
  }
}
