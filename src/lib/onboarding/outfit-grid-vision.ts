/**
 * Batched Haiku vision judge for onboarding outfit-grid photos.
 * One call per deck: up to 3 thumbs × 9 cells.
 */
import sharp from "sharp";
import { createLightweightMessage } from "@/lib/ai-chat/anthropic";
import { AI_CHAT_LIGHTWEIGHT_MODEL } from "@/lib/ai-chat/constants";
import { logAiChat } from "@/lib/ai-chat/observability";
import { stripJsonFence } from "@/lib/ai-chat/shopping-memory/llm-json";
import { catalogDisplayImageUrl } from "@/lib/shopify/catalog-display-image";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import { extractCatalogImageUrl } from "@/lib/shopify/catalog";
import { mapWithConcurrency } from "@/lib/onboarding/taste-catalog";

const JUDGE_THUMB_PX = 256;
const FETCH_MAX_BYTES = 1_500_000;
const JPEG_QUALITY = 78;
const CANDIDATES_PER_SLOT = 3;

export const OUTFIT_GRID_VISION_JUDGE_SYSTEM = `You judge candidate photos for a fashion onboarding grid. For each SLOT you receive a vibe label and up to 3 numbered product photos. Pick the ONE photo per slot that best satisfies, in priority order: 1) STYLED PRESENCE: on-model or styled composition beats flat-lay/packshot; 2) LABEL MATCH: the photo plausibly depicts the vibe label; 3) CLARITY: garment clearly visible, clean background, no heavy graphics/text overlays; 4) DECK VARIETY: reject a photo too visually similar to a winner you already picked (same silhouette + same color family + same crop). Return ONLY JSON: {"picks":[{"slot":n,"winner":k|null,"reason":"<8 words"}]}. winner=null if all candidates fail 1 or 3... the slot will refill.`;

export type VisionJudgeSlotInput = {
  /** 1-indexed slot matching matrix cell. */
  slot: number;
  label: string;
  candidates: CatalogProductSummary[];
};

export type VisionJudgePick = {
  slot: number;
  /** 1-indexed candidate within that slot, or null to refuse. */
  winner: number | null;
  reason: string;
};

type ImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg";
    data: string;
  };
};

type TextBlock = { type: "text"; text: string };

async function fetchJudgeThumb(
  imageUrl: string,
  signal?: AbortSignal,
): Promise<ImageBlock | null> {
  const raw = imageUrl.trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  const fetchUrl = catalogDisplayImageUrl(raw, JUDGE_THUMB_PX, {
    crop: "center",
  });
  try {
    const res = await fetch(fetchUrl, {
      signal,
      headers: { Accept: "image/*" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > FETCH_MAX_BYTES) return null;
    const resized = await sharp(buf)
      .rotate()
      .resize({
        width: JUDGE_THUMB_PX,
        height: JUDGE_THUMB_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: resized.toString("base64"),
      },
    };
  } catch {
    return null;
  }
}

function parseJudgePicks(raw: string): VisionJudgePick[] | null {
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { picks?: unknown }).picks)
        ? (parsed as { picks: unknown[] }).picks
        : null;
    if (!list) return null;
    const picks: VisionJudgePick[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const slot = typeof row.slot === "number" ? row.slot : Number(row.slot);
      if (!Number.isFinite(slot)) continue;
      let winner: number | null = null;
      if (row.winner === null || row.winner === "null") {
        winner = null;
      } else {
        const w =
          typeof row.winner === "number" ? row.winner : Number(row.winner);
        winner = Number.isFinite(w) && w >= 1 ? Math.round(w) : null;
      }
      const reason =
        typeof row.reason === "string" ? row.reason.trim().slice(0, 80) : "";
      picks.push({ slot: Math.round(slot), winner, reason });
    }
    return picks.length ? picks : null;
  } catch {
    return null;
  }
}

/**
 * Prepare thumbnails and run one batched vision call.
 * Returns a map of slot → winning product (or undefined if null/missing).
 */
export async function judgeOutfitGridPhotos(
  slots: VisionJudgeSlotInput[],
  options: { signal?: AbortSignal } = {},
): Promise<{
  winners: Map<number, CatalogProductSummary>;
  picks: VisionJudgePick[];
  killed: number;
  judged: number;
}> {
  const signal = options.signal;
  const winners = new Map<number, CatalogProductSummary>();
  const prepared: Array<{
    slot: number;
    label: string;
    products: CatalogProductSummary[];
    images: ImageBlock[];
  }> = [];

  await mapWithConcurrency(slots, 4, async (slot) => {
    const products = slot.candidates.slice(0, CANDIDATES_PER_SLOT);
    const images: ImageBlock[] = [];
    const kept: CatalogProductSummary[] = [];
    for (const product of products) {
      const url = extractCatalogImageUrl(product);
      if (!url) continue;
      const block = await fetchJudgeThumb(url, signal);
      if (!block) continue;
      images.push(block);
      kept.push(product);
      if (images.length >= CANDIDATES_PER_SLOT) break;
    }
    prepared.push({
      slot: slot.slot,
      label: slot.label,
      products: kept,
      images,
    });
    return slot.slot;
  });

  prepared.sort((a, b) => a.slot - b.slot);

  const content: Array<TextBlock | ImageBlock> = [
    {
      type: "text",
      text: `Judge ${prepared.length} slots. For each slot, photos are numbered 1..N in order.`,
    },
  ];

  let imageCount = 0;
  for (const row of prepared) {
    content.push({
      type: "text",
      text: `SLOT ${row.slot} — vibe: "${row.label}" — ${row.images.length} candidates:`,
    });
    row.images.forEach((img, i) => {
      content.push({ type: "text", text: `Photo ${i + 1}:` });
      content.push(img);
      imageCount += 1;
    });
  }

  if (imageCount === 0) {
    return { winners, picks: [], killed: 0, judged: 0 };
  }

  try {
    const msg = await createLightweightMessage(
      {
        model: AI_CHAT_LIGHTWEIGHT_MODEL,
        max_tokens: 700,
        temperature: 0.2,
        system: OUTFIT_GRID_VISION_JUDGE_SYSTEM,
        messages: [{ role: "user", content }],
      },
      { signal },
    );
    const text = msg.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const picks = parseJudgePicks(text) ?? [];
    let killed = 0;
    let judged = 0;

    for (const pick of picks) {
      const row = prepared.find((p) => p.slot === pick.slot);
      if (!row) continue;
      judged += 1;
      if (
        pick.winner == null ||
        pick.winner < 1 ||
        pick.winner > row.products.length
      ) {
        killed += 1;
        logAiChat("info", "onboarding_outfit_vision_kill", {
          slot: pick.slot,
          reason: pick.reason,
          candidates: row.products.length,
        });
        continue;
      }
      const product = row.products[pick.winner - 1];
      if (!product) {
        killed += 1;
        continue;
      }
      winners.set(pick.slot, product);
      logAiChat("info", "onboarding_outfit_vision_pick", {
        slot: pick.slot,
        winner: pick.winner,
        reason: pick.reason,
        productId: product.id,
      });
    }

    for (const row of prepared) {
      if (!winners.has(row.slot) && row.products.length > 0) {
        if (!picks.some((p) => p.slot === row.slot)) {
          killed += 1;
        }
      }
    }

    return { winners, picks, killed, judged };
  } catch (error) {
    if (signal?.aborted) throw error;
    logAiChat("warn", "onboarding_outfit_vision_failed", {
      error: error instanceof Error ? error.message : String(error),
      slots: prepared.length,
      images: imageCount,
    });
    // Degrade: first prepared product per slot so we still show something.
    for (const row of prepared) {
      if (row.products[0]) winners.set(row.slot, row.products[0]);
    }
    return { winners, picks: [], killed: 0, judged: 0 };
  }
}

export { CANDIDATES_PER_SLOT };
