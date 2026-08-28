import { readFileSync } from "node:fs";
import { getSupabaseAdminClient } from "@/lib/auth/supabase-admin";

function loadDotEnv() {
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
}

async function main() {
  loadDotEnv();
  const sb = getSupabaseAdminClient();
  const { data } = await sb
    .from("llm_calls")
    .select("stage,input_tokens,output_tokens,model,raw_output,created_at,trace_id")
    .eq("stage", "router")
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = (data ?? []).map((row) => {
    const usage = (row.raw_output as { usage?: Record<string, number> } | null)
      ?.usage;
    const input = Number(row.input_tokens ?? 0);
    const cacheRead = Number(usage?.cache_read_input_tokens ?? 0);
    const cacheCreate = Number(usage?.cache_creation_input_tokens ?? 0);
    return {
      trace: String(row.trace_id).slice(0, 8),
      input,
      cacheRead,
      cacheCreate,
      hit_pct: input ? Math.round((1000 * cacheRead) / input) / 10 : 0,
      created: row.created_at,
      model: row.model,
    };
  });
  const totIn = rows.reduce((a, r) => a + r.input, 0);
  const totRead = rows.reduce((a, r) => a + r.cacheRead, 0);
  console.log(
    JSON.stringify(
      {
        n: rows.length,
        hit_pct: totIn ? Math.round((1000 * totRead) / totIn) / 10 : null,
        rows,
      },
      null,
      2,
    ),
  );

  // Also: any gate_retry
  const { data: retries } = await sb
    .from("llm_calls")
    .select("stage,input_tokens,raw_output,created_at")
    .in("stage", ["gate_retry", "router_retry"])
    .order("created_at", { ascending: false })
    .limit(10);
  console.log(
    "retries",
    JSON.stringify(
      (retries ?? []).map((row) => {
        const usage = (row.raw_output as { usage?: Record<string, number> } | null)
          ?.usage;
        const input = Number(row.input_tokens ?? 0);
        const cacheRead = Number(usage?.cache_read_input_tokens ?? 0);
        return {
          stage: row.stage,
          input,
          cacheRead,
          hit_pct: input ? Math.round((1000 * cacheRead) / input) / 10 : 0,
        };
      }),
      null,
      2,
    ),
  );
}

main().catch(console.error);
