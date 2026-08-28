/**
 * Moodboard card context — Studying Scan + Ask votes + buyable product ids.
 */
import { prisma } from "@/lib/ai-chat/db";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import {
  ASK_VOTE_LABELS,
  isAskRateChoice,
  isAskVoteChoice,
  type AskVoteChoice,
} from "@/lib/ask/types";
import { mapVerdictToShoopVote } from "@/lib/ask/map-shoop-vote";
import { ownerVoterKey } from "@/lib/ask/owner-vote";
import type { LookScanVerdict } from "@/lib/tryon/look-scan-types";
import type { MoodboardItem } from "@/lib/tryon/generations";

export type MoodboardBuyable = {
  productId: string;
  title?: string;
  imageUrl?: string;
  variantId?: string;
  price?: { amount: number; currency: string };
};

export type MoodboardScanContext = {
  verdictTitle: string | null;
  verdictBody: string | null;
  shoopVote: AskVoteChoice | null;
  shoopVoteLabel: string | null;
  ownerVote: AskVoteChoice | null;
  ownerVoteLabel: string | null;
  friendVoteCount: number;
  askPath: string | null;
  checks: LookScanVerdict["checks"] | null;
};

export type MoodboardItemEnriched = MoodboardItem & {
  scan: MoodboardScanContext | null;
  buyables: MoodboardBuyable[];
  canBuy: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asLookScanVerdict(value: unknown): LookScanVerdict | null {
  const obj = asRecord(value);
  if (!obj) return null;
  const title =
    typeof obj.verdict_title === "string" ? obj.verdict_title.trim() : "";
  const body =
    typeof obj.verdict_body === "string" ? obj.verdict_body.trim() : "";
  if (!title || !body) return null;
  const checks = asRecord(obj.checks);
  const fit = checks?.fit;
  const palette = checks?.palette;
  const nolist = checks?.nolist;
  if (
    fit !== "pass" &&
    fit !== "caution" &&
    fit !== "fail"
  ) {
    return null;
  }
  if (
    palette !== "pass" &&
    palette !== "caution" &&
    palette !== "fail"
  ) {
    return null;
  }
  if (
    nolist !== "pass" &&
    nolist !== "caution" &&
    nolist !== "fail"
  ) {
    return null;
  }
  const vote =
    typeof obj.vote === "string" && isAskRateChoice(obj.vote)
      ? obj.vote
      : undefined;
  return {
    verdict_title: title,
    verdict_body: body,
    annotations: Array.isArray(obj.annotations)
      ? (obj.annotations as LookScanVerdict["annotations"])
      : (["", "", "", ""] as LookScanVerdict["annotations"]),
    whispers: Array.isArray(obj.whispers)
      ? (obj.whispers as LookScanVerdict["whispers"])
      : (["", "", "", ""] as LookScanVerdict["whispers"]),
    checks: {
      fit,
      palette,
      nolist,
    },
    ...(vote ? { vote } : {}),
  };
}

/** Parse catalog:productId or catalog:productId:variantId refs. */
export function parseCatalogRef(ref: string): {
  productId: string;
  variantId?: string;
} | null {
  const raw = ref.trim();
  if (!raw.toLowerCase().startsWith("catalog:")) return null;
  const rest = raw.slice("catalog:".length);
  // Shopify GIDs contain colons — split only the last segment as variant if present.
  const gidMatch = rest.match(/^(gid:\/\/shopify\/Product\/\d+)(?::(.+))?$/i);
  if (gidMatch) {
    return {
      productId: gidMatch[1]!,
      ...(gidMatch[2] ? { variantId: gidMatch[2] } : {}),
    };
  }
  const colon = rest.lastIndexOf(":");
  if (colon > 0) {
    return {
      productId: rest.slice(0, colon),
      variantId: rest.slice(colon + 1) || undefined,
    };
  }
  return rest ? { productId: rest } : null;
}

export function buyablesFromInputRefs(
  inputRefs: Record<string, unknown> | null | undefined,
): MoodboardBuyable[] {
  if (!inputRefs) return [];
  const out: MoodboardBuyable[] = [];
  const seen = new Set<string>();

  const push = (b: MoodboardBuyable) => {
    const id = b.productId.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ ...b, productId: id });
  };

  const listed = inputRefs.buyables;
  if (Array.isArray(listed)) {
    for (const row of listed) {
      const obj = asRecord(row);
      if (!obj || typeof obj.productId !== "string") continue;
      const price = asRecord(obj.price);
      push({
        productId: obj.productId,
        title: typeof obj.title === "string" ? obj.title : undefined,
        imageUrl: typeof obj.imageUrl === "string" ? obj.imageUrl : undefined,
        variantId:
          typeof obj.variantId === "string" ? obj.variantId : undefined,
        price:
          price &&
          typeof price.amount === "number" &&
          typeof price.currency === "string"
            ? { amount: price.amount, currency: price.currency }
            : undefined,
      });
    }
  }

  if (typeof inputRefs.product_id === "string") {
    push({
      productId: inputRefs.product_id,
      title: typeof inputRefs.title === "string" ? inputRefs.title : undefined,
      imageUrl:
        typeof inputRefs.garment_image === "string"
          ? inputRefs.garment_image
          : undefined,
    });
  }

  const refs = inputRefs.refs;
  if (Array.isArray(refs)) {
    for (const ref of refs) {
      if (typeof ref !== "string") continue;
      const parsed = parseCatalogRef(ref);
      if (parsed) push(parsed);
    }
  }

  return out;
}

export function buildOutfitBuyables(
  items: Array<{
    productId?: string;
    title?: string;
    imageUrl?: string;
    displayPrice?: { amount: number; currency: string };
    ref?: string;
  }>,
): MoodboardBuyable[] {
  const out: MoodboardBuyable[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    let productId = item.productId?.trim();
    let variantId: string | undefined;
    if (!productId && item.ref) {
      const parsed = parseCatalogRef(item.ref);
      productId = parsed?.productId;
      variantId = parsed?.variantId;
    }
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    out.push({
      productId,
      title: item.title,
      imageUrl: item.imageUrl,
      variantId,
      price: item.displayPrice,
    });
  }
  return out;
}

/** Read a previously saved Studying Scan for this generation. */
export async function loadLookScanForGeneration(params: {
  userId: string;
  generationId: string;
}): Promise<LookScanVerdict | null> {
  const generationId = params.generationId.trim();
  if (!generationId) return null;

  const row = await prisma.tryonGeneration.findFirst({
    where: { id: generationId, userId: params.userId },
    select: { inputRefs: true },
  });
  if (!row) return null;
  return asLookScanVerdict(asRecord(row.inputRefs)?.shoop_verdict);
}

/** Persist Studying Scan onto the try-on generation so moodboard can show it later. */
export async function attachLookScanToGeneration(params: {
  userId: string;
  generationId: string;
  verdict: LookScanVerdict;
}): Promise<boolean> {
  const generationId = params.generationId.trim();
  if (!generationId) return false;

  const row = await prisma.tryonGeneration.findFirst({
    where: { id: generationId, userId: params.userId },
    select: { id: true, inputRefs: true },
  });
  if (!row) return false;

  const prev = asRecord(row.inputRefs) ?? {};
  const shoopVote = mapVerdictToShoopVote(params.verdict);
  await prisma.tryonGeneration.update({
    where: { id: row.id },
    data: {
      inputRefs: {
        ...prev,
        shoop_verdict: params.verdict,
        shoop_vote: shoopVote,
        look_scan_at: new Date().toISOString(),
      } as InputJsonValue,
    },
  });
  return true;
}

export async function enrichMoodboardItems(
  userId: string,
  items: MoodboardItem[],
): Promise<MoodboardItemEnriched[]> {
  if (!items.length) return [];

  const generationIds = items.map((i) => i.generationId);
  const shares = await prisma.lookAskShare.findMany({
    where: {
      ownerUserId: userId,
      generationId: { in: generationIds },
    },
    orderBy: { createdAt: "desc" },
    include: {
      votes: { select: { choice: true, voterKey: true } },
    },
  });

  const shareByGen = new Map<string, (typeof shares)[number]>();
  for (const share of shares) {
    const gid = share.generationId?.trim();
    if (!gid || shareByGen.has(gid)) continue;
    shareByGen.set(gid, share);
  }

  const gens = await prisma.tryonGeneration.findMany({
    where: { id: { in: generationIds }, userId },
    select: { id: true, inputRefs: true, productRef: true },
  });
  const refsById = new Map(
    gens.map((g) => [
      g.id,
      {
        inputRefs: asRecord(g.inputRefs),
        productRef: g.productRef,
      },
    ]),
  );

  const ownerKey = ownerVoterKey(userId);

  return items.map((item) => {
    const stored = refsById.get(item.generationId);
    const inputRefs = stored?.inputRefs ?? null;
    const buyables = buyablesFromInputRefs(inputRefs);

    // productRef alone may be a pipe of catalog refs
    if (stored?.productRef?.includes("catalog:")) {
      for (const part of stored.productRef.split("|")) {
        const parsed = parseCatalogRef(part);
        if (
          parsed &&
          !buyables.some((b) => b.productId === parsed.productId)
        ) {
          buyables.push(parsed);
        }
      }
    }

    const share = shareByGen.get(item.generationId);
    const genVerdict = asLookScanVerdict(inputRefs?.shoop_verdict);
    const shareVerdict = asLookScanVerdict(share?.shoopVerdict);
    const verdict = shareVerdict ?? genVerdict;

    const shoopVoteRaw =
      (typeof share?.shoopVote === "string" && isAskVoteChoice(share.shoopVote)
        ? share.shoopVote
        : null) ??
      (typeof inputRefs?.shoop_vote === "string" &&
      isAskVoteChoice(inputRefs.shoop_vote)
        ? inputRefs.shoop_vote
        : null) ??
      (verdict ? mapVerdictToShoopVote(verdict) : null);

    const ownerVoteRow = share?.votes.find((v) => v.voterKey === ownerKey);
    const ownerVote =
      ownerVoteRow && isAskVoteChoice(ownerVoteRow.choice)
        ? ownerVoteRow.choice
        : null;

    const friendVoteCount =
      share?.votes.filter(
        (v) => v.voterKey !== ownerKey && isAskVoteChoice(v.choice),
      ).length ?? 0;

    const scan: MoodboardScanContext | null =
      verdict || shoopVoteRaw || share
        ? {
            verdictTitle: verdict?.verdict_title ?? null,
            verdictBody: verdict?.verdict_body ?? null,
            shoopVote: shoopVoteRaw,
            shoopVoteLabel: shoopVoteRaw
              ? ASK_VOTE_LABELS[shoopVoteRaw]
              : null,
            ownerVote,
            ownerVoteLabel: ownerVote ? ASK_VOTE_LABELS[ownerVote] : null,
            friendVoteCount,
            askPath: share ? `/ask/${share.token}` : null,
            checks: verdict?.checks ?? null,
          }
        : null;

    return {
      ...item,
      scan,
      buyables,
      canBuy: buyables.length > 0,
    };
  });
}
