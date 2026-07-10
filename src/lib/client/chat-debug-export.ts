/**
 * Build a minimized, AI-readable dump of chat + pipeline debug for the
 * active conversation. Strips images, raw catalog blobs, and long prompts.
 */
import type { ChatMessage } from "@/lib/ai-chat/types";
import type {
  FashionCatalogRunView,
  FashionCurationRunView,
  QueryPlannerRunView,
  SearchPipelineRunView,
} from "@/lib/ai-chat/agent-debug";

const PROMPT_MAX = 2_000;
const TEXT_MAX = 1_200;
const LIST_CAP = 40;

function trunc(s: string | null | undefined, max = TEXT_MAX): string | undefined {
  if (s == null) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max)}…[+${t.length - max}]` : t;
}

function productMini(p: {
  id?: string;
  title?: string;
  store?: string | null;
  priceLabel?: string | null;
  ratingLabel?: string | null;
  score?: number;
}): Record<string, unknown> {
  return {
    id: p.id,
    title: trunc(p.title, 120),
    store: p.store ?? undefined,
    price: p.priceLabel ?? undefined,
    rating: p.ratingLabel ?? undefined,
    score: p.score,
  };
}

function minimizePipeline(run: SearchPipelineRunView): Record<string, unknown> {
  return {
    id: run.id,
    searchKey: run.searchKey,
    query: trunc(run.query, 200),
    ts: run.ts,
    method: run.method,
    journey: run.journeySummary,
    counts: {
      catalogFetched: run.catalogFetched?.length,
      fetched: run.fetched?.length,
      preVerify: run.preVerify?.length,
      verified: run.verified?.length,
      onScreen: run.onScreen?.length,
    },
    drops: {
      pool: (run.poolFilterDrops ?? []).slice(0, LIST_CAP).map((d) => ({
        id: d.product?.id,
        title: trunc(d.product?.title, 80),
        stage: d.stage,
        reason: trunc(d.reason, 160),
      })),
      verify: (run.verifyDrops ?? []).slice(0, LIST_CAP).map((d) => ({
        id: d.product?.id,
        title: trunc(d.product?.title, 80),
        stage: d.stage,
        reason: trunc(d.reason, 160),
      })),
      scoring: (run.scoringConstraintDrops ?? []).slice(0, LIST_CAP).map((d) => ({
        id: d.product?.id,
        title: trunc(d.product?.title, 80),
        stage: d.stage,
        reason: trunc(d.reason, 160),
      })),
      slotting: (run.slottingDrops ?? []).slice(0, LIST_CAP).map((d) => ({
        id: d.product?.id,
        title: trunc(d.product?.title, 80),
        stage: d.stage,
        reason: trunc(d.reason, 160),
      })),
    },
    onScreen: (run.onScreen ?? []).slice(0, 20).map(productMini),
    briefBudget: run.briefBudget,
    tierJudgeFailureReason: run.tierJudgeFailureReason,
  };
}

function minimizeFashionCatalog(run: FashionCatalogRunView): Record<string, unknown> {
  return {
    id: run.id,
    searchKey: run.searchKey,
    ts: run.ts,
    timing_ms: run.timing_ms,
    mode: run.mode,
    total_queries: run.total_queries,
    total_products_fetched: run.total_products_fetched,
    slots: (run.slots ?? []).map((slot) => ({
      slot_id: slot.slot_id,
      garment: slot.garment,
      unique_products: slot.unique_products,
      reformulated: slot.reformulated,
      queries: (slot.queries ?? []).map((q) => ({
        variant_index: q.variant_index,
        query: trunc(q.query, 160),
        status: q.status,
        raw_count: q.raw_count,
        duration_ms: q.duration_ms,
        reformulation: q.reformulation,
        lane: (q as { lane?: string }).lane,
        error: trunc(q.error, 200),
        // Keep request filters (price/category) — drop product payloads.
        filters: q.catalog_calls?.[0]?.request?.filters,
        top_titles: (q.products ?? []).slice(0, 8).map((p) => trunc(p.title, 80)),
      })),
      pool_top: (slot.pool ?? []).slice(0, 12).map(productMini),
    })),
  };
}

function minimizeFashionCuration(run: FashionCurationRunView): Record<string, unknown> {
  return {
    id: run.id,
    searchKey: run.searchKey,
    ts: run.ts,
    timing_ms: run.timing_ms,
    model: run.model,
    mode: run.mode,
    fallback: run.fallback,
    retries: run.retries,
    image_count: run.image_count,
    validation_issues: run.validation_issues,
    narration: run.narration,
    tiers_summary: run.tiers_summary,
    vetoes: (run.vetoes ?? []).map((v) => ({
      ref: v.ref,
      reason: v.reason,
      evidence: trunc(v.evidence, 200),
    })),
    looks: run.looks,
    slots: (run.slots ?? []).map((slot) => ({
      slot_id: slot.slot_id,
      garment: slot.garment,
      role: slot.role,
      candidates: (slot.candidates ?? []).slice(0, 20).map((c) => ({
        ref: c.ref,
        id: c.id,
        title: trunc(c.title, 100),
        store: c.store,
        price: c.priceLabel,
        picked: c.picked,
        vetoed: c.vetoed,
        veto_reason: c.veto_reason,
        role: c.pick_role,
        stylist_line: trunc(c.stylist_line, 160),
        image_shown: c.image_shown,
        score_rank: c.score_rank,
      })),
    })),
    // Truncated curator input — enough to see brief/tension, not full dump.
    input_text: trunc(run.input_text, PROMPT_MAX),
  };
}

function minimizePlanner(run: QueryPlannerRunView): Record<string, unknown> {
  return {
    id: run.id,
    step: run.step,
    model: run.model,
    ts: run.ts,
    sequence: run.sequence,
    prompt: trunc(run.promptText, PROMPT_MAX),
    result: trunc(run.resultText, PROMPT_MAX),
  };
}

function minimizeMessage(m: ChatMessage): Record<string, unknown> {
  const meta = m.metadata;
  const out: Record<string, unknown> = {
    id: m.id,
    role: m.role,
    content: trunc(m.content, 2_000),
    status: m.status,
    createdAt: m.createdAt,
  };

  if (!meta) return out;

  const slim: Record<string, unknown> = {};
  if (meta.fashionRouter) {
    slim.fashionRouter = {
      move: meta.fashionRouter.move,
      trace_id: meta.fashionRouter.trace_id,
      brief: meta.fashionRouter.brief
        ? {
            request_type: meta.fashionRouter.brief.request_type,
            garments: meta.fashionRouter.brief.garments,
            occasion: meta.fashionRouter.brief.occasion_context,
            budget: meta.fashionRouter.brief.budget_context,
            style: trunc(meta.fashionRouter.brief.style_direction, 200),
            department:
              meta.fashionRouter.brief.department_scope ??
              meta.fashionRouter.brief.knowledge_state?.department,
          }
        : undefined,
      reply: trunc(meta.fashionRouter.reply, 400),
    };
  }
  if (meta.fashionSearchPlan) {
    const plan = meta.fashionSearchPlan;
    slim.fashionSearchPlan = {
      mode: plan.mode,
      plan_source: plan.plan_source,
      slots: plan.slots?.map((s) => ({
        slot_id: s.slot_id,
        garment: s.garment,
        role: s.role,
        options_wanted: s.options_wanted,
        queries: s.query_variants,
        palette: s.palette_constraint,
        budget_fraction: s.budget_fraction,
      })),
      budget_allocation_validation: plan.budget_allocation_validation,
      per_slot_budget: plan.per_slot_budget,
      budget_assembly: plan.budget_assembly,
      budget_interpretation: plan.budget_interpretation,
    };
  }
  if (meta.fashionCatalogSearch) {
    const cat = meta.fashionCatalogSearch;
    slim.fashionCatalogSearch = {
      timing_ms: cat.timing_ms,
      trace_id: cat.trace_id,
      brand_narration: trunc(cat.brand_narration, 200),
      budget_tension: cat.budget_tension,
      budget_assembly: cat.budget_assembly,
      budget_interpretation: cat.budget_interpretation,
      slots: cat.slots?.map((s) => ({
        slot_id: s.slot_id,
        garment: s.garment,
        thin_slot: s.thin_slot,
        brand_status: s.brand_status,
        counts: s.counts,
        query_variants_used: s.query_variants_used,
        dropped: (s.dropped ?? []).slice(0, 30).map((d) => ({
          id: d.product_id,
          rule: d.rule,
          evidence: trunc(d.evidence, 120),
        })),
        verified_pool: (s.verified_pool ?? []).slice(0, 12).map((p) => ({
          id: p.id,
          title: trunc(p.title, 100),
          price: p.final_price ?? p.price,
          size_status: p.size_status,
          shop: p.shop_domain,
          score: p.score?.final,
          suspicions: p.suspicions?.map((x) => x.rule),
        })),
      })),
      curation: cat.curation
        ? {
            narration: cat.curation.narration,
            meta: cat.curation.meta,
            picks: cat.curation.tiers?.picks?.slice(0, 20).map((p) => ({
              ref: p.ref,
              slot_id: p.slot_id,
              garment: p.garment,
              role: p.role,
              title: trunc(p.title, 100),
              stylist_line: trunc(p.stylist_line, 160),
              id: p.id,
            })),
          }
        : undefined,
    };
  }
  if (meta.productSearch) {
    slim.productSearch = {
      searches: meta.productSearch.searches?.map((s) => ({
        searchKey: s.searchKey,
        query: trunc(s.query, 160),
        intent: s.intent,
        product_count: s.products?.length,
        curated_picks: s.curatedPicks?.slice(0, 8).map((p) => ({
          id: p.id,
          slot: p.slot,
          title: trunc(p.title, 100),
          reason: trunc(p.reason, 160),
        })),
        curationFallback: s.curationFallback,
        error: trunc(s.error, 200),
      })),
    };
  }
  if (meta.clarification) slim.clarification = meta.clarification;
  if (meta.topicGuard) slim.topicGuard = meta.topicGuard;

  if (Object.keys(slim).length) out.meta = slim;
  return out;
}

export type ChatDebugExportInput = {
  conversationId: string | null;
  messages: ChatMessage[];
  pipelineRuns: SearchPipelineRunView[];
  fashionCatalogRuns: FashionCatalogRunView[];
  fashionCurationRuns: FashionCurationRunView[];
  queryPlannerRuns: QueryPlannerRunView[];
  exportedAt?: string;
};

export type ChatDebugExportPayload = {
  format: "shoop_chat_debug_ai_v1";
  exported_at: string;
  conversation_id: string | null;
  note: string;
  chat: ReturnType<typeof minimizeMessage>[];
  fashion_catalog_debug: ReturnType<typeof minimizeFashionCatalog>[];
  fashion_curation_debug: ReturnType<typeof minimizeFashionCuration>[];
  search_pipeline_debug: ReturnType<typeof minimizePipeline>[];
  query_planner_debug: ReturnType<typeof minimizePlanner>[];
};

/** Compact JSON object suitable for pasting into another AI. */
export function buildChatDebugExportForAi(
  input: ChatDebugExportInput,
): ChatDebugExportPayload {
  return {
    format: "shoop_chat_debug_ai_v1",
    exported_at: input.exportedAt ?? new Date().toISOString(),
    conversation_id: input.conversationId,
    note:
      "Minimized Shoop chat+pipeline dump for AI review. Images/catalog blobs/long prompts truncated. Prefer fashion_* over search_pipeline for outfit flows.",
    chat: input.messages.map(minimizeMessage),
    fashion_catalog_debug: input.fashionCatalogRuns.map(minimizeFashionCatalog),
    fashion_curation_debug: input.fashionCurationRuns.map(minimizeFashionCuration),
    search_pipeline_debug: input.pipelineRuns.map(minimizePipeline),
    query_planner_debug: input.queryPlannerRuns.map(minimizePlanner),
  };
}

export function chatDebugExportToJson(payload: ChatDebugExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function downloadChatDebugExport(
  payload: ChatDebugExportPayload,
  filename?: string,
): void {
  const json = chatDebugExportToJson(payload);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const id = payload.conversation_id?.slice(0, 8) ?? "chat";
  a.href = url;
  a.download =
    filename ??
    `shoop-debug-${id}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyChatDebugExport(
  payload: ChatDebugExportPayload,
): Promise<boolean> {
  const json = chatDebugExportToJson(payload);
  try {
    await navigator.clipboard.writeText(json);
    return true;
  } catch {
    return false;
  }
}
