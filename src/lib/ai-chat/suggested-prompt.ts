import { createLightweightMessage } from "./anthropic";
import { userVisibleConversationWhere } from "./conversation-visibility";
import { prisma } from "./db";
import { logAiChat } from "./observability";

const FALLBACK_PROMPTS = [
  "Best TV for a bright living room under $1,500.",
  "Comfortable running shoes for wide feet under $120.",
  "A minimalist desk lamp that won't glare on my monitor.",
  "Gift ideas for a coffee lover who already has a pour-over setup.",
  "Waterproof jacket for rainy city commutes, size M.",
] as const;

const PROMPT_SYSTEM = `You write a single suggested shopping question for a text input placeholder.
Return ONLY the placeholder text — no quotes, no preamble, no markdown.
Rules:
- One natural question or search phrase the user might type (8–90 characters).
- Personalize using the shopper context when available (location, sizes, brands, past searches, active intents).
- Vary the category and angle from recent searches; don't repeat the same product type twice in a row.
- Sound like the user talking ("I need…", "Best … under $X", "Gift for …").
- Never mention being an AI or placeholder.`;

type PromptCacheEntry = { prompt: string; expiresAt: number };

const promptCache = new Map<string, PromptCacheEntry>();
const CACHE_TTL_MS = 5 * 60_000;

function pickFallback(seed = 0): string {
  return FALLBACK_PROMPTS[Math.abs(seed) % FALLBACK_PROMPTS.length]!;
}

function cacheKey(userId: string, conversationId: string | null): string {
  return `${userId}:${conversationId ?? "new"}`;
}

function sanitizePrompt(raw: string): string | null {
  const text = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ");
  if (text.length < 8 || text.length > 90) return null;
  return text;
}

async function gatherShopperContext(
  userId: string,
  conversationId: string | null,
): Promise<string> {
  const [profile, intents, recentUserMessages, summary, recentTitles] =
    await Promise.all([
      prisma.userProfile.findUnique({
        where: { userId },
        select: {
          preferredName: true,
          country: true,
          city: true,
          currency: true,
          genderPresentation: true,
          lifestyleTags: true,
          valuePhilosophy: true,
          dealSensitivity: true,
        },
      }),
      prisma.shoppingIntent.findMany({
        where: { userId, status: "active" },
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
        take: 4,
        select: {
          intentName: true,
          description: true,
          category: true,
          constraints: true,
        },
      }),
      prisma.message.findMany({
        where: {
          role: "user",
          conversation: { userId },
          ...(conversationId ? { conversationId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: conversationId ? 6 : 10,
        select: { content: true, conversationId: true },
      }),
      conversationId
        ? prisma.conversationContextSummary.findUnique({
            where: { conversationId },
            select: { summary: true },
          })
        : Promise.resolve(null),
      conversationId
        ? null
        : prisma.conversation.findMany({
            where: userVisibleConversationWhere(userId),
            orderBy: { updatedAt: "desc" },
            take: 5,
            select: { title: true },
          }),
    ]);

  const lines: string[] = [];

  if (profile) {
    const bits = [
      profile.preferredName ? `Name: ${profile.preferredName}` : null,
      profile.city && profile.country
        ? `Location: ${profile.city}, ${profile.country}`
        : profile.country
          ? `Country: ${profile.country}`
          : null,
      profile.currency ? `Currency: ${profile.currency}` : null,
      profile.genderPresentation
        ? `Style context: ${profile.genderPresentation}`
        : null,
      profile.lifestyleTags.length
        ? `Lifestyle: ${profile.lifestyleTags.slice(0, 6).join(", ")}`
        : null,
      profile.valuePhilosophy
        ? `Values: ${profile.valuePhilosophy}`
        : null,
      profile.dealSensitivity
        ? `Deal sensitivity: ${profile.dealSensitivity}`
        : null,
    ].filter(Boolean);
    if (bits.length) lines.push(bits.join("\n"));
  }

  if (intents.length) {
    lines.push(
      "Active shopping intents:\n" +
        intents
          .map((i) => {
            const constraints =
              i.constraints && typeof i.constraints === "object"
                ? (i.constraints as Record<string, unknown>)
                : {};
            const budgetMax =
              typeof constraints.budgetMax === "number"
                ? constraints.budgetMax
                : typeof constraints.budgetMax === "string"
                  ? constraints.budgetMax
                  : null;
            const parts = [
              i.intentName,
              i.category,
              budgetMax ? `budget ≤ ${budgetMax}` : null,
              i.description,
            ]
              .filter(Boolean)
              .join(" · ");
            return `- ${parts}`;
          })
          .join("\n"),
    );
  }

  if (recentTitles?.length) {
    lines.push(
      "Recent chats:\n" + recentTitles.map((c) => `- ${c.title}`).join("\n"),
    );
  }

  const searches = recentUserMessages
    .map((m) => m.content.trim())
    .filter((c) => c.length > 0)
    .slice(0, 8);
  if (searches.length) {
    lines.push("Recent user searches/messages:\n" + searches.map((s) => `- ${s.slice(0, 160)}`).join("\n"));
  }

  if (summary?.summary?.trim()) {
    lines.push(`Current chat summary: ${summary.summary.trim().slice(0, 500)}`);
  }

  return lines.join("\n\n").slice(0, 4000);
}

export async function generateSuggestedPrompt(
  userId: string,
  conversationId: string | null = null,
): Promise<string> {
  const key = cacheKey(userId, conversationId);
  const cached = promptCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.prompt;
  }

  const context = await gatherShopperContext(userId, conversationId);
  if (!context.trim()) {
    const fallback = pickFallback(Date.now());
    promptCache.set(key, { prompt: fallback, expiresAt: Date.now() + CACHE_TTL_MS });
    return fallback;
  }

  try {
    const msg = await createLightweightMessage(
      {
        max_tokens: 120,
        temperature: 0.9,
        system: PROMPT_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Shopper context:\n${context}\n\nWrite one fresh placeholder suggestion.`,
          },
        ],
      },
      {
        audit: {
          userId,
          kind: "suggested_prompt",
          conversationId,
          sequence: 0,
        },
      },
    );

    const block = msg.content.find((b) => b.type === "text");
    const parsed = block?.type === "text" ? sanitizePrompt(block.text) : null;
    const prompt = parsed ?? pickFallback(context.length);

    promptCache.set(key, { prompt, expiresAt: Date.now() + CACHE_TTL_MS });
    return prompt;
  } catch (err) {
    logAiChat("warn", "suggested_prompt_failed", { userId, err: String(err) });
    const fallback = pickFallback(context.length);
    promptCache.set(key, { prompt: fallback, expiresAt: Date.now() + 60_000 });
    return fallback;
  }
}

export function invalidateSuggestedPromptCache(
  userId: string,
  conversationId?: string | null,
): void {
  if (conversationId) {
    promptCache.delete(cacheKey(userId, conversationId));
  }
  promptCache.delete(cacheKey(userId, null));
}

export { FALLBACK_PROMPTS, pickFallback };
