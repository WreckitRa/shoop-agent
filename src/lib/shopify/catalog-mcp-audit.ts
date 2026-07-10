import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import { prisma } from "@/lib/ai-chat/db";
import { logAiChat } from "@/lib/ai-chat/observability";
import type { CuratedPick } from "@/lib/ai-chat/types";

export type CatalogMcpExchange = {
  mcpUrl: string;
  agentProfileUrl: string;
  httpStatus: number;
  requestBody: Record<string, unknown>;
  responseBody: unknown;
};

export function buildCatalogMcpJsonRpcBody(
  toolName: string,
  catalogArgs: Record<string, unknown>,
  profileUrl: string,
  requestId: string | number,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    method: "tools/call",
    id: requestId,
    params: {
      name: toolName,
      arguments: {
        meta: {
          "ucp-agent": {
            profile: profileUrl,
          },
        },
        catalog: catalogArgs,
      },
    },
  };
}

/** Stored audit shape — secrets redacted. */
export function formatMcpRequestForStorage(
  mcpUrl: string,
  requestBody: Record<string, unknown>,
): InputJsonValue {
  return {
    method: "POST",
    url: mcpUrl,
    headers: {
      "Content-Type": "application/json",
      Authorization: "[REDACTED — SHOPIFY_CATALOG_CLIENT_ID token]",
    },
    body: requestBody,
  } as InputJsonValue;
}

export type CatalogSearchAuditContext = {
  userId: string;
  conversationId: string;
  userMessageId: string | null;
  assistantMessageId: string;
  searchKey: string;
  toolInput: Record<string, unknown>;
};

export type RecordCatalogSearchRunInput = CatalogSearchAuditContext & {
  attempt: number;
  query: string;
  callKind?: string | null;
  portfolioQueryId?: string | null;
  effectiveInput?: Record<string, unknown> | null;
  exchange?: CatalogMcpExchange | null;
  products?: unknown[];
  curatedPicks?: CuratedPick[];
  curationFallback?: boolean;
  engineSummary?: Record<string, unknown> | null;
  error?: string | null;
};

export function recordCatalogSearchRun(input: RecordCatalogSearchRunInput): void {
  const products = input.products ?? [];
  const exchange = input.exchange;

  void prisma.catalogSearchRun
    .create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        searchKey: input.searchKey,
        attempt: input.attempt,
        callKind: input.callKind ?? null,
        portfolioQueryId: input.portfolioQueryId ?? null,
        query: input.query.slice(0, 4000),
        toolInput: input.toolInput as InputJsonValue,
        effectiveInput: input.effectiveInput
          ? (input.effectiveInput as InputJsonValue)
          : undefined,
        mcpUrl: exchange?.mcpUrl ?? "",
        agentProfileUrl: exchange?.agentProfileUrl ?? "",
        mcpRequest: exchange
          ? formatMcpRequestForStorage(exchange.mcpUrl, exchange.requestBody)
          : ({} as InputJsonValue),
        mcpResponse: (exchange?.responseBody ?? {
          error: input.error ?? "no_exchange",
        }) as InputJsonValue,
        products: products as InputJsonValue,
        productCount: products.length,
        curatedPicks: input.curatedPicks
          ? (input.curatedPicks as unknown as InputJsonValue)
          : undefined,
        curationFallback: input.curationFallback ?? undefined,
        engineSummary: input.engineSummary
          ? (input.engineSummary as InputJsonValue)
          : undefined,
        error: input.error ?? null,
      },
    })
    .catch((error) => {
      logAiChat("warn", "catalog_search_run_persist_failed", {
        conversationId: input.conversationId,
        searchKey: input.searchKey,
        attempt: input.attempt,
        error,
      });
    });
}

export function updateCatalogSearchPicks(params: {
  assistantMessageId: string;
  searchKey: string;
  picks: CuratedPick[];
  fallback: boolean;
}): void {
  void prisma.catalogSearchRun
    .updateMany({
      where: {
        assistantMessageId: params.assistantMessageId,
        searchKey: params.searchKey,
      },
      data: {
        curatedPicks: params.picks as unknown as InputJsonValue,
        curationFallback: params.fallback,
      },
    })
    .catch((error) => {
      logAiChat("warn", "catalog_search_picks_update_failed", {
        assistantMessageId: params.assistantMessageId,
        searchKey: params.searchKey,
        error,
      });
    });
}
