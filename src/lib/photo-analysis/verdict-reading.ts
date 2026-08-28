/**
 * Maps a StylistVerdict (+ optional style mix) into the onboarding "Your reading" UI.
 * Pure / client-safe — no I/O.
 */

import type { StyleMix } from "@/lib/onboarding/style-mix";
import type { StylistVerdict } from "./verdict";

export type ReadingTone = "hi" | "lo" | "—";

export type ReadingMetric = {
  label: string;
  value: string;
  tone: ReadingTone;
};

export type ReadingRec = {
  ok: boolean;
  title: string;
  detail: string;
};

export type ReadingArea = {
  id: string;
  name: string;
  sum: string;
  verdict: "y" | "n";
  vlab: string;
  thumb: string;
  metrics: ReadingMetric[];
  insight: string;
  recs: ReadingRec[];
};

export type ReadingSwatch = {
  hex: string;
  name: string;
  use: string;
};

export type ReadingMixAxis = {
  label: string;
  percent: number;
  color: string;
  detail: string;
};

export type ReadingStep = {
  step: number;
  label: string;
  name: string;
  why: string;
};

export type ReadingView = {
  opening: string;
  headline: string;
  areas: ReadingArea[];
  palette: ReadingSwatch[];
  avoid: ReadingSwatch[];
  mix: ReadingMixAxis[];
  steps: ReadingStep[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(asStr).filter(Boolean);
}

function firstSentence(text: string, max = 110): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const cut = clean.split(/(?<=[.!?])\s+/)[0] ?? clean;
  if (cut.length <= max) return cut;
  return `${cut.slice(0, max - 1).trimEnd()}…`;
}

function normalizeHex(raw: string | null | undefined, fallback: string): string {
  const h = (raw ?? "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(h)) return h.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(h)) {
    const r = h[1]!;
    const g = h[2]!;
    const b = h[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

const MIX_COLORS = ["#1A1A2E", "#8E8E99", "#E42831", "#3B4E6B", "#B8894F"] as const;

function colorItems(list: unknown): Array<{
  name: string;
  hex: string;
  use: string;
}> {
  if (!Array.isArray(list)) return [];
  const out: Array<{ name: string; hex: string; use: string }> = [];
  for (const item of list) {
    const o = asRecord(item);
    if (!o) continue;
    const name = asStr(o.name);
    if (!name) continue;
    const uses = asStrArr(o.best_uses);
    const notes = asStr(o.notes);
    out.push({
      name,
      hex: normalizeHex(asStr(o.representative_hex) || null, "#B8894F"),
      use: uses[0] || notes || name,
    });
  }
  return out;
}

function areaFromDomain(input: {
  id: string;
  name: string;
  thumb: string;
  sum: string;
  insight: string;
  metrics: ReadingMetric[];
  doList: string[];
  dontList: string[];
  preferFix?: boolean;
}): ReadingArea | null {
  const insight = input.insight.trim();
  if (!insight && !input.doList.length && !input.dontList.length) return null;
  const hasFix = input.preferFix || input.dontList.length > input.doList.length;
  const recs: ReadingRec[] = [
    ...input.doList.slice(0, 3).map((t) => ({
      ok: true,
      title: t,
      detail: "",
    })),
    ...input.dontList.slice(0, 3).map((t) => ({
      ok: false,
      title: t,
      detail: "",
    })),
  ];
  return {
    id: input.id,
    name: input.name,
    sum: input.sum || firstSentence(insight) || "open for the detail",
    verdict: hasFix ? "n" : "y",
    vlab: hasFix ? "FIX THIS" : "WORKS FOR YOU",
    thumb: input.thumb,
    metrics: input.metrics.slice(0, 4),
    insight: insight || input.sum,
    recs,
  };
}

function buildColourArea(verdict: StylistVerdict): ReadingArea | null {
  const cs = asRecord(verdict.color_system);
  if (!cs) return null;
  const temp = asStr(cs.temperature) || "—";
  const depth = asStr(cs.depth) || "—";
  const contrast = asStr(cs.contrast_level) || "—";
  const seasonal = asStr(cs.seasonal_label);
  const insight =
    asStr(cs.analysis_basis) ||
    asStrArr(cs.color_shopping_rules)[0] ||
    "";
  const near = colorItems(cs.near_face_colors);
  const careful = Array.isArray(cs.use_carefully) ? cs.use_carefully : [];
  const dont = careful
    .map((c) => {
      const o = asRecord(c);
      if (!o) return "";
      const fam = asStr(o.color_or_family);
      const issue = asStr(o.issue);
      return fam ? (issue ? `${fam} — ${issue}` : fam) : "";
    })
    .filter(Boolean);
  const doList = [
    ...near.slice(0, 2).map((c) => `${c.name} near your face`),
    ...asStrArr(cs.color_shopping_rules).slice(0, 2),
  ];
  return areaFromDomain({
    id: "colour",
    name: "Your colouring",
    thumb: near[0]?.hex ?? "#B8894F",
    sum: [seasonal, temp !== "—" ? `${temp} undertone` : "", depth !== "—" ? depth : ""]
      .filter(Boolean)
      .join(" · ")
      .toLowerCase() || "colour near your face",
    insight,
    metrics: [
      { label: "Undertone", value: temp, tone: "hi" },
      { label: "Depth", value: depth, tone: "—" },
      {
        label: "Contrast",
        value: contrast,
        tone: /low|gentle|soft/i.test(contrast) ? "lo" : "—",
      },
      {
        label: "Near the face",
        value: near[0]?.name || "warm mid-depth",
        tone: "hi",
      },
    ],
    doList,
    dontList: dont,
    preferFix: dont.length > 0 && doList.length === 0,
  });
}

function buildProportionArea(verdict: StylistVerdict): ReadingArea | null {
  const p = asRecord(verdict.proportion_and_silhouette);
  if (!p) return null;
  const insight = asStr(p.strategy_summary);
  const sil = asStrArr(p.preferred_overall_silhouette);
  const length = asStrArr(p.length_strategy);
  const volume = asStrArr(p.volume_distribution);
  const prios = asStrArr(p.proportion_priorities);
  return areaFromDomain({
    id: "proportion",
    name: "Your proportions",
    thumb: "#2A2620",
    sum: firstSentence(insight) || sil[0]?.toLowerCase() || "silhouette",
    insight,
    metrics: [
      {
        label: "Silhouette",
        value: sil[0] || "—",
        tone: "—",
      },
      {
        label: "Structure",
        value: asStr(p.structure_level) || "—",
        tone: "hi",
      },
      {
        label: "Length",
        value: length[0] || "—",
        tone: "—",
      },
      {
        label: "Priority",
        value: prios[0] || "—",
        tone: "hi",
      },
    ],
    doList: [...sil.slice(0, 2), ...length.slice(0, 2), ...volume.slice(0, 1)],
    dontList: asStrArr(p.test_in_fitting).slice(0, 2),
  });
}

function buildFitArea(verdict: StylistVerdict): ReadingArea | null {
  const f = asRecord(verdict.size_and_fit);
  if (!f) return null;
  const risks = asStrArr(f.recurring_fit_risks);
  const alters = asStrArr(f.alteration_priorities);
  const protocol = asStrArr(f.product_size_selection_protocol);
  const needed = asStrArr(f.measurements_still_needed);
  const warning = asStr(f.universal_size_warning);
  const sizeMetrics: ReadingMetric[] = [];
  const starts = Array.isArray(f.starting_sizes) ? f.starting_sizes : [];
  for (const raw of starts) {
    const o = asRecord(raw);
    if (!o) continue;
    const cat = asStr(o.category);
    const label = asStr(o.likely_starting_label);
    if (!cat && !label) continue;
    sizeMetrics.push({
      label: cat || "Start at",
      value: label || "verify on the piece",
      tone: label ? "hi" : "—",
    });
    if (sizeMetrics.length >= 3) break;
  }
  const goods = Array.isArray(f.known_good_garments)
    ? f.known_good_garments
    : [];
  if (sizeMetrics.length < 3) {
    for (const raw of goods) {
      const o = asRecord(raw);
      if (!o) continue;
      const item = asStr(o.brand_or_item) || asStr(o.category);
      const label = asStr(o.labeled_size);
      if (!item || !label) continue;
      sizeMetrics.push({
        label: item,
        value: label,
        tone: "hi",
      });
      if (sizeMetrics.length >= 3) break;
    }
  }
  const firstStart = asRecord(starts[0]);
  const insight =
    protocol[0] ||
    asStr(firstStart?.basis) ||
    (sizeMetrics[0]
      ? `Start from ${sizeMetrics.map((m) => `${m.label} ${m.value}`).join(", ")}.`
      : "") ||
    (risks[0] ? `Watch for: ${risks[0]}` : "") ||
    warning;
  const metrics: ReadingMetric[] =
    sizeMetrics.length > 0
      ? sizeMetrics
      : [
          {
            label: "Confidence",
            value:
              typeof f.sizing_confidence === "number"
                ? `${Math.round(f.sizing_confidence * 100)}%`
                : "—",
            tone: "—",
          },
          {
            label: "Alter first",
            value: alters[0] || "—",
            tone: alters[0] ? "hi" : "—",
          },
          {
            label: "Risk",
            value: risks[0] || "none flagged",
            tone: risks[0] ? "lo" : "hi",
          },
        ];
  return areaFromDomain({
    id: "fit",
    name: "Size and fit",
    thumb: "#3B4E6B",
    sum: firstSentence(insight) || "how pieces should sit",
    insight: [insight, warning && insight !== warning ? warning : ""]
      .filter(Boolean)
      .join(" "),
    metrics,
    doList: [...protocol.slice(0, 2), ...alters.slice(0, 2)],
    dontList: [...needed.slice(0, 2), ...risks.slice(0, 2)],
    preferFix: needed.length > 0 && sizeMetrics.length === 0,
  });
}

function buildFabricArea(verdict: StylistVerdict): ReadingArea | null {
  const fab = asRecord(verdict.fabrics_patterns_and_climate);
  if (!fab) return null;
  const best = asStrArr(fab.best_fabrics);
  const careful = asStrArr(fab.fabrics_to_use_carefully);
  const insight =
    asStr(fab.climate_strategy) ||
    asStrArr(fab.layering_strategy)[0] ||
    "";
  return areaFromDomain({
    id: "fabric",
    name: "Fabric and how it hangs",
    thumb: "#2E5B5B",
    sum: firstSentence(insight) || best[0]?.toLowerCase() || "fabric weight",
    insight,
    metrics: [
      { label: "Best", value: best[0] || "—", tone: "hi" },
      {
        label: "Careful",
        value: careful[0] || "—",
        tone: careful[0] ? "lo" : "—",
      },
      {
        label: "Layer",
        value: asStrArr(fab.layering_strategy)[0] || "—",
        tone: "—",
      },
    ],
    doList: [...best.slice(0, 3), ...asStrArr(fab.useful_blends).slice(0, 1)],
    dontList: careful.slice(0, 3),
  });
}

function buildIdentityArea(verdict: StylistVerdict): ReadingArea | null {
  const id = asRecord(verdict.style_identity);
  if (!id) return null;
  const primary = asStr(id.primary_direction);
  const secondary = asStr(id.secondary_direction);
  const descriptors = asStrArr(id.style_descriptors);
  const sig = asStrArr(id.signature_elements);
  const bounds = asStrArr(id.aesthetic_boundaries);
  const insight =
    asStr(id.evolution_strategy) ||
    (primary
      ? `Your direction is ${primary}${secondary ? `, with ${secondary}` : ""}.`
      : "");
  return areaFromDomain({
    id: "identity",
    name: "Your taste",
    thumb: "#E42831",
    sum:
      [primary, secondary].filter(Boolean).join(" · ").toLowerCase() ||
      descriptors[0]?.toLowerCase() ||
      "how you show up",
    insight,
    metrics: [
      { label: "Primary", value: primary || "—", tone: "hi" },
      { label: "Second", value: secondary || "—", tone: "—" },
      {
        label: "Signature",
        value: sig[0] || descriptors[0] || "—",
        tone: "—",
      },
    ],
    doList: [...sig.slice(0, 2), ...descriptors.slice(0, 2)],
    dontList: bounds.slice(0, 3),
  });
}

function buildRulesArea(verdict: StylistVerdict): ReadingArea | null {
  const face = verdict.user_facing_verdict;
  const rules = face?.golden_rules?.filter((s) => s.trim()) ?? [];
  const mistakes = face?.mistakes_to_avoid?.filter((s) => s.trim()) ?? [];
  if (!rules.length && !mistakes.length) return null;
  return areaFromDomain({
    id: "rules",
    name: "Rules I'll hold you to",
    thumb: "#1A1A2E",
    sum:
      rules[0] && mistakes[0]
        ? "what to do, and what to put back"
        : rules[0]
          ? firstSentence(rules[0])
          : firstSentence(mistakes[0]!),
    insight:
      face?.opening?.trim() ||
      "These are the short rules from your fitting — everything else hangs off them.",
    metrics: rules.slice(0, 3).map((r, i) => ({
      label: `Rule ${i + 1}`,
      value: firstSentence(r, 48),
      tone: "hi" as const,
    })),
    doList: rules.slice(0, 4),
    dontList: mistakes.slice(0, 4),
    preferFix: mistakes.length > rules.length,
  });
}

export function readingPalette(verdict: StylistVerdict | null): {
  palette: ReadingSwatch[];
  avoid: ReadingSwatch[];
} {
  if (!verdict) return { palette: [], avoid: [] };
  const cs = asRecord(verdict.color_system);
  if (!cs) return { palette: [], avoid: [] };

  const near = colorItems(cs.near_face_colors);
  const core = colorItems(cs.core_colors);
  const neutrals = colorItems(cs.best_neutrals);
  const accents = colorItems(cs.accent_colors);
  const seen = new Set<string>();
  const palette: ReadingSwatch[] = [];
  for (const c of [...near, ...core, ...neutrals, ...accents]) {
    const key = c.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    palette.push({ hex: c.hex, name: c.name.toUpperCase(), use: c.use });
    if (palette.length >= 6) break;
  }

  const avoid: ReadingSwatch[] = [];
  const careful = Array.isArray(cs.use_carefully) ? cs.use_carefully : [];
  for (const item of careful) {
    const o = asRecord(item);
    if (!o) continue;
    const name = asStr(o.color_or_family);
    if (!name) continue;
    avoid.push({
      hex: "#14141A",
      name: name.toUpperCase(),
      use: asStr(o.issue) || asStr(o.how_to_wear) || name,
    });
    if (avoid.length >= 2) break;
  }
  return { palette, avoid };
}

const STEP_LABELS = ["ONE CHANGE", "AND A TUCK", "IF YOU PUSH"] as const;

export function readingSteps(verdict: StylistVerdict | null): ReadingStep[] {
  if (!verdict) return [];
  const face = verdict.user_facing_verdict;
  const actions =
    face?.first_five_actions?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (actions.length >= 3) {
    return actions.slice(0, 3).map((why, i) => ({
      step: i + 1,
      label: STEP_LABELS[i]!,
      name: firstSentence(why, 120),
      why,
    }));
  }
  const formulas = Array.isArray(verdict.outfit_formulas)
    ? verdict.outfit_formulas
    : [];
  const fromFormulas: ReadingStep[] = [];
  for (const raw of formulas) {
    const o = asRecord(raw);
    if (!o) continue;
    const occasion = asStr(o.occasion);
    const formula = asStrArr(o.formula);
    const notes = asStr(o.silhouette_notes);
    if (!occasion && !formula.length) continue;
    fromFormulas.push({
      step: fromFormulas.length + 1,
      label: STEP_LABELS[fromFormulas.length] ?? `STEP ${fromFormulas.length + 1}`,
      name: occasion || firstSentence(formula[0] ?? "A look", 42),
      why: notes || formula.join(" · ") || occasion,
    });
    if (fromFormulas.length >= 3) break;
  }
  return fromFormulas;
}

const MIX_DETAIL: Record<string, string> = {
  Parisian: "effortless, thrown-on polish",
  Minimal: "clean shapes, not much fuss",
  Bold: "small, but it stops you looking plain",
  Classic: "tailored and put-together",
  Street: "relaxed with an edge",
  Romantic: "soft lines, a bit of ease",
  Sporty: "easy knits and movement",
  Boho: "undone and layered",
};

export function readingMix(
  styleMix: StyleMix | null | undefined,
  fallback: {
    wornLabels: string[];
    stealLabels: string[];
    leanLabel: string;
  },
): ReadingMixAxis[] {
  const axes = styleMix?.axes?.filter((a) => a.label && a.percent > 0) ?? [];
  if (axes.length) {
    return axes.slice(0, 5).map((a, i) => ({
      label: a.label,
      percent: Math.round(a.percent),
      color: MIX_COLORS[i % MIX_COLORS.length]!,
      detail: MIX_DETAIL[a.label] ?? "part of how you dress",
    }));
  }
  const worn = fallback.wornLabels[0]?.trim();
  const steal = fallback.stealLabels[0]?.trim();
  const lean = fallback.leanLabel.trim() || "Minimal";
  const out: ReadingMixAxis[] = [
    {
      label: lean,
      percent: worn && steal && worn !== steal ? 55 : 70,
      color: MIX_COLORS[0]!,
      detail: MIX_DETAIL[lean] ?? "where you live most days",
    },
  ];
  if (worn) {
    out.push({
      label: worn,
      percent: steal && worn !== steal ? 28 : 30,
      color: MIX_COLORS[1]!,
      detail: "what you already wear",
    });
  }
  if (steal && steal !== worn) {
    out.push({
      label: steal,
      percent: 17,
      color: MIX_COLORS[2]!,
      detail: "where you said you want to go",
    });
  }
  const total = out.reduce((s, a) => s + a.percent, 0) || 1;
  let rem = 100;
  return out.map((a, i) => {
    const pct =
      i === out.length - 1
        ? rem
        : Math.max(1, Math.round((a.percent / total) * 100));
    if (i < out.length - 1) rem -= pct;
    return { ...a, percent: pct };
  });
}

export function buildReadingView(input: {
  verdict: StylistVerdict | null;
  styleMix?: StyleMix | null;
  wornLabels?: string[];
  stealLabels?: string[];
  leanLabel?: string;
  buildFallbackCopy?: string;
}): ReadingView {
  const verdict = input.verdict;
  const face = verdict?.user_facing_verdict;
  const exec = verdict?.executive_verdict;
  const opening =
    face?.opening?.trim() ||
    exec?.profile_summary?.trim() ||
    input.buildFallbackCopy?.trim() ||
    "Five things I'd change, taken from your fitting.";
  const headline = exec?.headline?.trim() || face?.title?.trim() || "";

  const areas = verdict
    ? ([
        buildColourArea(verdict),
        buildProportionArea(verdict),
        buildFitArea(verdict),
        buildFabricArea(verdict),
        buildIdentityArea(verdict),
        buildRulesArea(verdict),
      ].filter(Boolean) as ReadingArea[])
    : [];

  const { palette, avoid } = readingPalette(verdict);
  const mix = readingMix(input.styleMix, {
    wornLabels: input.wornLabels ?? [],
    stealLabels: input.stealLabels ?? [],
    leanLabel: input.leanLabel ?? "",
  });
  const steps = readingSteps(verdict);

  return { opening, headline, areas, palette, avoid, mix, steps };
}
