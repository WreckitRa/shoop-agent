import { createLightweightMessage } from "./anthropic";
import { NEW_CHAT_TITLE } from "./constants";
import { logAiChat } from "./observability";
import type { LightweightPromptAudit } from "./prompt-run/lightweight-audit";

const TITLE_SYSTEM = `You write short sidebar titles for a shopping assistant chat.
Return ONLY the title — no quotes, no markdown, no trailing period.
Rules:
- 3–6 words when possible, hard max 40 characters
- Name what the user is shopping for (product, attributes, occasion, recipient)
- Natural phrasing (e.g. "Structured navy jackets", "Running shoes under $120")
- Do not start with "User", "Looking for", or "Help with"
- Infer the shopping topic even if the message is casual or vague`;

function truncateTitle(text: string, max = 40): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trim()}…`;
}

export function sanitizeConversationTitle(raw: string): string | null {
  const text = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ");
  if (text.length < 2) return null;
  return truncateTitle(text, 40);
}

/** Heuristic fallback when the model is unavailable. */
export function fallbackConversationTitle(firstUserMessage: string): string {
  const t = truncateTitle(firstUserMessage, 40);
  return t || NEW_CHAT_TITLE;
}

export async function generateConversationTitle(
  firstUserMessage: string,
  signal?: AbortSignal,
  audit?: LightweightPromptAudit,
): Promise<string> {
  const trimmed = firstUserMessage.trim();
  if (!trimmed) return NEW_CHAT_TITLE;

  try {
    const response = await createLightweightMessage(
      {
        max_tokens: 48,
        temperature: 0.3,
        system: TITLE_SYSTEM,
        messages: [
          {
            role: "user",
            content: `First user message:\n\n${trimmed.slice(0, 2000)}`,
          },
        ],
      },
      audit ? { signal, audit } : signal ? { signal } : undefined,
    );

    const block = response.content.find((b) => b.type === "text");
    const parsed =
      block?.type === "text" ? sanitizeConversationTitle(block.text) : null;
    if (parsed) return parsed;
  } catch (err) {
    if (signal?.aborted) throw err;
    logAiChat("warn", "conversation_title_generation_failed", {
      error: String(err),
    });
  }

  return fallbackConversationTitle(trimmed);
}
