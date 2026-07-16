#!/usr/bin/env npx tsx
/**
 * Scaffold an e2e scenario from a production fashion trace.
 *
 * Usage:
 *   npx tsx scripts/trace-to-e2e.ts <traceId> [--out e2e/scenarios/e2e-from-trace.ts]
 *   npx tsx scripts/trace-to-e2e.ts <traceId> --file dump.json
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

type TraceDump = {
  trace_id: string;
  llm_calls?: Array<{
    stage: string;
    raw_output?: { content?: Array<{ type: string; name?: string; input?: unknown }> };
  }>;
  conversation?: Array<{ role: string; content: string }>;
  catalog_products?: Array<{
    id?: string;
    title?: string;
    priceUsd?: number;
    gender?: string;
    color?: string;
    size?: string;
    category?: string;
    shopName?: string;
  }>;
};

async function loadPrismaConversation(traceId: string): Promise<TraceDump["conversation"]> {
  if (!process.env.DATABASE_URL) return undefined;
  try {
    const { prisma } = await import("@/lib/ai-chat/db");
    const msg = await prisma.message.findFirst({
      where: {
        metadata: { path: ["fashionRouter", "trace_id"], equals: traceId },
      },
      orderBy: { createdAt: "asc" },
      select: { conversationId: true },
    });
    if (!msg?.conversationId) return undefined;

    const rows = await prisma.message.findMany({
      where: { conversationId: msg.conversationId },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
      take: 20,
    });
    return rows.map((r) => ({ role: r.role, content: r.content }));
  } catch {
    return undefined;
  }
}

function catalogFromTraceProducts(
  products: TraceDump["catalog_products"],
): string {
  if (!products?.length) {
    return `{
    relevant: baseMensCatalog.relevant,
    // TODO: replace with products extracted from trace catalog search raw results
  }`;
  }

  const lines = products.map((p) => {
    const id = p.id ?? `gid://shopify/Product/trace_${Math.random().toString(36).slice(2, 8)}`;
    const title = p.title ?? "Trace Product";
    const opts: string[] = [];
    if (p.priceUsd != null) opts.push(`priceUsd: ${p.priceUsd}`);
    if (p.gender) opts.push(`gender: ${JSON.stringify(p.gender)}`);
    if (p.color) opts.push(`color: ${JSON.stringify(p.color)}`);
    if (p.size) opts.push(`size: ${JSON.stringify(p.size)}`);
    if (p.category) opts.push(`category: ${JSON.stringify(p.category)}`);
    if (p.shopName) opts.push(`shopName: ${JSON.stringify(p.shopName)}`);
    return `    makeProduct(${JSON.stringify(id)}, ${JSON.stringify(title)}, { ${opts.join(", ")} })`;
  });

  return `{
    relevant: [
${lines.join(",\n")},
    ],
  }`;
}

async function loadTrace(traceId: string, file?: string): Promise<TraceDump> {
  if (file) {
    const { readFileSync } = await import("node:fs");
    return JSON.parse(readFileSync(file, "utf8")) as TraceDump;
  }

  const conversation = await loadPrismaConversation(traceId);

  if (!process.env.DATABASE_URL && !process.env.SUPABASE_URL) {
    return {
      trace_id: traceId,
      llm_calls: [],
      conversation: conversation ?? [
        { role: "user", content: "TODO: paste user message from trace" },
      ],
      catalog_products: [],
    };
  }

  const { fashionMemoryDb } = await import("@/lib/fashion-memory/db");
  const db = fashionMemoryDb();
  const { data: calls } = await db
    .from("llm_calls")
    .select("stage, raw_output")
    .eq("trace_id", traceId)
    .order("created_at", { ascending: true });

  const { data: events } = await db
    .from("pipeline_events")
    .select("stage, payload")
    .eq("trace_id", traceId)
    .order("created_at", { ascending: true });

  const catalog_products: TraceDump["catalog_products"] = [];
  for (const ev of events ?? []) {
    const payload = ev.payload as Record<string, unknown> | null;
    const slots = payload?.slots as Array<{ products?: Array<Record<string, unknown>> }> | undefined;
    if (!slots) continue;
    for (const slot of slots) {
      for (const p of slot.products ?? []) {
        const price = p.price as { amount?: number } | undefined;
        catalog_products.push({
          id: String(p.id ?? p.product_id ?? ""),
          title: String(p.title ?? "Product"),
          priceUsd: price?.amount,
          gender: String(p.gender ?? ""),
          color: String((p.color as string | undefined) ?? ""),
        });
      }
    }
  }

  return {
    trace_id: traceId,
    llm_calls: (calls ?? []) as TraceDump["llm_calls"],
    conversation:
      conversation ??
      [{ role: "user", content: "TODO: fetch from prisma message window" }],
    catalog_products,
  };
}

function recordingsFromTrace(trace: TraceDump) {
  const router: Array<{ stage: string; toolName: string; input: Record<string, unknown> }> = [];
  const planner: typeof router = [];
  const extraction: typeof router = [];
  const curation: typeof router = [];

  for (const call of trace.llm_calls ?? []) {
    const tool = call.raw_output?.content?.find((b) => b.type === "tool_use");
    if (!tool?.name || !tool.input) continue;
    const rec = {
      stage: call.stage,
      toolName: tool.name,
      input: tool.input as Record<string, unknown>,
    };
    if (call.stage.startsWith("router")) router.push(rec);
    else if (call.stage.startsWith("planner")) planner.push(rec);
    else if (call.stage === "brand_translate" || call.stage.startsWith("normalize"))
      extraction.push(rec);
    else if (call.stage.startsWith("curation")) curation.push(rec);
  }

  return { router, planner, extraction, curation };
}

function scaffold(trace: TraceDump): string {
  const rec = recordingsFromTrace(trace);
  const slug = trace.trace_id.slice(0, 8);
  const userMsg = trace.conversation?.find((m) => m.role === "user")?.content ?? "TODO";
  const catalogExpr = catalogFromTraceProducts(trace.catalog_products);

  return `import type { E2eScenario } from "../types";
import { baseMensCatalog } from "../../test/fake-ucp/catalogs/base-mens";
import { makeProduct } from "../../test/fake-ucp/make-product";

/** Auto-scaffolded from trace ${trace.trace_id} */
export const e2eFromTrace${slug}: E2eScenario = {
  name: "e2e_from_trace_${slug}",
  description: "Scaffolded from production trace ${trace.trace_id}",
  seed: {},
  catalog: ${catalogExpr},
  llm_recordings: ${JSON.stringify(rec, null, 2)},
  steps: [
    {
      user: ${JSON.stringify(userMsg)},
      expect: {
        route: { move: "ready_to_search" },
        events: { invariantWarningsEmpty: true },
      },
    },
  ],
};
`;
}

async function main() {
  const traceId = process.argv[2];
  if (!traceId) {
    console.error("Usage: npx tsx scripts/trace-to-e2e.ts <traceId> [--out path] [--file dump.json]");
    process.exit(1);
  }
  const outIdx = process.argv.indexOf("--out");
  const fileIdx = process.argv.indexOf("--file");
  const out =
    outIdx >= 0
      ? process.argv[outIdx + 1]!
      : join(process.cwd(), "e2e", "scenarios", `e2e-from-trace-${traceId.slice(0, 8)}.ts`);
  const file = fileIdx >= 0 ? process.argv[fileIdx + 1] : undefined;

  const trace = await loadTrace(traceId, file);
  const ts = scaffold(trace);
  writeFileSync(out, ts);
  console.log(`Wrote ${out}`);
  console.log("Next: review catalog stub + add to e2e/scenarios/index.ts");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
