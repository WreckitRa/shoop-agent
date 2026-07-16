export type ChatSseHandlers = {
  onConversation?: (payload: {
    conversationId: string;
    shippingCountry?: string | null;
    currency?: string | null;
  }) => void;
  onUserMessage?: (
    messageId: string,
    payload: Record<string, unknown>,
  ) => void;
  onAssistantMessage?: (messageId: string) => void;
  onTextDelta?: (text: string) => void;
  onProductSearch?: (payload: Record<string, unknown>) => void;
  /** Out-of-band patch when Opus curator finishes for a prior product_search. */
  onProductSearchUpdate?: (payload: Record<string, unknown>) => void;
  /** Per-phase search engine progress line ({ searchKey, line }). */
  onNarrationLine?: (payload: Record<string, unknown>) => void;
  onModeResolved?: (payload: Record<string, unknown>) => void;
  /** Dev-only pipeline snapshots (requires AGENT_DEBUG=1). */
  onAgentDebug?: (payload: Record<string, unknown>) => void;
  /** Structured clarification chips — emitted before stream completes. */
  onClarification?: (payload: Record<string, unknown>) => void;
  /** Late-hydrated preview collages for clarification options. */
  onOptionPreviews?: (payload: Record<string, unknown>) => void;
  /** Gift direction picker — emitted before stream completes. */
  onGiftDirections?: (payload: Record<string, unknown>) => void;
  /** Guest fashion memory delta — client persists to localStorage. */
  onFashionMemoryDelta?: (payload: Record<string, unknown>) => void;
  /** Guest fashion memory full snapshot — client replaces localStorage. */
  onFashionMemorySnapshot?: (payload: Record<string, unknown>) => void;
  /** Guest fashion request event — direct write to localStorage (no LLM). */
  onFashionRequestEvent?: (payload: Record<string, unknown>) => void;
  /** Fashion catalog fan-out finished — attach rack metadata before `done`. */
  onFashionCatalogSearch?: (payload: Record<string, unknown>) => void;
  /** Fashion search pipeline lifecycle (started / complete). */
  onFashionPipeline?: (payload: Record<string, unknown>) => void;
  onDone?: (data: Record<string, unknown>) => void;
  onError?: (message: string) => void;
};

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    // Comment lines (heartbeats) start with `:` per the SSE spec — ignore them.
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

export async function consumeChatSseStream(
  response: Response,
  handlers: ChatSseHandlers,
): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let errored = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const rawBlock of parts) {
        const block = rawBlock.trim();
        if (!block) continue;
        const parsed = parseSseBlock(block);
        if (!parsed) continue;

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(parsed.data) as Record<string, unknown>;
        } catch {
          continue;
        }

        switch (parsed.event) {
          case "conversation":
            if (typeof payload.conversationId === "string") {
              handlers.onConversation?.({
                conversationId: payload.conversationId,
                shippingCountry:
                  typeof payload.shippingCountry === "string"
                    ? payload.shippingCountry
                    : null,
                currency:
                  typeof payload.currency === "string" ? payload.currency : null,
              });
            }
            break;
          case "user_message":
            if (typeof payload.messageId === "string") {
              handlers.onUserMessage?.(payload.messageId, payload);
            }
            break;
          case "assistant_message":
            if (typeof payload.messageId === "string") {
              handlers.onAssistantMessage?.(payload.messageId);
            }
            break;
          case "text_delta":
            if (typeof payload.text === "string") {
              handlers.onTextDelta?.(payload.text);
            }
            break;
          case "product_search":
            handlers.onProductSearch?.(payload);
            break;
          case "product_search_update":
            handlers.onProductSearchUpdate?.(payload);
            break;
          case "narration_line":
            handlers.onNarrationLine?.(payload);
            break;
          case "mode_resolved":
            handlers.onModeResolved?.(payload);
            break;
          case "agent_debug":
            handlers.onAgentDebug?.(payload);
            break;
          case "clarification":
            handlers.onClarification?.(payload);
            break;
          case "option_previews":
            handlers.onOptionPreviews?.(payload);
            break;
          case "gift_directions":
            handlers.onGiftDirections?.(payload);
            break;
          case "fashion_memory_delta":
            handlers.onFashionMemoryDelta?.(payload);
            break;
          case "fashion_memory_snapshot":
            handlers.onFashionMemorySnapshot?.(payload);
            break;
          case "fashion_request_event":
            handlers.onFashionRequestEvent?.(payload);
            break;
          case "fashion_catalog_search":
            handlers.onFashionCatalogSearch?.(payload);
            break;
          case "fashion_pipeline":
            handlers.onFashionPipeline?.(payload);
            break;
          case "done":
            handlers.onDone?.(payload);
            break;
          case "error":
            if (typeof payload.message === "string") {
              errored = true;
              handlers.onError?.(payload.message);
            }
            break;
          default:
            break;
        }
      }
    }
  } catch (err) {
    // Re-throw abort errors so the caller's try/catch sees them.
    if (err instanceof Error && err.name === "AbortError") throw err;
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    // Other errors (connection reset, etc.) — surface as error so the caller can retry.
    throw err;
  }

  return errored;
}
