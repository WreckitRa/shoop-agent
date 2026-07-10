/**
 * Server-side gift direction proposer — used when the model tries to search a
 * gift without a chosen direction_label. Mirrors propose_gift_directions output.
 */
import { createLightweightMessage } from "../anthropic";
import { AI_CHAT_LIGHTWEIGHT_MODEL } from "../constants";
import { logAiChat } from "../observability";
import type { LightweightPromptAudit } from "../prompt-run/lightweight-audit";
import type { MessageGiftDirectionsV1 } from "../types";
import { ensureGiftDirectionPreviewQueries } from "./gift-directions";
import { withPlannerTimeout } from "./portfolio-planner-shared";
import type { SearchBrief } from "./types";
import { buildGiftShoppingQuestion } from "./query-planner";
import { giftHasRecipientAnchor } from "./gift-direction-gate";

const SYSTEM = `You propose gift DIRECTIONS for a personal shopper app. The buyer will pick 1-2 themed lanes as multi-select chips before any product search runs.

Output ONLY valid JSON (no markdown):
{
  "recipient_label": "your brother",
  "context_summary": "into tech, birthday, open budget",
  "pick_count": 2,
  "directions": [
    {"id":"desk_setup","label":"Desk setup","rationale":"works from home","preview_query":"home office desk accessories organizer lamp"},
    ...
  ]
}

Rules:
- Exactly 4-6 directions; each must be a DISTINCT gift theme (not product SKUs).
- Labels are short chip text (2-4 words). ids are snake_case stable keys.
- Each direction MUST include preview_query: concrete product-noun catalog phrase for image previews — no gift/occasion/recipient words.
- Derive themes from interests, occasion, age, and relationship — not generic "gift ideas".
- Never repeat the same theme with different wording.
- pick_count: 1 if only one strong lane fits, else 2 (max 3).`;

function parseDirectionsJson(text: string): MessageGiftDirectionsV1 | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const recipientLabel =
      typeof raw.recipient_label === "string" ? raw.recipient_label.trim() : "";
    const directionsRaw = raw.directions;
    if (!recipientLabel || !Array.isArray(directionsRaw)) return null;

    const directions: MessageGiftDirectionsV1["directions"] = [];
    for (const item of directionsRaw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      const label = typeof o.label === "string" ? o.label.trim() : "";
      if (!id || !label) continue;
      directions.push({
        id,
        label,
        rationale:
          typeof o.rationale === "string" ? o.rationale.trim() : undefined,
        previewQuery:
          typeof o.preview_query === "string"
            ? o.preview_query.trim()
            : undefined,
      });
    }
    if (directions.length < 4) return null;

    const pickRaw =
      typeof raw.pick_count === "number" ? Math.round(raw.pick_count) : 2;
    const pickCount = Math.min(3, Math.max(1, pickRaw));

    return ensureGiftDirectionPreviewQueries({
      version: 1,
      recipientLabel,
      contextSummary:
        typeof raw.context_summary === "string"
          ? raw.context_summary.trim()
          : undefined,
      directions: directions.slice(0, 6),
      pickCount: Math.min(pickCount, directions.length),
      status: "pending",
    });
  } catch {
    return null;
  }
}

function fallbackDirections(brief: SearchBrief): MessageGiftDirectionsV1 {
  const who = brief.recipient.label?.trim() || "them";
  const recipientLabel = who.startsWith("your") ? who : `your ${who}`;
  return ensureGiftDirectionPreviewQueries({
    version: 1,
    recipientLabel,
    contextSummary: brief.useCase?.trim() || undefined,
    pickCount: 2,
    status: "pending",
    directions: [
      { id: "tech_gadgets", label: "Tech & gadgets", rationale: "popular for many recipients" },
      { id: "style_accessories", label: "Style & accessories", rationale: "easy to personalize" },
      { id: "home_cozy", label: "Cozy home", rationale: "always useful" },
      { id: "fitness_outdoors", label: "Fitness & outdoors", rationale: "active lifestyle" },
      { id: "food_drink", label: "Food & drink", rationale: "shareable treats" },
    ],
  });
}

export async function craftGiftDirectionsFromBrief(
  brief: SearchBrief,
  options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    audit?: LightweightPromptAudit;
  },
): Promise<MessageGiftDirectionsV1> {
  const payload = {
    task: giftHasRecipientAnchor(brief)
      ? "Propose gift direction chips from this brief"
      : "Propose broad starter gift direction chips (buyer gave little detail)",
    shopping_question: buildGiftShoppingQuestion(brief),
    recipient: {
      label: brief.recipient.label ?? null,
      name: brief.recipient.name ?? null,
      age_range: brief.recipient.ageRange ?? null,
      known_interests: brief.recipient.knownInterests ?? [],
    },
    occasion: brief.useCase ?? null,
    must_haves: brief.mustHaves,
    note: "Buyer has NOT picked a direction yet — themes only, not product searches.",
  };

  const call = createLightweightMessage(
    {
      model: AI_CHAT_LIGHTWEIGHT_MODEL,
      max_tokens: 768,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    },
    { signal: options?.signal, audit: options?.audit },
  );

  const msg = await withPlannerTimeout(call, options?.timeoutMs ?? 2800);
  if (!msg) {
    logAiChat("warn", "craft_gift_directions_timeout", {
      recipient: brief.recipient.label,
    });
    return fallbackDirections(brief);
  }

  const text = msg.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = parseDirectionsJson(text);
  if (parsed) return parsed;

  logAiChat("info", "craft_gift_directions_fallback", {
    recipient: brief.recipient.label,
  });
  return fallbackDirections(brief);
}
