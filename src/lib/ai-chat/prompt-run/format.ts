import type {
  ContentBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages/messages";

type Turn = { role: string; content: string | ContentBlockParam[] };

/** Normalize Anthropic `system` param to plain text for audit storage. */
export function systemPromptText(
  system: MessageCreateParamsNonStreaming["system"],
): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system
    .map((block) => {
      if (block.type === "text") return block.text;
      return JSON.stringify(block, null, 2);
    })
    .join("\n\n");
}

function formatContent(content: string | ContentBlockParam[]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "tool_use") {
        return `[tool_use name=${block.name} id=${block.id}]\n${JSON.stringify(block.input, null, 2)}`;
      }
      if (block.type === "tool_result") {
        const body =
          typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content, null, 2);
        return `[tool_result tool_use_id=${block.tool_use_id}]\n${body}`;
      }
      return JSON.stringify(block, null, 2);
    })
    .join("\n\n");
}

/** Human-readable exact prompt bundle for admin audit. */
export function formatPromptBundle(system: string, messages: Turn[]): string {
  const parts = [`=== SYSTEM ===\n${system}`];
  for (const m of messages) {
    parts.push(`=== ${m.role.toUpperCase()} ===\n${formatContent(m.content)}`);
  }
  return parts.join("\n\n");
}

/** Serialize an Anthropic API response for audit storage. */
export function formatAnthropicMessageResult(msg: Message): string {
  const header = [
    `stop_reason: ${msg.stop_reason ?? "—"}`,
    `model: ${msg.model}`,
    msg.usage
      ? `usage: input=${msg.usage.input_tokens} output=${msg.usage.output_tokens}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const body = msg.content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "tool_use") {
        return `[tool_use name=${block.name} id=${block.id}]\n${JSON.stringify(block.input, null, 2)}`;
      }
      return JSON.stringify(block, null, 2);
    })
    .join("\n\n");

  return `${header}\n\n${body}`;
}
