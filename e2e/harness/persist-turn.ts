import type { MessageMetadata } from "@/lib/ai-chat/types";
import {
  fashionCatalogSearchToMetadata,
} from "@/lib/fashion-memory/catalog-search";
import { fashionSearchPlanToMetadata } from "@/lib/fashion-memory/search-planner/plan-from-brief";
import type { TurnArtifacts } from "../types";
import type { InMemoryPrismaStore, MemoryConversation } from "./in-memory-prisma";

export function seedE2eConversation(params: {
  store: InMemoryPrismaStore;
  conversationId: string;
  userId: string;
}): void {
  const now = new Date();
  const row: MemoryConversation = {
    id: params.conversationId,
    title: "E2E",
    userId: params.userId,
    model: "mock",
    temperature: 0.7,
    maxTokens: 4096,
    responseStyle: "balanced",
    systemPrompt: null,
    shippingCountry: "US",
    currency: "USD",
    archived: false,
    deletedAt: null,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  params.store.conversations.set(params.conversationId, row);
  params.store.branches.set(`branch_${params.conversationId}`, {
    id: `branch_${params.conversationId}`,
    conversationId: params.conversationId,
    index: 0,
    title: "E2E",
    anchorMessageId: null,
    createdAt: now,
    updatedAt: now,
  });
}

export function persistSearchTurn(params: {
  store: InMemoryPrismaStore;
  artifacts: TurnArtifacts;
  conversationId: string;
  userId: string;
}): void {
  const { artifacts, store, conversationId, userId } = params;
  if (!artifacts.plan || !artifacts.catalog) return;

  const metadata: MessageMetadata = {
    fashionRouter: {
      version: 1,
      move: "ready_to_search",
      brief: artifacts.brief!,
      trace_id: artifacts.traceId,
    },
    fashionSearchPlan: fashionSearchPlanToMetadata(artifacts.plan, {
      trace_id: artifacts.traceId,
    }),
    fashionCatalogSearch: fashionCatalogSearchToMetadata(artifacts.catalog, {
      trace_id: artifacts.traceId,
    }),
  };

  const existing = store.messages.get(artifacts.searchId);
  if (existing) {
    existing.metadata = metadata;
    existing.status = "completed";
    return;
  }

  store.messages.set(artifacts.searchId, {
    id: artifacts.searchId,
    conversationId,
    role: "assistant",
    content: "E2E search turn",
    status: "completed",
    model: "mock",
    metadata,
    branchId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    inputTokens: null,
    outputTokens: null,
    finishReason: "fashion_router",
    error: null,
  });

  if (!store.conversations.has(conversationId)) {
    store.conversations.set(conversationId, {
      id: conversationId,
      title: "E2E",
      userId,
      model: "mock",
      temperature: 0.7,
      maxTokens: 4096,
      responseStyle: "balanced",
      systemPrompt: null,
      shippingCountry: "US",
      currency: "USD",
      archived: false,
      deletedAt: null,
      pinned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
