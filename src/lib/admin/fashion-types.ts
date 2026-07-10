import type { MessageFashionCatalogSearchMetaV1 } from "@/lib/fashion-memory/catalog-search/types";
import type { MessageMetadata } from "@/lib/ai-chat/types";

export type FashionPipelineEventRow = {
  id: string;
  stage: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type FashionTraceRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  kind: string;
  status: string;
  summary: Record<string, unknown> | null;
  created_at: string;
  closed_at: string | null;
};

export type FashionCatalogRunSummary = {
  messageId: string;
  conversationId: string;
  conversationTitle: string | null;
  userId: string;
  createdAt: string;
  traceId: string | null;
  mode: string | null;
  slotCount: number;
  survivorCount: number;
  droppedCount: number;
  timingMs: number;
  garments: string[];
  flagged: boolean;
};

export type FashionCatalogRunDetail = {
  run: FashionCatalogRunSummary;
  catalogSearch: MessageFashionCatalogSearchMetaV1;
  fashionRouter: MessageMetadata["fashionRouter"];
  fashionSearchPlan: MessageMetadata["fashionSearchPlan"];
  trace: FashionTraceRow | null;
  pipelineEvents: FashionPipelineEventRow[];
};
