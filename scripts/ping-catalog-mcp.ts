#!/usr/bin/env node
/**
 * Probe the Shopify Global Catalog MCP directly, outside the fashion pipeline.
 *
 * Use this to tell a *hanging endpoint* apart from a *too-tight timeout*: the
 * pipeline aborts every `search_catalog` at FASHION_CATALOG_QUERY_TIMEOUT_MS
 * (default 12s), so a healthy endpoint returning in ~1-3s here means the timeout
 * is fine and the earlier hang was upstream.
 *
 * Usage:
 *   npx tsx scripts/ping-catalog-mcp.ts
 *   npx tsx scripts/ping-catalog-mcp.ts "mens oversized black t-shirt" 3
 *   PING_TIMEOUT_MS=8000 npx tsx scripts/ping-catalog-mcp.ts
 *
 * Args:
 *   [query]  Search query (default: "mens t-shirt").
 *   [count]  Number of sequential pings (default: 3).
 */
import {
  getCatalogMcpUrl,
  getCatalogAgentProfileCandidates,
} from "../src/lib/env";
import { accessTokenForCatalogMcp } from "../src/lib/shopify/catalog-auth";
import { searchCatalog } from "../src/lib/shopify/catalog";

// Load .env (Node 20.12+); harmless if the file is absent.
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(
    ".env",
  );
} catch {
  // no .env — rely on the ambient environment
}

const DEFAULT_TIMEOUT_MS = Number(process.env.PING_TIMEOUT_MS ?? "25000");

type PingOutcome = {
  ok: boolean;
  durationMs: number;
  httpStatus: number | null;
  productCount: number | null;
  timedOut: boolean;
  error?: string;
};

async function ping(
  accessToken: string,
  query: string,
  timeoutMs: number,
): Promise<PingOutcome> {
  const started = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  let httpStatus: number | null = null;
  try {
    const res = await searchCatalog(accessToken, query, {}, {
      limit: 10,
      signal,
      onMcpExchange: (exchange) => {
        httpStatus = exchange.httpStatus;
      },
    });
    return {
      ok: true,
      durationMs: Date.now() - started,
      httpStatus,
      productCount: res.products?.length ?? 0,
      timedOut: false,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const timedOut = signal.aborted && durationMs >= timeoutMs - 50;
    return {
      ok: false,
      durationMs,
      httpStatus,
      productCount: null,
      timedOut,
      error: String(err).slice(0, 300),
    };
  }
}

async function main() {
  const query = process.argv[2]?.trim() || "mens t-shirt";
  const count = Math.max(1, Number(process.argv[3] ?? "3") || 3);
  const timeoutMs = Number.isFinite(DEFAULT_TIMEOUT_MS)
    ? DEFAULT_TIMEOUT_MS
    : 12000;

  const url = getCatalogMcpUrl();
  const profiles = getCatalogAgentProfileCandidates();

  console.log("── Catalog MCP config ─────────────────────────────");
  console.log("mcp_url         :", url);
  console.log("agent_profiles  :", profiles.length ? profiles : "(none)");

  let accessToken = "";
  try {
    accessToken = await accessTokenForCatalogMcp();
    console.log(
      "access_token    :",
      accessToken ? `present (${accessToken.length} chars)` : "(empty)",
    );
  } catch (err) {
    console.log("access_token    : FAILED to mint —", String(err).slice(0, 200));
  }

  console.log("query           :", JSON.stringify(query));
  console.log("timeout_ms      :", timeoutMs, "(matches pipeline default 25000)");
  console.log("pings           :", count);
  console.log("───────────────────────────────────────────────────\n");

  const outcomes: PingOutcome[] = [];
  for (let i = 0; i < count; i++) {
    const o = await ping(accessToken, query, timeoutMs);
    outcomes.push(o);
    const verdict = o.ok
      ? `OK   http=${o.httpStatus} products=${o.productCount}`
      : o.timedOut
        ? `TIMEOUT (no response in ${timeoutMs}ms) http=${o.httpStatus ?? "none"}`
        : `ERROR http=${o.httpStatus ?? "none"} ${o.error}`;
    console.log(
      `ping ${i + 1}/${count}  ${String(o.durationMs).padStart(6)}ms  ${verdict}`,
    );
  }

  const oks = outcomes.filter((o) => o.ok);
  const timeouts = outcomes.filter((o) => o.timedOut);
  const errors = outcomes.filter((o) => !o.ok && !o.timedOut);
  const durations = outcomes.map((o) => o.durationMs).sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)] ?? 0;

  console.log("\n── Summary ────────────────────────────────────────");
  console.log(`ok=${oks.length} timeout=${timeouts.length} error=${errors.length}`);
  console.log(`median_latency=${median}ms`);
  if (timeouts.length === outcomes.length) {
    console.log(
      "\nAll pings hit the deadline with no response → Catalog MCP is hanging.\n" +
        "Confirm SHOPIFY_CATALOG_CLIENT_ID/SECRET mint a Bearer token.",
    );
  } else if (oks.length && oks.every((o) => o.durationMs < 8000)) {
    console.log(
      "\nEndpoint is healthy (sub-8s). The 25s per-variant budget is not too tight.",
    );
  } else if (oks.length) {
    console.log(
      "\nEndpoint is responding but slow. Keep FASHION_CATALOG_QUERY_TIMEOUT_MS ≥ median×1.5.",
    );
  }
  console.log("───────────────────────────────────────────────────");

  process.exit(timeouts.length === outcomes.length ? 1 : 0);
}

main().catch((err) => {
  console.error("ping-catalog-mcp failed:", err);
  process.exit(1);
});
