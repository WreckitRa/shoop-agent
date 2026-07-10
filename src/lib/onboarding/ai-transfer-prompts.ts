export const PRIMARY_AI_ASSISTANTS = [
  { id: "chatgpt", label: "ChatGPT", provider: "OpenAI" },
  { id: "claude", label: "Claude", provider: "Anthropic" },
  { id: "gemini", label: "Gemini", provider: "Google" },
  { id: "copilot", label: "Copilot", provider: "Microsoft" },
  { id: "perplexity", label: "Perplexity", provider: "Perplexity AI" },
  { id: "meta_ai", label: "Meta AI", provider: "Meta" },
  { id: "other", label: "Other", provider: "Any assistant" },
] as const;

export type PrimaryAiAssistantId = (typeof PRIMARY_AI_ASSISTANTS)[number]["id"];

const BASE_PROFILE_ASK =
  "Write a short shopping profile for me: my style, sizes, brands I like and avoid, budget, hard no's, owned products, and what I usually shop for.";

const TRANSFER_PROMPTS: Record<PrimaryAiAssistantId, string> = {
  chatgpt: `${BASE_PROFILE_ASK} Keep it to one concise paragraph I can copy and paste elsewhere. Include specific sizes and currencies where you know them.`,
  claude: `${BASE_PROFILE_ASK} Reply in a single, well-organized paragraph I can copy. Be specific about sizes, location, and currency when relevant.`,
  gemini: `${BASE_PROFILE_ASK} Answer in one clear paragraph I can copy. Include sizes, brands, budget, and anything I should never buy.`,
  copilot: `${BASE_PROFILE_ASK} Give me one short paragraph I can copy. Include sizes, preferred brands, and deal-breakers.`,
  perplexity: `${BASE_PROFILE_ASK} Respond in one copy-ready paragraph with concrete details — sizes, brands, budget, and hard avoids.`,
  meta_ai: `${BASE_PROFILE_ASK} Reply in one paragraph I can copy. Cover style, sizes, brands, budget, and products I already own.`,
  other: `${BASE_PROFILE_ASK} Keep it to one concise paragraph I can copy and paste.`,
};

export function isPrimaryAiAssistantId(value: string): value is PrimaryAiAssistantId {
  return PRIMARY_AI_ASSISTANTS.some((a) => a.id === value);
}

export function getAiAssistantOption(id: PrimaryAiAssistantId) {
  return PRIMARY_AI_ASSISTANTS.find((a) => a.id === id);
}

export function getTransferPrompt(id: PrimaryAiAssistantId): string {
  return TRANSFER_PROMPTS[id];
}
