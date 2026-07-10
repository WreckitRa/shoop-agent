/**
 * Gift Direction Flow (docs/search-improvements.md §5).
 *
 * For a vague gift ("a present for my brother") with no usable direction, the
 * model proposes 4-6 selectable directions via `propose_gift_directions`. The
 * client renders them as multi-select chips; on submit it posts the chosen
 * labels back as a normal user message using the `__gift_directions__:` magic
 * string, which the server expands into a directed multi-intent search.
 */
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages";
import { z } from "zod";
import { inferShoppablePreviewQuery } from "../infer-shoppable-preview-query";
import { SHOPIFY_SEARCH_TOOL_NAME } from "../shopify-search-tool";
import type {
  ClarificationOptionPreviewImage,
  MessageGiftDirectionsV1,
} from "../types";

export const PROPOSE_GIFT_DIRECTIONS_TOOL_NAME = "propose_gift_directions";

/** Magic string the client posts back with the chosen direction labels. */
export const GIFT_DIRECTIONS_MESSAGE_PREFIX = "__gift_directions__:";

const directionSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(80),
  rationale: z.string().min(1).max(160).optional(),
  preview_query: z.string().min(1).max(300).optional(),
});

const toolInputSchema = z.object({
  recipient_label: z.string().min(1).max(80),
  context_summary: z.string().max(280).optional(),
  directions: z.array(directionSchema).min(4).max(6),
  /** How many directions to ask the user to choose (1-3). */
  pick_count: z.number().int().min(1).max(3).optional(),
});

export const proposeGiftDirectionsTool: Tool = {
  name: PROPOSE_GIFT_DIRECTIONS_TOOL_NAME,
  description: `Propose 4-6 gift DIRECTIONS for a vague gift request, so the buyer can pick which to explore. Call this BEFORE searching whenever the buyer has not chosen a direction yet (\`direction_label\` will be empty).

Each direction is a themed lane derived from the recipient's interests/occasion (e.g. "Desk accessories", "Cozy home", "Fitness gear") with a one-line rationale. Include a \`preview_query\` on every direction — a concrete product-noun catalog search phrase (no gift/occasion/recipient words) used for visual preview collages. The UI renders them as visual cards with real product images; the buyer's choices come back as a normal message and you then search each chosen direction separately.

Decision rule:
- Any gift request without a chosen direction → call this (do NOT call search_shopify_catalog in the same turn).
- Zero anchor about the recipient → ask ONE short question first, then call this on the next turn.
- After the buyer picks directions, search each with direction_label set — never skip the chip step.

In the same turn, write a short friendly message inviting them to pick a couple of directions.`,
  input_schema: {
    type: "object",
    properties: {
      recipient_label: {
        type: "string",
        description: 'Who the gift is for, e.g. "your brother".',
      },
      context_summary: {
        type: "string",
        description: 'Short context, e.g. "into tech, works from home, birthday".',
      },
      directions: {
        type: "array",
        minItems: 4,
        maxItems: 6,
        description: "4-6 distinct gift directions derived from the interests.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Stable snake_case id, e.g. desk_accessories.",
            },
            label: { type: "string", description: "Short chip label." },
            rationale: {
              type: "string",
              description: 'One line on why it fits, e.g. "he works from home".',
            },
            preview_query: {
              type: "string",
              description:
                "Concrete product-noun catalog search phrase for visual preview collages (no gift/occasion/recipient words). E.g. Beauty & Skincare → women's beauty skincare serum moisturizer set.",
            },
          },
          required: ["id", "label"],
        },
      },
      pick_count: {
        type: "number",
        description: "How many directions to ask the buyer to choose (1-3, default 2).",
      },
    },
    required: ["recipient_label", "directions"],
  },
};

export function ensureGiftDirectionPreviewQueries(
  giftDirections: MessageGiftDirectionsV1,
): MessageGiftDirectionsV1 {
  const audienceHint = [
    giftDirections.recipientLabel,
    giftDirections.contextSummary,
  ]
    .filter(Boolean)
    .join(" ");

  const directions = giftDirections.directions.map((d) => ({
    ...d,
    previewQuery:
      d.previewQuery?.trim() ||
      inferShoppablePreviewQuery(d.label, audienceHint),
  }));

  return {
    ...giftDirections,
    directions,
    expectsOptionPreviews: giftDirectionsExpectsPreviews({ directions }),
  };
}

export function giftDirectionsExpectsPreviews(
  giftDirections: Pick<MessageGiftDirectionsV1, "directions">,
): boolean {
  return giftDirections.directions.some(
    (d) => Boolean(d.previewQuery?.trim()) && !d.previewImages?.length,
  );
}

export function collectGiftDirectionPreviewRequests(
  giftDirections: MessageGiftDirectionsV1,
): Array<{ id: string; previewQuery: string }> {
  return giftDirections.directions
    .filter((d) => d.previewQuery?.trim() && !d.previewImages?.length)
    .map((d) => ({ id: d.id, previewQuery: d.previewQuery!.trim() }));
}

export function mergeOptionPreviewsIntoGiftDirections(
  giftDirections: MessageGiftDirectionsV1,
  previews: Record<string, ClarificationOptionPreviewImage[]>,
): MessageGiftDirectionsV1 {
  if (!Object.keys(previews).length) return giftDirections;
  const directions = giftDirections.directions.map((d) => {
    const images = previews[d.id];
    if (!images?.length) return d;
    return { ...d, previewImages: images };
  });
  return {
    ...giftDirections,
    directions,
    expectsOptionPreviews: giftDirectionsExpectsPreviews({ directions }),
  };
}

export function parseGiftDirectionsToolInput(
  input: unknown,
): MessageGiftDirectionsV1 | null {
  const parsed = toolInputSchema.safeParse(input);
  if (!parsed.success) return null;
  const pickCount = Math.min(
    parsed.data.pick_count ?? 2,
    parsed.data.directions.length,
  );
  return ensureGiftDirectionPreviewQueries({
    version: 1,
    recipientLabel: parsed.data.recipient_label,
    contextSummary: parsed.data.context_summary,
    directions: parsed.data.directions.map((d) => ({
      id: d.id,
      label: d.label,
      rationale: d.rationale,
      previewQuery: d.preview_query,
    })),
    pickCount: Math.max(1, pickCount),
    status: "pending",
  });
}

export function proposeGiftDirectionsSystemAddendum(): string {
  return `## Gift directions (required before searching)
When the buyer wants a gift and has NOT yet chosen a direction (\`direction_label\` is empty), you MUST NOT call \`${SHOPIFY_SEARCH_TOOL_NAME}\`. Instead call \`${PROPOSE_GIFT_DIRECTIONS_TOOL_NAME}\` in the same turn with 4-6 themed directions (multi-select visual cards in the UI).

Each direction MUST include \`preview_query\`: a concrete product-noun phrase for catalog image previews (e.g. "Beauty & Skincare" for a sister → \`women's beauty skincare serum moisturizer\`). Never put gift/occasion/recipient words in \`preview_query\`.

If you accidentally call search without \`direction_label\` on a gift, the server will block the search and show direction chips automatically — still write a friendly invite to pick directions; do not describe products.

Workflow:
1. Gift + unclear direction → \`${PROPOSE_GIFT_DIRECTIONS_TOOL_NAME}\` (or one short question if you know literally nothing about the recipient, then directions).
2. Buyer picks chips → message begins "${GIFT_DIRECTIONS_MESSAGE_PREFIX}".
3. Search EACH chosen direction separately: \`archetype:"gift_directed"\`, \`direction_label\` = the chip label, \`recipient.kind:"other"\`, \`ranking_profile:"gift_diversity"\`. Never blend directions into one search.
4. When recapping results, write as an expert curator for EACH direction lane (e.g. travel gear specialist for Luxury Travel Accessories, kitchen specialist for Premium Kitchen & Food) — not a generic gift bot. Group picks by direction when multiple lanes were searched.

Memory already holds strong recipient interests? Still propose directions unless the buyer already picked one — interests inform the chip themes, they are not a substitute for the buyer choosing a lane.`;
}

/**
 * Build the magic-string message the client posts when the buyer submits their
 * chosen directions. Labels (human-readable) are used so the model can search
 * them directly.
 */
export function formatGiftDirectionsSelectionMessage(labels: string[]): string {
  return `${GIFT_DIRECTIONS_MESSAGE_PREFIX} ${labels.join(", ")}`;
}

/** Parse the chosen direction labels out of a `__gift_directions__:` message. */
export function parseGiftDirectionsSelection(text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(GIFT_DIRECTIONS_MESSAGE_PREFIX)) return null;
  const rest = trimmed.slice(GIFT_DIRECTIONS_MESSAGE_PREFIX.length);
  const labels = rest
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return labels.length ? labels : null;
}

/**
 * Expand the magic-string selection into a natural user instruction the model
 * will act on (search each chosen direction separately). Used as the persisted
 * + prompt-visible user text so the chat reads cleanly.
 */
export function expandGiftDirectionsUserText(labels: string[]): string {
  if (labels.length === 1) {
    return `Let's explore this gift direction: ${labels[0]}. Search it for the recipient and show options.`;
  }
  return `Let's explore these gift directions: ${labels.join(
    ", ",
  )}. Search each direction separately for the recipient and group the results by direction.`;
}
