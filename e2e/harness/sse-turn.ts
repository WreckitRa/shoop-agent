import { createFashionChatSseStream } from "@/lib/ai-chat/run-fashion-chat-stream";
import type { GuestFashionMemorySnapshot } from "@/lib/fashion-memory/local/store";
import type { TurnArtifacts } from "../types";
import type { createLlmMock } from "./llm-mock";
import { curationMessageFromSlots } from "./curation-recording";
import type { E2eScenario } from "../types";

export type SseEvent = {
  event: string;
  data: Record<string, unknown>;
};

export async function consumeFashionSseStream(params: {
  userId: string;
  message: string;
  conversationId?: string;
  guestSnapshot?: GuestFashionMemorySnapshot;
  scenario?: E2eScenario;
  llmMock?: ReturnType<typeof createLlmMock>;
}): Promise<{
  events: SseEvent[];
  conversationId?: string;
  assistantMessageId?: string;
  traceId?: string;
  done?: Record<string, unknown>;
}> {
  const useRefAligned = params.scenario?.ref_aligned_curation !== false;
  const stream = createFashionChatSseStream({
    userId: params.userId,
    body: {
      message: params.message,
      conversationId: params.conversationId,
      guestFashionMemory: params.guestSnapshot,
    },
    testHooks: params.llmMock
      ? {
          routerDeps: { createMessage: params.llmMock },
          plannerDeps: { createMessage: params.llmMock },
          createMessage: params.llmMock,
          resolveCurationMessage: useRefAligned
            ? ({ slots, plan }) =>
                curationMessageFromSlots({
                  plan,
                  slots,
                  options: params.scenario?.curation_options,
                })
            : undefined,
        }
      : undefined,
  });

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: SseEvent[] = [];
  let conversationId: string | undefined;
  let assistantMessageId: string | undefined;
  let traceId: string | undefined;
  let done: Record<string, unknown> | undefined;

  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const lines = part.split("\n");
      let event = "message";
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLine = line.slice(5).trim();
      }
      if (!dataLine || dataLine === "[DONE]") continue;
      try {
        const data = JSON.parse(dataLine) as Record<string, unknown>;
        events.push({ event, data });
        if (event === "conversation" && typeof data.conversationId === "string") {
          conversationId = data.conversationId;
        }
        if (event === "assistant_message" && typeof data.messageId === "string") {
          assistantMessageId = data.messageId;
        }
        if (event === "done") done = data;
      } catch {
        /* ignore parse errors on heartbeats */
      }
    }
  }

  const fashionRouter = events.find((e) => e.event === "fashion_router")?.data as
    | { trace_id?: string }
    | undefined;
  if (fashionRouter?.trace_id) traceId = fashionRouter.trace_id;

  return { events, conversationId, assistantMessageId, traceId, done };
}

export function artifactsFromSse(events: SseEvent[]): Partial<TurnArtifacts> {
  const router = events.find((e) => e.event === "fashion_router")?.data;
  const plan = events.find((e) => e.event === "fashion_search_plan")?.data?.plan;
  const catalogSearch = events.find((e) => e.event === "fashion_catalog_search")
    ?.data?.catalogSearch;
  return {
    routerResult: router as TurnArtifacts["routerResult"],
    brief: (router as { brief?: TurnArtifacts["brief"] })?.brief,
    plan: plan as TurnArtifacts["plan"],
    catalog: catalogSearch as TurnArtifacts["catalog"],
  };
}
