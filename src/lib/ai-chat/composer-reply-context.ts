import type { CuratedPick, ProductCard } from "./types";

/** Product pick the user is replying about in the next composer message. */
export type ComposerReplyContext = {
  productId: string;
  title: string;
  reason?: string;
  slot?: string;
  verdict?: string;
  imageUrl?: string;
  priceLabel?: string;
  sourceMessageId: string;
};

export function composerReplyFromPick(
  pick: CuratedPick | ProductCard,
  sourceMessageId: string,
  priceLabel?: string | null,
): ComposerReplyContext {
  const curated = pick as CuratedPick;
  return {
    productId: pick.id,
    title: pick.title,
    reason: "reason" in curated ? curated.reason : undefined,
    slot: "slot" in curated ? curated.slot : undefined,
    verdict: "verdict" in curated ? curated.verdict : undefined,
    imageUrl: pick.imageUrl,
    priceLabel: priceLabel ?? undefined,
    sourceMessageId,
  };
}

/** Short label shown in the composer chip (ChatGPT-style quote preview). */
export function composerReplyPreviewLabel(ctx: ComposerReplyContext): string {
  const title = ctx.title.trim();
  if (ctx.reason?.trim()) {
    const reason = ctx.reason.trim();
    const snippet =
      reason.length > 72 ? `${reason.slice(0, 69).trimEnd()}…` : reason;
    return title ? `${title} — ${snippet}` : snippet;
  }
  return title || "Selected pick";
}

/** Wrap the user's typed text with reply context for the model (transcript shows the chip separately). */
export function formatUserTurnWithReplyContext(
  userText: string,
  reply: ComposerReplyContext | null | undefined,
): string {
  const text = userText.trim();
  if (!reply) return text;

  const lines = [
    "<reply_context>",
    "The user is composing their next message in reference to this specific product pick from the conversation.",
    `Product: ${reply.title}`,
    `Product id: ${reply.productId}`,
  ];
  if (reply.slot) lines.push(`Pick slot: ${reply.slot}`);
  if (reply.verdict) lines.push(`Shoop verdict: ${reply.verdict}`);
  if (reply.priceLabel) lines.push(`Price shown: ${reply.priceLabel}`);
  if (reply.reason?.trim()) {
    lines.push(`Why we showed it: ${reply.reason.trim()}`);
  }
  lines.push(
    "Interpret their message as being about this item unless they clearly change topic. Do not repeat the full pick card unless they ask.",
    "</reply_context>",
    "",
    text,
  );
  return lines.join("\n");
}
