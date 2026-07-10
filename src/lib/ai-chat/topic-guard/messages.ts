import type { TopicGuardBlockCategory } from "./types";

const DEFAULT_REFUSAL = `I'm Shoop — a shopping concierge. I can help you find and compare products, refine sizes and budgets, and search our catalog.

I can't help with that request here. What are you shopping for today?`;

const REFUSALS: Record<TopicGuardBlockCategory, string> = {
  off_topic_general: DEFAULT_REFUSAL,
  off_topic_technical: `I'm built for product discovery and purchases, not general technical support or coding.

Tell me what you're trying to buy — category, budget, or occasion — and I'll search the catalog.`,
  off_topic_sensitive: `I can't provide medical, legal, financial, or other professional advice.

If you're shopping for something related to that topic — supplements, vitamins, wellness products, gear, gifts, or everyday products — describe what you want to buy and I'll search the catalog.`,
  jailbreak: `I can only help with shopping in this app. I won't change my role or ignore safety rules.

What product or gift are you looking for?`,
};

export function greetingResponse(): string {
  return `Hi! I'm Shoop, your shopping concierge. Tell me what you're looking for — a product, gift, outfit, or budget — and I'll search the catalog for you.`;
}

export function refusalForCategory(category: TopicGuardBlockCategory): string {
  return REFUSALS[category] ?? DEFAULT_REFUSAL;
}
