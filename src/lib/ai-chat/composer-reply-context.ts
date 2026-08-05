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
