import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { getSupabaseAdminClient } from "@/lib/auth/supabase-admin";

function loadDotEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2]!.trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1]!]) process.env[m[1]!] = v;
    }
  } catch {
    /* ambient */
  }
}

async function main() {
  loadDotEnv();
  const runDir =
    process.argv[2] ??
    "src/lib/fashion-memory/eval/runs/1-2026-08-27T10-24-30-416Z";
  const ids: string[] = [];
  for (const f of readdirSync(runDir).filter(
    (x) => x.endsWith(".json") && x !== "summary.json",
  )) {
    const j = JSON.parse(readFileSync(path.join(runDir, f), "utf8")) as {
      traceId?: string;
    };
    if (j.traceId) ids.push(j.traceId);
  }
  const sb = getSupabaseAdminClient();
  const byStage: Record<
    string,
    { n: number; input: number; cacheRead: number; cacheCreate: number }
  > = {};
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const { data, error } = await sb
      .from("llm_calls")
      .select("stage,input_tokens,raw_output,model")
      .in("trace_id", chunk);
    if (error) {
      console.error(error);
      break;
    }
    for (const row of data ?? []) {
      const st = String(row.stage);
      if (!byStage[st]) {
        byStage[st] = { n: 0, input: 0, cacheRead: 0, cacheCreate: 0 };
      }
      const b = byStage[st]!;
      b.n++;
      b.input += Number(row.input_tokens ?? 0);
      const usage = (row.raw_output as { usage?: Record<string, number> } | null)
        ?.usage;
      b.cacheRead += Number(usage?.cache_read_input_tokens ?? 0);
      b.cacheCreate += Number(usage?.cache_creation_input_tokens ?? 0);
    }
  }
  const routerStages = [
    "router",
    "router_retry",
    "gate_retry",
    "router_escalated",
  ];
  let input = 0;
  let cacheRead = 0;
  for (const st of routerStages) {
    const b = byStage[st];
    if (!b) continue;
    input += b.input;
    cacheRead += b.cacheRead;
  }
  console.log(
    JSON.stringify(
      {
        runDir,
        traces: ids.length,
        router_hit_rate_pct: input
          ? Math.round((1000 * cacheRead) / input) / 10
          : null,
        router_cache_read: cacheRead,
        router_input: input,
        byStage: Object.fromEntries(
          Object.entries(byStage).map(([k, v]) => [
            k,
            {
              ...v,
              hit_pct: v.input
                ? Math.round((1000 * v.cacheRead) / v.input) / 10
                : 0,
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
