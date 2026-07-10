import { prisma } from "./db";
import type { ConversationRecord, MessageRecord } from "./prisma-types";
import { buildSystemPrompt, RECENT_MESSAGES_LIMIT } from "./constants";
import {
  homeCategoryMemoryHint,
  homeCategorySearchAddendum,
} from "@/lib/categories/home-categories";
import { getConversationContextSummary } from "./conversation-summary";
import { productSearchClarificationSystemAddendum } from "./search-clarification";
import { proposeGiftDirectionsSystemAddendum } from "./search/gift-directions";
import { shopifySearchSystemAddendum } from "./shopify-search-tool";
import { buildShoppingMemoryPromptXml } from "./shopping-memory/context";
import { buildSearchQueryHints } from "./shopping-memory/search-hints";
import {
  contextExpertiseSystemBlock,
  detectContextExpertise,
  getContextExpertiseByTag,
  shoppingModeSystemAddendum,
  type ShoppingMode,
} from "./shopping-mode";
import { topicGuardSystemAddendum } from "./topic-guard";
import { queryMentionsAnyCategory } from "./shopping-memory/category-detector";
import type { MessageMetadata, MessageProductSearchV1 } from "./types";

/** Cheap purchase-intent cues that warrant the full shopping context. */
const PURCHASE_HINT_RE =
  /\b(buy|shop|shopping|purchase|order|looking for|look for|need|want|recommend|suggest|gift|present|budget|under\s*\$?\d|over\s*\$?\d|deal|cheap|cheapest|afford|best|find me|show me|get me|wear|outfit|fit|size|brand|compare|alternative|similar|more like)\b/i;

/**
 * Decide whether this turn needs the heavy shopping blocks (full shopping
 * memory XML, search-query profile, domain expertise). Skipping them on pure
 * greetings / chit-chat cuts thousands of input tokens → faster first token.
 * Conservative: any shopping cue, mid-shopping continuity, or prior searches
 * keep the full context.
 */
function turnNeedsShoppingContext(
  hint: string,
  rows: Array<{ metadata?: unknown }>,
  sessionSignals: string,
): boolean {
  if (sessionSignals) return true;
  const h = hint.trim();
  if (h && (queryMentionsAnyCategory(h) || PURCHASE_HINT_RE.test(h))) {
    return true;
  }
  for (const r of rows) {
    const meta = r.metadata as MessageMetadata | null;
    if (meta?.productSearch?.searches?.length) return true;
  }
  return false;
}

export type AnthropicTurn = {
  role: "user" | "assistant";
  content: string;
};

export type BuiltContext = {
  systemPrompt: string;
  anthropicMessages: AnthropicTurn[];
  /**
   * Raw shopping-memory XML built for THIS turn. Re-exposed so downstream
   * passes (e.g. the Opus curator after a catalog search) can reuse it
   * instead of re-running the ~14-query projection fetch.
   */
  shoppingMemoryXml: string;
};

/**
 * W6: Scans the last few assistant messages in a conversation for product
 * search invocations and pairs them with subsequent user reactions to build
 * an in-session taste-signal block.
 *
 * This lets the model know what was already shown, avoid exact repeats, and
 * bias subsequent queries toward styles/brands the user expressed interest in.
 */
async function buildSessionSignals(conversationId: string): Promise<string> {
  const recentMessages = await prisma.message.findMany({
    where: {
      conversationId,
      role: { in: ["user", "assistant"] },
      status: { in: ["completed", "stopped"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 10,
    select: { id: true, role: true, content: true, metadata: true, createdAt: true },
  });

  // Re-order oldest-first so we can pair assistant searches with subsequent user replies
  const chronological = [...recentMessages].reverse();

  type ShownItem = { title: string; id: string };
  const shown: ShownItem[] = [];
  const seenIds = new Set<string>();
  const positiveSignals: ShownItem[] = [];
  const negativeSignals: string[] = [];

  for (let i = 0; i < chronological.length; i++) {
    const msg = chronological[i];
    if (msg.role !== "assistant") continue;

    const meta = msg.metadata as MessageMetadata | null;
    const ps = meta?.productSearch as MessageProductSearchV1 | null;
    if (!ps?.searches?.length) continue;

    // Collect products from the last 2 search turns to avoid prompt bloat.
    // We carry the product id so the model can pass it to
    // `similar_to_product_ids` for "more like this" on a later turn.
    for (const search of ps.searches.slice(0, 2)) {
      for (const p of (search.products ?? []).slice(0, 6)) {
        if (p.title && p.id && !seenIds.has(p.id)) {
          seenIds.add(p.id);
          shown.push({ title: p.title, id: p.id });
        }
      }
    }

    // Look at the user message that immediately follows this assistant turn
    const nextUser = chronological[i + 1];
    if (!nextUser || nextUser.role !== "user") continue;
    const userText = (nextUser.content ?? "").toLowerCase();

    // Heuristic positive signals
    if (
      /\b(i (?:like|love|want|prefer)|that(?:'s| is) (?:perfect|great|nice|cool|good)|yes|get|buy|add to cart|show me more like|more like)\b/.test(
        userText,
      )
    ) {
      const first = ps.searches[0]?.products?.[0];
      if (first?.title && first?.id) {
        positiveSignals.push({ title: first.title, id: first.id });
      }
    }

    // Heuristic negative signals
    if (
      /\b(don'?t like|not a fan|too expensive|too cheap|not my|not for me|something else|different)\b/.test(
        userText,
      )
    ) {
      const firstTitle = ps.searches[0]?.products?.[0]?.title;
      if (firstTitle) negativeSignals.push(firstTitle);
    }
  }

  const parts: string[] = [];
  if (shown.length) {
    parts.push(
      `Recently shown (do not repeat these exact items; for "more like this" pass the product_id to similar_to_product_ids):\n${shown
        .map((s) => `- "${s.title}" (product_id: ${s.id})`)
        .join("\n")}`,
    );
  }
  if (positiveSignals.length) {
    parts.push(
      `Positive reactions (great seeds for similar_to_product_ids when the buyer wants more like them):\n${positiveSignals
        .map((s) => `+ "${s.title}" (product_id: ${s.id})`)
        .join("\n")}`,
    );
  }
  if (negativeSignals.length) {
    parts.push(
      `Negative reactions (avoid similar style/brand in next search):\n${negativeSignals.map((t) => `- ${t}`).join("\n")}`,
    );
  }

  if (!parts.length) return "";
  return `<session_signals>\n${parts.join("\n\n")}\n</session_signals>`;
}

function rowToTurn(row: MessageRecord): AnthropicTurn | null {
  if (row.role !== "user" && row.role !== "assistant") return null;
  const text = row.content ?? "";
  if (!text.trim() && row.status !== "completed") return null;
  return { role: row.role, content: text };
}

/**
 * Builds Anthropic message params from persisted conversation history.
 *
 * Callers in the hot path should pass `conversation` to avoid an extra DB round-trip.
 * The shopping-memory query runs in parallel with the message fetch. Older turns
 * are folded into the context summary by {@link kickConversationSummaryRefresh}
 * once a conversation exceeds {@link RECENT_MESSAGES_LIMIT} + buffer.
 */
export async function buildAnthropicContext(
  conversationId: string,
  options?: {
    excludeMessageIds?: string[];
    memoryQueryHint?: string;
    conversation?: ConversationRecord;
    /**
     * Resolved shopping mode for THIS turn. When set, we inject the mode-
     * specific behavior block + (if matched) the context-expertise brief.
     * Leave undefined for non-shopping or legacy calls.
     */
    shoppingMode?: ShoppingMode;
    /**
     * Pre-detected context tag override. The detector also runs on the query
     * hint, but callers (like the chat-stream entry point) may already have
     * the result and prefer to pass it through.
     */
    contextTag?: string | null;
    /** Home category marquee picks for this turn. */
    homeCategoryNames?: string[];
  },
): Promise<BuiltContext> {
  const exclude = new Set(options?.excludeMessageIds ?? []);
  const categoryHint = homeCategoryMemoryHint(options?.homeCategoryNames ?? []);
  const hint = [options?.memoryQueryHint ?? "", categoryHint]
    .filter(Boolean)
    .join("\n")
    .trim();

  const conversationPromise: Promise<ConversationRecord> = options?.conversation
    ? Promise.resolve(options.conversation)
    : prisma.conversation
        .findUnique({ where: { id: conversationId } })
        .then((c: ConversationRecord | null) => {
          if (!c) throw new Error("Conversation not found");
          return c;
        });

  const messagesPromise = prisma.message.findMany({
    where: {
      conversationId,
      id: exclude.size ? { notIn: [...exclude] } : undefined,
      role: { in: ["user", "assistant"] },
      OR: [
        { status: "completed" },
        {
          status: "stopped",
          NOT: { content: "" },
        },
      ],
      NOT: {
        status: "failed",
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: RECENT_MESSAGES_LIMIT,
  });

  // Resolve the conversation first so we have `userId` for the memory query, then
  // run message fetch, long-chat summary fetch, shopping memory, search hints,
  // and session signals all in parallel.
  const conversation = await conversationPromise;
  const [rows, conversationSummary, shoppingXml, searchHints, sessionSignals] =
    await Promise.all([
      messagesPromise,
      getConversationContextSummary(conversationId),
      buildShoppingMemoryPromptXml(conversation.userId, hint),
      buildSearchQueryHints(conversation.userId, hint).catch(() => ({
        xml: "",
        activeIntents: [] as Array<{
          intentName: string;
          category: string | null;
          constraints: unknown;
          priority: "low" | "medium" | "high";
        }>,
      })),
      buildSessionSignals(conversationId).catch(() => ""),
    ]);

  const chronological = [...rows].reverse();

  const anthropicMessages: AnthropicTurn[] = [];
  for (const row of chronological) {
    const turn = rowToTurn(row);
    if (!turn) continue;
    if (!turn.content.trim()) continue;
    anthropicMessages.push(turn);
  }

  const basePrompt = buildSystemPrompt(
    conversation.systemPrompt,
    conversation.responseStyle,
  );

  const shopifySearch = shopifySearchSystemAddendum();
  const clarification = productSearchClarificationSystemAddendum();
  const giftDirections = proposeGiftDirectionsSystemAddendum();

  const modeAddendum = options?.shoppingMode
    ? shoppingModeSystemAddendum(options.shoppingMode)
    : "";

  // Prefer a stable tag from the caller (already-resolved upstream) and fall
  // back to text-detection on the query hint so directional / hybrid turns
  // still benefit when the caller didn't pre-resolve.
  const expertiseCtx =
    getContextExpertiseByTag(options?.contextTag) ??
    detectContextExpertise(hint);
  const expertiseBlock = contextExpertiseSystemBlock(expertiseCtx);

  const topicGuard = topicGuardSystemAddendum();
  const homeCategories = homeCategorySearchAddendum(
    options?.homeCategoryNames ?? [],
  );

  // Skip the token-heavy shopping blocks on pure non-shopping turns (greetings,
  // chit-chat) for a faster first token. The search tool docs stay so the model
  // can still pivot to shopping if the user does.
  const needsShopping = turnNeedsShoppingContext(hint, rows, sessionSignals);

  const systemPrompt = [
    basePrompt,
    topicGuard,
    shopifySearch,
    // W1: Search query profile — imperative "you MUST embed these" block placed
    // immediately after the tool description so the model reads it before deciding
    // what query to write.
    needsShopping ? searchHints.xml : "",
    clarification,
    needsShopping ? giftDirections : "",
    modeAddendum,
    needsShopping ? expertiseBlock : "",
    homeCategories,
    // W6: In-session taste signals — recently shown products + user reactions.
    sessionSignals,
    conversationSummary
      ? `<conversation_summary>\nOlder turns, compressed for continuity:\n${conversationSummary}\n</conversation_summary>`
      : "",
    needsShopping ? shoppingXml : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { systemPrompt, anthropicMessages, shoppingMemoryXml: shoppingXml };
}
