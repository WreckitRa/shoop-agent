import type { SearchObservability } from "@/lib/fashion-memory/observability/search-observability";
import type { PersonaRunResult } from "./run-persona";
import type { LaneCounts } from "./live-search";

export type FullStageSearchRow = {
  persona_id: string;
  name: string;
  state: string;
  anchor: string;
  looks_wanted: number;
  weights_version: string;
  taste_fit_mean: number | null;
  lanes: LaneCounts;
  lanes_by_slot: NonNullable<SearchObservability["lanes_by_slot"]>;
  funnel: {
    mcp_hits: number;
    hard_drop_survivors: number;
    hydrated_verified: number;
    imaged: number;
    heroes: number;
  };
  latency: SearchObservability["latency"] | null;
  rerank: {
    calls: number;
    aborted: number;
    rated: number;
    input_tokens: number;
    output_tokens: number;
  };
  cost_usd: number;
  error?: string;
  refinement_mode?: PersonaRunResult["refinement_mode"];
  refinement_latency_ms?: number | null;
  refinement_taste_cache_hits?: number;
  refinement_taste_calls?: number;
  mcp_query?: NonNullable<SearchObservability["mcp_query"]>;
};

function looksWanted(persona: PersonaRunResult["persona"]): number {
  const d = persona.truth.depth;
  if (d && typeof d === "object" && typeof d.looks === "number") {
    return Math.max(1, d.looks);
  }
  return 1;
}

function sumFunnel(obs: SearchObservability | undefined): FullStageSearchRow["funnel"] {
  const empty = {
    mcp_hits: 0,
    hard_drop_survivors: 0,
    hydrated_verified: 0,
    imaged: 0,
    heroes: 0,
  };
  if (!obs?.funnel.length) return empty;
  return obs.funnel.reduce(
    (acc, s) => ({
      mcp_hits: acc.mcp_hits + s.mcp_hits,
      hard_drop_survivors: acc.hard_drop_survivors + s.hard_drop_survivors,
      hydrated_verified: acc.hydrated_verified + s.hydrated_verified,
      imaged: acc.imaged + s.imaged,
      heroes: acc.heroes + s.heroes,
    }),
    empty,
  );
}

export function fullStageRow(result: PersonaRunResult): FullStageSearchRow {
  const obs = result.search_observability;
  return {
    persona_id: result.persona.id,
    name: result.persona.name,
    state: result.persona.profile.state,
    anchor: result.persona.truth.anchor,
    looks_wanted: looksWanted(result.persona),
    weights_version: result.scoring_weights_version ?? "",
    taste_fit_mean: obs?.taste_fit.mean ?? null,
    lanes: result.lane_distribution ?? { usual: 0, adjacent: 0, new: 0 },
    lanes_by_slot: obs?.lanes_by_slot ?? [],
    funnel: sumFunnel(obs),
    latency: obs?.latency ?? null,
    rerank: {
      calls: obs?.taste_rerank?.calls ?? 0,
      aborted: obs?.taste_rerank?.aborted ?? 0,
      rated: obs?.taste_rerank?.rated ?? 0,
      input_tokens: obs?.taste_rerank?.input_tokens ?? 0,
      output_tokens: obs?.taste_rerank?.output_tokens ?? 0,
    },
    cost_usd: obs?.cost.usd ?? 0,
    error: result.error,
    refinement_mode: result.refinement_mode,
    refinement_latency_ms: result.refinement_latency_ms,
    refinement_taste_cache_hits: result.refinement_taste_cache_hits,
    refinement_taste_calls: result.refinement_taste_calls,
    mcp_query: obs?.mcp_query,
  };
}

function fmtMean(n: number | null): string {
  return n == null ? "null" : String(n);
}

function fmtMix(m: {
  usual: number;
  adjacent: number;
  new: number;
  unlabeled?: number;
}): string {
  const extra = m.unlabeled ? ` +${m.unlabeled}unlab` : "";
  return `${m.usual}/${m.adjacent}/${m.new}${extra}`;
}

function diagnosedLoss(params: {
  anchor: string;
  imaged: { usual: number; adjacent: number; new: number };
  heroes: { usual: number; adjacent: number; new: number };
}): string {
  const benchN = params.imaged.usual + params.imaged.adjacent + params.imaged.new;
  const heroN = params.heroes.usual + params.heroes.adjacent + params.heroes.new;
  const benchStep = params.imaged.adjacent + params.imaged.new;
  const heroStep = params.heroes.adjacent + params.heroes.new;
  if (params.anchor === "explore") {
    const benchNew = benchN > 0 ? params.imaged.new / benchN : 0;
    const heroNew = heroN > 0 ? params.heroes.new / heroN : 0;
    if (params.imaged.new > 0 && params.heroes.new === 0) return "stage_a";
    if (params.imaged.new > 0 && benchNew >= 0.5 && heroNew < 0.5) {
      return "stage_a";
    }
    if (benchNew < 0.5) return "rerank_or_market";
    return "ok";
  }
  if (params.anchor === "push") {
    if (benchStep > 0 && heroStep === 0) return "stage_a";
    if (benchStep === 0) return "rerank_or_market";
    return "ok";
  }
  return "—";
}

export function fullStageSearchMarkdown(rows: FullStageSearchRow[]): string {
  if (!rows.length) return "";
  const version = rows[0]?.weights_version || "unknown";
  const lines = [
    `## Live search (${version})`,
    "",
    "Hero `taste_fit` is the diagnostic on the real rack, not a planted fixture.",
    "Lanes are Haiku `usual` / `adjacent` / `new` (zeros on v3 — no rerank).",
    "",
    "| persona | state | anchor | taste_fit | lanes u/a/n | mcp → drop → hyd → img → hero | cost |",
    "|---|---|---|---:|---|---|---:|",
  ];
  for (const r of rows) {
    const f = r.funnel;
    const funnel = `${f.mcp_hits} → ${f.hard_drop_survivors} → ${f.hydrated_verified} → ${f.imaged} → ${f.heroes}`;
    lines.push(
      `| ${r.persona_id} ${r.name} | ${r.state} | ${r.anchor} | ${fmtMean(r.taste_fit_mean)} | ${fmtMix(r.lanes)} | ${funnel} | $${r.cost_usd.toFixed(3)} |`,
    );
  }
  lines.push("", "### Latency (ms)", "");
  lines.push(
    "| persona | planner | fan-out | drops | score | rerank | hydrate | A | B | render | total |",
  );
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    const L = r.latency;
    if (!L) {
      lines.push(`| ${r.persona_id} | — | — | — | — | — | — | — | — | — | — |`);
      continue;
    }
    lines.push(
      `| ${r.persona_id} | ${L.planner_ms} | ${L.fan_out_ms} | ${L.hard_drops_ms} | ${L.score_ms} | ${L.taste_rerank_ms} | ${L.hydrate_ms} | ${L.stage_a_ms} | ${L.stage_b_ms} | ${L.render_ms} | ${L.total_to_final_ms ?? "—"} |`,
    );
  }
  const lats = rows.map((r) => r.latency).filter((L): L is NonNullable<typeof L> => Boolean(L));
  if (lats.length) {
    const pct = (arr: number[], p: number): string => {
      const a = arr.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
      if (!a.length) return "—";
      return String(a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))]);
    };
    const keys: Array<keyof (typeof lats)[0]> = [
      "planner_ms",
      "fan_out_ms",
      "normalize_ms",
      "hard_drops_ms",
      "score_ms",
      "taste_rerank_ms",
      "hydrate_ms",
      "image_prep_ms",
      "stage_a_ms",
      "stage_b_ms",
      "render_ms",
      "total_to_provisional_ms",
      "total_to_final_ms",
    ];
    lines.push("", "### Latency p50 / p95 (ms)", "");
    lines.push("| stage | n | p50 | p95 |");
    lines.push("|---|---:|---:|---:|");
    for (const k of keys) {
      const vals = lats
        .map((L) => L[k])
        .filter((n): n is number => n != null && Number.isFinite(n));
      lines.push(
        `| ${k} | ${vals.length} | ${pct(vals, 0.5)} | ${pct(vals, 0.95)} |`,
      );
    }
    const queryMax = rows
      .map((r) => r.mcp_query?.p95_ms)
      .filter((n): n is number => n != null && Number.isFinite(n));
    if (queryMax.length) {
      lines.push(
        `| mcp_query_p95_ms (slowest per search) | ${queryMax.length} | ${pct(queryMax, 0.5)} | ${pct(queryMax, 0.95)} |`,
      );
    }
  }
  lines.push("", "### Taste rerank (per search)", "");
  lines.push("| persona | calls | aborted | rated | input tok | output tok |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    const s = r.rerank;
    lines.push(
      `| ${r.persona_id} | ${s.calls} | ${s.aborted} | ${s.rated} | ${s.input_tokens} | ${s.output_tokens} |`,
    );
  }
  const withLanes = rows.filter((r) => r.lanes_by_slot.length);
  if (withLanes.length) {
    lines.push("", "### Bench vs heroes (lanes u/a/n per slot)", "");
    lines.push("| persona | slot | verified | imaged | heroes | loss |");
    lines.push("|---|---|---|---|---|---|");
    for (const r of withLanes) {
      for (const s of r.lanes_by_slot) {
        lines.push(
          `| ${r.persona_id} | ${s.slot_id} | ${fmtMix(s.verified)} | ${fmtMix(s.imaged)} | ${fmtMix(s.heroes)} | ${diagnosedLoss({ anchor: r.anchor, imaged: s.imaged, heroes: s.heroes })} |`,
        );
      }
    }
  }
  const refinements = rows.filter((r) => r.refinement_mode);
  if (refinements.length) {
    lines.push("", "### S2 refinement reuse", "");
    lines.push("| persona | mode | final ms | rerank cache hits | rerank calls |");
    lines.push("|---|---|---:|---:|---:|");
    for (const r of refinements) {
      lines.push(
        `| ${r.persona_id} | ${r.refinement_mode} | ${r.refinement_latency_ms ?? "—"} | ${r.refinement_taste_cache_hits ?? 0} | ${r.refinement_taste_calls ?? 0} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export type PairAcceptance = {
  id: string;
  pass: boolean;
  reason: string;
};

export function evaluateTastePair(
  v3: FullStageSearchRow[],
  v4: FullStageSearchRow[],
): PairAcceptance[] {
  const byIdV3 = new Map(v3.map((r) => [r.persona_id, r]));
  const byIdV4 = new Map(v4.map((r) => [r.persona_id, r]));
  const ids = [...new Set([...byIdV3.keys(), ...byIdV4.keys()])];
  const out: PairAcceptance[] = [];

  const keepV3: number[] = [];
  const keepV4: number[] = [];
  const chris: { v3: number | null; v4: number | null } = { v3: null, v4: null };
  const costs: number[] = [];

  for (const id of ids) {
    const a = byIdV3.get(id);
    const b = byIdV4.get(id);
    if (!a || !b) continue;
    if (a.anchor === "keep" && a.taste_fit_mean != null && b.taste_fit_mean != null) {
      keepV3.push(a.taste_fit_mean);
      keepV4.push(b.taste_fit_mean);
    }
    if (b.anchor === "explore") {
      const n = b.lanes.usual + b.lanes.adjacent + b.lanes.new;
      const share = n > 0 ? b.lanes.new / n : 0;
      out.push({
        id: `explore:${id}`,
        pass: n > 0 && share >= 0.5,
        reason:
          n === 0
            ? `${id}: no labeled heroes`
            : `${id}: ${(share * 100).toFixed(0)}% new (need ≥ 50%)`,
      });
    }
    if (b.anchor === "push") {
      const step = b.lanes.adjacent + b.lanes.new;
      const looks = b.looks_wanted;
      out.push({
        id: `push:${id}`,
        pass: step >= looks,
        reason:
          step >= looks
            ? `${id}: ${step} adjacent/new for ${looks} look(s)`
            : `${id}: ${step} adjacent/new, need ≥ ${looks} (one per look)`,
      });
    }
    if (id === "golden-irrelevant-06") {
      chris.v3 = a.taste_fit_mean;
      chris.v4 = b.taste_fit_mean;
    }
    costs.push(b.cost_usd - a.cost_usd);
  }

  if (keepV3.length && keepV4.length) {
    const mean = (xs: number[]) => xs.reduce((s, n) => s + n, 0) / xs.length;
    const delta = mean(keepV4) - mean(keepV3);
    out.unshift({
      id: "keep:+0.2",
      pass: delta >= 0.2,
      reason: `keep taste_fit Δ ${delta.toFixed(3)} (need ≥ 0.2)`,
    });
  }
  if (chris.v3 != null && chris.v4 != null) {
    out.push({
      id: "chris:not-raised",
      pass: chris.v4 <= chris.v3 + 0.05,
      reason: `Chris taste_fit ${chris.v3} → ${chris.v4}`,
    });
  }
  if (costs.length) {
    const meanCost = costs.reduce((s, n) => s + n, 0) / costs.length;
    out.push({
      id: "cost:≤$0.02",
      pass: meanCost <= 0.02,
      reason: `mean cost Δ $${meanCost.toFixed(3)} (need ≤ $0.02)`,
    });
  }
  const rerankCalls = v4.reduce((n, r) => n + r.rerank.calls, 0);
  const rerankAborted = v4.reduce((n, r) => n + r.rerank.aborted, 0);
  const abortRate = rerankCalls > 0 ? rerankAborted / rerankCalls : 1;
  out.push({
    id: "rerank:abort<10%",
    pass: abortRate < 0.1,
    reason: `taste_rerank abort ${(abortRate * 100).toFixed(0)}% (${rerankAborted}/${rerankCalls}) (need < 10%)`,
  });
  return out;
}

export function tastePairMarkdown(
  v3: FullStageSearchRow[],
  v4: FullStageSearchRow[],
): string {
  const byIdV3 = new Map(v3.map((r) => [r.persona_id, r]));
  const byIdV4 = new Map(v4.map((r) => [r.persona_id, r]));
  const ids = [...new Set([...byIdV3.keys(), ...byIdV4.keys()])];
  const gates = evaluateTastePair(v3, v4);
  const lines = [
    "# S0/S1 live pair — v3-brand vs v4-taste",
    "",
    "This is the before/after number. The planted scoring fixture is not a baseline.",
    "",
    "## Acceptance",
    "",
    "| gate | pass | detail |",
    "|---|---|---|",
    ...gates.map((g) => `| ${g.id} | ${g.pass ? "yes" : "NO"} | ${g.reason} |`),
    "",
    "## Per persona",
    "",
    "| persona | anchor | v3 fit | v4 fit | Δ | v4 lanes u/a/n | v4 abort | v3 cost | v4 cost | Δ cost |",
    "|---|---|---:|---:|---:|---|---|---:|---:|---:|",
  ];
  for (const id of ids) {
    const a = byIdV3.get(id);
    const b = byIdV4.get(id);
    if (!a || !b) continue;
    const dFit =
      a.taste_fit_mean != null && b.taste_fit_mean != null
        ? (b.taste_fit_mean - a.taste_fit_mean).toFixed(3)
        : "—";
    const abort =
      b.rerank.calls > 0
        ? `${b.rerank.aborted}/${b.rerank.calls}`
        : "0/0";
    lines.push(
      `| ${id} ${b.name} | ${b.anchor} | ${fmtMean(a.taste_fit_mean)} | ${fmtMean(b.taste_fit_mean)} | ${dFit} | ${fmtMix(b.lanes)} | ${abort} | $${a.cost_usd.toFixed(3)} | $${b.cost_usd.toFixed(3)} | $${(b.cost_usd - a.cost_usd).toFixed(3)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function searchRowsFromResults(
  results: PersonaRunResult[],
): FullStageSearchRow[] {
  return results
    .filter((r) => r.search_observability || r.stage === "full")
    .map(fullStageRow);
}

export async function loadSearchRowsFromRunDir(
  runDir: string,
): Promise<FullStageSearchRow[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const files = await readdir(runDir);
  const rows: FullStageSearchRow[] = [];
  for (const f of files) {
    if (!f.endsWith(".json") || f === "summary.json") continue;
    try {
      const raw = JSON.parse(
        await readFile(path.join(runDir, f), "utf8"),
      ) as {
        persona: PersonaRunResult["persona"];
        search_observability?: PersonaRunResult["search_observability"];
        lane_distribution?: PersonaRunResult["lane_distribution"];
        scoring_weights_version?: string;
        error?: string;
        stage?: PersonaRunResult["stage"];
        refinement_mode?: PersonaRunResult["refinement_mode"];
        refinement_latency_ms?: number | null;
        refinement_taste_cache_hits?: number;
        refinement_taste_calls?: number;
      };
      rows.push(
        fullStageRow({
          persona: raw.persona,
          stage: raw.stage ?? "full",
          transcript: [],
          brief: null,
          shopper_leak: null,
          excluded: false,
          question_rounds: 0,
          impatient: false,
          traceId: "",
          conversationId: "",
          userId: "",
          error: raw.error,
          search_observability: raw.search_observability,
          lane_distribution: raw.lane_distribution,
          scoring_weights_version: raw.scoring_weights_version,
          refinement_mode: raw.refinement_mode,
          refinement_latency_ms: raw.refinement_latency_ms,
          refinement_taste_cache_hits: raw.refinement_taste_cache_hits,
          refinement_taste_calls: raw.refinement_taste_calls,
        }),
      );
    } catch {
      /* skip */
    }
  }
  return rows;
}
