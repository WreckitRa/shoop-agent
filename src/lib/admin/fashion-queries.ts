import { prisma } from "@/lib/ai-chat/db";
import type { MessageMetadata } from "@/lib/ai-chat/types";
import type { MessageFashionCatalogSearchMetaV1 } from "@/lib/fashion-memory/catalog-search/types";
import { fashionMemoryDb } from "@/lib/fashion-memory/db";
import type {
  FashionCatalogRunDetail,
  FashionCatalogRunSummary,
  FashionPipelineEventRow,
  FashionTraceRow,
} from "./fashion-types";

function readCatalogSearch(
  metadata: MessageMetadata | null | undefined,
): MessageFashionCatalogSearchMetaV1 | null {
  const cs = metadata?.fashionCatalogSearch;
  if (!cs?.slots?.length) return null;
  return cs;
}

function summarizeRun(params: {
  messageId: string;
  conversationId: string;
  conversationTitle: string | null;
  userId: string;
  createdAt: Date;
  catalogSearch: MessageFashionCatalogSearchMetaV1;
  flagged?: boolean;
}): FashionCatalogRunSummary {
  const droppedCount = params.catalogSearch.slots.reduce(
    (n, s) => n + (s.dropped?.length ?? 0),
    0,
  );
  const survivorCount = params.catalogSearch.slots.reduce(
    (n, s) => n + (s.verified_pool?.length ?? 0),
    0,
  );
  return {
    messageId: params.messageId,
    conversationId: params.conversationId,
    conversationTitle: params.conversationTitle,
    userId: params.userId,
    createdAt: params.createdAt.toISOString(),
    traceId: params.catalogSearch.trace_id ?? null,
    mode: params.catalogSearch.slots.length > 1 ? "multi_slot" : "single_slot",
    slotCount: params.catalogSearch.slots.length,
    survivorCount,
    droppedCount,
    timingMs: params.catalogSearch.timing_ms,
    garments: params.catalogSearch.slots.map((s) => s.garment),
    flagged: params.flagged ?? false,
  };
}

async function flaggedTraceIds(traceIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!traceIds.length) return out;
  const db = fashionMemoryDb();
  const { data, error } = await db
    .from("pipeline_events")
    .select("trace_id")
    .in("trace_id", traceIds)
    .eq("stage", "invariant_warning");
  if (error || !data) return out;
  for (const row of data as Array<{ trace_id: string | null }>) {
    if (row.trace_id) out.add(String(row.trace_id));
  }
  return out;
}

export async function listFashionCatalogRuns(params: {
  limit?: number;
  conversationId?: string;
}): Promise<FashionCatalogRunSummary[]> {
  const limit = params.limit ?? 40;
  const rows = await prisma.message.findMany({
    where: {
      role: "assistant",
      ...(params.conversationId
        ? { conversationId: params.conversationId }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(limit * 5, 100),
    select: {
      id: true,
      conversationId: true,
      createdAt: true,
      metadata: true,
      conversation: { select: { title: true, userId: true } },
    },
  });

  const runs: FashionCatalogRunSummary[] = [];
  for (const row of rows) {
    const metadata = row.metadata as MessageMetadata | null;
    const catalogSearch = readCatalogSearch(metadata);
    if (!catalogSearch) continue;
    runs.push(
      summarizeRun({
        messageId: row.id,
        conversationId: row.conversationId,
        conversationTitle: row.conversation.title,
        userId: row.conversation.userId,
        createdAt: row.createdAt,
        catalogSearch,
      }),
    );
    if (runs.length >= limit) break;
  }

  const traceIds = runs.map((r) => r.traceId).filter((id): id is string => Boolean(id));
  const flagged = await flaggedTraceIds(traceIds);
  return runs.map((r) => ({
    ...r,
    flagged: r.traceId ? flagged.has(r.traceId) : false,
  }));
}

async function loadTrace(traceId: string): Promise<FashionTraceRow | null> {
  const db = fashionMemoryDb();
  const { data, error } = await db
    .from("traces")
    .select("*")
    .eq("id", traceId)
    .maybeSingle();
  if (error || !data) return null;
  return data as FashionTraceRow;
}

async function loadPipelineEvents(
  traceId: string,
): Promise<FashionPipelineEventRow[]> {
  const db = fashionMemoryDb();
  const { data, error } = await db
    .from("pipeline_events")
    .select("id, stage, payload, created_at")
    .eq("trace_id", traceId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as Array<{
    id: string | number;
    stage: string;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>).map((row) => ({
    id: String(row.id),
    stage: String(row.stage),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    created_at: String(row.created_at),
  }));
}

async function findMessageForTrace(traceId: string) {
  const trace = await loadTrace(traceId);
  if (!trace) return null;

  const messages = await prisma.message.findMany({
    where: {
      conversationId: trace.conversation_id,
      role: "assistant",
    },
    orderBy: { createdAt: "desc" },
    take: 32,
    select: {
      id: true,
      conversationId: true,
      createdAt: true,
      metadata: true,
      conversation: { select: { title: true, userId: true } },
    },
  });

  for (const row of messages) {
    const metadata = row.metadata as MessageMetadata | null;
    const cs = readCatalogSearch(metadata);
    if (cs?.trace_id === traceId) {
      return { row, metadata, catalogSearch: cs };
    }
  }

  for (const row of messages) {
    const metadata = row.metadata as MessageMetadata | null;
    const cs = readCatalogSearch(metadata);
    if (cs) return { row, metadata, catalogSearch: cs };
  }

  return null;
}

export async function getFashionCatalogRunByMessageId(
  messageId: string,
): Promise<FashionCatalogRunDetail | null> {
  const row = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      conversationId: true,
      createdAt: true,
      metadata: true,
      conversation: { select: { title: true, userId: true } },
    },
  });
  if (!row) return null;
  const metadata = row.metadata as MessageMetadata | null;
  const catalogSearch = readCatalogSearch(metadata);
  if (!catalogSearch) return null;

  const traceId = catalogSearch.trace_id ?? null;
  const [trace, pipelineEvents, flagged] = await Promise.all([
    traceId ? loadTrace(traceId) : Promise.resolve(null),
    traceId ? loadPipelineEvents(traceId) : Promise.resolve([]),
    traceId ? flaggedTraceIds([traceId]) : Promise.resolve(new Set<string>()),
  ]);

  return {
    run: summarizeRun({
      messageId: row.id,
      conversationId: row.conversationId,
      conversationTitle: row.conversation.title,
      userId: row.conversation.userId,
      createdAt: row.createdAt,
      catalogSearch,
      flagged: traceId ? flagged.has(traceId) : false,
    }),
    catalogSearch,
    fashionRouter: metadata?.fashionRouter,
    fashionSearchPlan: metadata?.fashionSearchPlan,
    trace,
    pipelineEvents,
  };
}

export async function getFashionCatalogRunByTraceId(
  traceId: string,
): Promise<FashionCatalogRunDetail | null> {
  const found = await findMessageForTrace(traceId);
  if (!found) {
    const [trace, pipelineEvents] = await Promise.all([
      loadTrace(traceId),
      loadPipelineEvents(traceId),
    ]);
    if (!trace) return null;
    return {
      run: {
        messageId: "",
        conversationId: trace.conversation_id,
        conversationTitle: null,
        userId: trace.user_id,
        createdAt: trace.created_at,
        traceId,
        mode: (trace.summary as { mode?: string } | null)?.mode ?? null,
        slotCount: 0,
        survivorCount: 0,
        droppedCount: 0,
        timingMs: Number((trace.summary as { total_ms?: number } | null)?.total_ms ?? 0),
        garments: [],
        flagged: pipelineEvents.some((e) => e.stage === "invariant_warning"),
      },
      catalogSearch: { version: 1, slots: [], timing_ms: 0, trace_id: traceId },
      fashionRouter: undefined,
      fashionSearchPlan: undefined,
      trace,
      pipelineEvents,
    };
  }

  return getFashionCatalogRunByMessageId(found.row.id);
}
