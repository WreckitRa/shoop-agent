import type { FashionCatalogRunDetail, FashionPipelineEventRow } from "@/lib/admin/fashion-types";
import type { MessageMetadata } from "@/lib/ai-chat/types";
import type { MessageFashionCatalogSearchMetaV1 } from "@/lib/fashion-memory/catalog-search/types";
import type { FashionCurationDebugV1 } from "@/lib/fashion-memory/curation/fashion-curation-debug";
import { SCORING_COMPONENT_KEYS } from "@/lib/fashion-memory/scoring/weights";
import { computeDegradation } from "@/lib/fashion-memory/curation/degradation";
import type { FashionSearchPlan } from "@/lib/fashion-memory/search-planner/types";

export type QaCriteriaSection = {
  title: string;
  rows: Array<{ label: string; value: string }>;
};

export type QaDebugCriteriaModel = {
  traceId: string | null;
  sections: QaCriteriaSection[];
};

function row(label: string, value: unknown): { label: string; value: string } {
  if (value == null || value === "") {
    return { label, value: "not instrumented" };
  }
  if (typeof value === "string") return { label, value };
  return { label, value: JSON.stringify(value, null, 0) };
}

function dropsByRule(
  events: FashionPipelineEventRow[],
  slotId?: string,
): string {
  const hard = events.filter(
    (e) =>
      e.stage === "hard_drops" &&
      (!slotId || e.payload.slot_id === slotId || e.payload.garment),
  );
  if (!hard.length) return "not instrumented";
  const merged: Record<string, number> = {};
  for (const e of hard) {
    const rules = e.payload.drops_by_rule;
    if (!rules || typeof rules !== "object") continue;
    for (const [k, n] of Object.entries(rules as Record<string, number>)) {
      merged[k] = (merged[k] ?? 0) + (typeof n === "number" ? n : 0);
    }
  }
  return Object.keys(merged).length
    ? JSON.stringify(merged)
    : "not instrumented";
}

function pipelineInstrumented(events: FashionPipelineEventRow[]): boolean {
  return events.some((e) =>
    [
      "hydration",
      "hard_drops",
      "budget_allocation",
      "curation_fallback",
      "curator_veto",
      "style_signal_written",
      "gate",
    ].includes(e.stage),
  );
}

function hydrationSummary(events: FashionPipelineEventRow[]): string {
  const hydration = events.filter((e) => e.stage === "hydration");
  if (!hydration.length) {
    return pipelineInstrumented(events) ? "none" : "not instrumented";
  }
  const kills: Record<string, number> = {};
  let sizeUnknown = 0;
  let sizeConfirmed = 0;
  for (const e of hydration) {
    // Emitter key is `killed` (HydrationPipelinePayload) — never deaths_by_cause.
    const deaths = e.payload.killed;
    if (deaths && typeof deaths === "object") {
      for (const [k, n] of Object.entries(deaths as Record<string, number>)) {
        kills[k] = (kills[k] ?? 0) + (typeof n === "number" ? n : 0);
      }
    }
    const counts = e.payload.size_status_counts;
    if (counts && typeof counts === "object") {
      sizeUnknown += Number((counts as Record<string, number>).unknown ?? 0);
      sizeConfirmed += Number((counts as Record<string, number>).confirmed ?? 0);
    }
  }
  return JSON.stringify({
    killed: kills,
    size_status: { confirmed: sizeConfirmed, unknown: sizeUnknown },
  });
}

function curationVetoes(
  events: FashionPipelineEventRow[],
  curation?: FashionCurationDebugV1 | null,
): string {
  const fromEvents = events
    .filter((e) => e.stage === "curator_veto")
    .map((e) => ({
      ref: e.payload.ref,
      reason: e.payload.reason,
      evidence: e.payload.evidence,
    }));
  const fromDebug = curation?.vetoes ?? [];
  const merged = [...fromEvents, ...fromDebug];
  if (merged.length) return JSON.stringify(merged);
  // Fresh search with pipeline events but no vetoes → instrumented empty.
  if (pipelineInstrumented(events) || curation) return "none";
  return "not instrumented";
}

function signalsWritten(events: FashionPipelineEventRow[]): string {
  const rows = events.filter((e) => e.stage === "style_signal_written");
  if (!rows.length) {
    // Interactions may write later; search turn still instruments the channel.
    if (pipelineInstrumented(events)) return "none";
    return "not instrumented";
  }
  return JSON.stringify(
    rows.map((e) => ({
      signal_type: e.payload.signal_type,
      value: e.payload.value,
      polarity: e.payload.polarity,
    })),
  );
}

function degradationKind(
  catalog: MessageFashionCatalogSearchMetaV1 | undefined,
  plan?: FashionSearchPlan | null,
  events?: FashionPipelineEventRow[],
): string {
  if (!catalog?.curation || !plan) return "not instrumented";
  const invisibleHiccup = (events ?? []).some(
    (e) =>
      e.stage === "catalog_query_failed" &&
      String(e.payload.error ?? "").includes("qa_fault:fail_one_lane"),
  );
  const info = computeDegradation({
    presentation: catalog.curation,
    plan,
    invisibleHiccups: invisibleHiccup,
  });
  return info.kind;
}

export function buildQaDebugCriteria(params: {
  traceId?: string | null;
  fashionRouter?: MessageMetadata["fashionRouter"];
  fashionSearchPlan?: MessageMetadata["fashionSearchPlan"];
  catalogSearch?: MessageFashionCatalogSearchMetaV1;
  pipelineEvents?: FashionPipelineEventRow[];
  curationDebug?: FashionCurationDebugV1 | null;
  plan?: FashionSearchPlan | null;
}): QaDebugCriteriaModel {
  const events = params.pipelineEvents ?? [];
  const plan = params.plan ?? null;
  const catalog = params.catalogSearch;
  const slot = catalog?.slots[0];
  const planSlot = params.fashionSearchPlan?.slots[0];

  const laneRows =
    slot?.query_variants_used?.map((q, i) =>
      row(
        `query lane ${i + 1}`,
        `${q.lane ?? "?"} · ${q.query.slice(0, 80)}`,
      ),
    ) ?? [row("query lanes", null)];

  const budgetSlot =
    params.fashionSearchPlan?.per_slot_budget?.[slot?.slot_id ?? ""] ??
    plan?.budget_allocation?.per_slot?.[slot?.slot_id ?? ""];

  const sections: QaCriteriaSection[] = [
    {
      title: "Brief & plan",
      rows: [
        row(
          "brief.stated_facts",
          params.fashionRouter?.brief?.stated_facts ??
            params.fashionRouter?.stated_facts,
        ),
        row("plan.palette_source", planSlot?.palette_source),
        row("plan.plan_source", params.fashionSearchPlan?.plan_source),
        row(
          "plan.budget_fraction",
          budgetSlot
            ? {
                fraction: budgetSlot.fraction,
                fraction_source: budgetSlot.fraction_source,
              }
            : planSlot?.budget_fraction,
        ),
        row("budget_interpretation", catalog?.budget_interpretation),
        row("budget_tension", catalog?.budget_tension?.severity),
        row("budget_assembly", catalog?.budget_assembly),
      ],
    },
    {
      title: "Retrieval lanes",
      rows: [
        ...laneRows,
        row(
          "guard bounds",
          slot
            ? {
                guard_band_count: slot.guard_band_count,
                enforced_max: slot.enforced_max,
                guard_max: slot.guard_max,
                market_prices: slot.market_prices,
              }
            : null,
        ),
      ],
    },
    {
      title: "Drops & scoring",
      rows: [
        row("drops_by_rule", dropsByRule(events, slot?.slot_id)),
        row(
          "score components",
          SCORING_COMPONENT_KEYS.join(", ") +
            " (see survivor expand for brand_match / department_confirmed)",
        ),
      ],
    },
    {
      title: "Hydration",
      rows: [row("hydration_summary", hydrationSummary(events))],
    },
    {
      title: "Curation",
      rows: [
        row("curation_vetoes", curationVetoes(events, params.curationDebug)),
        row("degradation_kind", degradationKind(catalog, plan, events)),
        row("signals_written", signalsWritten(events)),
      ],
    },
  ];

  return {
    traceId: params.traceId ?? catalog?.trace_id ?? null,
    sections,
  };
}

function curationDebugFromAdminDetail(
  detail: FashionCatalogRunDetail,
): FashionCurationDebugV1 | null {
  const curation = detail.catalogSearch.curation;
  if (!curation) return null;
  const vetoes = detail.pipelineEvents
    .filter((e) => e.stage === "curator_veto")
    .map((e) => ({
      ref: String(e.payload.ref ?? ""),
      reason: String(e.payload.reason ?? "quality_visual") as FashionCurationDebugV1["vetoes"][number]["reason"],
      evidence: String(e.payload.evidence ?? "admin"),
    }))
    .filter((v) => v.ref);
  return {
    version: 1,
    searchKey: detail.run.messageId || detail.run.traceId || "admin",
    ts: Date.now(),
    timing_ms: detail.run.timingMs,
    model: "",
    mode: detail.fashionSearchPlan?.mode ?? "single_item",
    fallback: detail.pipelineEvents.some((e) => e.stage === "curation_fallback"),
    retries: detail.pipelineEvents.filter((e) =>
      String(e.stage).includes("retry"),
    ).length,
    image_count: 0,
    validation_issues: detail.pipelineEvents
      .filter((e) => e.stage === "fallback_validation_degraded")
      .flatMap((e) =>
        Array.isArray(e.payload.issues) ? (e.payload.issues as string[]) : [],
      ),
    narration: curation.narration,
    input_text: "",
    slots: [],
    vetoes,
    tiers_summary: {
      picks: curation.tiers?.picks?.length ?? 0,
      verified: curation.tiers?.verified?.length ?? 0,
      unverified: curation.tiers?.unverified?.length ?? 0,
    },
  };
}

export function buildQaDebugCriteriaFromAdminDetail(
  detail: FashionCatalogRunDetail,
): QaDebugCriteriaModel {
  return buildQaDebugCriteria({
    traceId: detail.run.traceId,
    fashionRouter: detail.fashionRouter,
    fashionSearchPlan: detail.fashionSearchPlan,
    catalogSearch: detail.catalogSearch,
    pipelineEvents: detail.pipelineEvents,
    curationDebug: curationDebugFromAdminDetail(detail),
    plan: detail.fashionSearchPlan
      ? {
          version: 1,
          mode: detail.fashionSearchPlan.mode,
          slots: detail.fashionSearchPlan.slots,
          reasoning: detail.fashionSearchPlan.reasoning,
          brief: detail.fashionRouter?.brief ?? {
            recipient_person_id: detail.fashionSearchPlan.recipient_person_id,
            request_type: "single_item",
            garments: detail.catalogSearch.slots.map((s) => s.garment),
            occasion_context: "",
            quantity_hint: "",
            must_haves: [],
            nice_to_haves: [],
            budget_context: { stated: false },
            style_direction: "",
            knowledge_state: detail.fashionSearchPlan.knowledge_state,
          },
          currentDate: "",
          plan_source: detail.fashionSearchPlan.plan_source,
          budget_allocation: undefined,
        }
      : null,
  });
}
