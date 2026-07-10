import { prisma } from "@/lib/ai-chat/db";
import {
  promotePick,
  rejectPick,
  writePromoteSignals,
  writeRejectSignal,
} from "@/lib/fashion-memory/curation/picks-actions";
import type { MessageFashionCurationMetaV1 } from "@/lib/fashion-memory/curation/types";
import type { MessageMetadata } from "@/lib/ai-chat/types";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";

export type PickActionBody = {
  messageId: string;
  ref: string;
  demotedRef?: string;
};

async function loadCurationState(messageId: string): Promise<{
  metadata: MessageMetadata;
  curation: MessageFashionCurationMetaV1;
} | null> {
  const row = await prisma.message.findUnique({
    where: { id: messageId },
    select: { metadata: true },
  });
  if (!row?.metadata) return null;
  const metadata = row.metadata as MessageMetadata;
  const curation = metadata.fashionCatalogSearch?.curation;
  if (!curation) return null;
  return { metadata, curation };
}

async function persistCuration(
  messageId: string,
  metadata: MessageMetadata,
  curation: MessageFashionCurationMetaV1,
): Promise<void> {
  await prisma.message.update({
    where: { id: messageId },
    data: {
      metadata: {
        ...metadata,
        fashionCatalogSearch: {
          ...metadata.fashionCatalogSearch!,
          curation,
        },
      } as InputJsonValue,
    },
  });
}

export async function handleFashionPickAction(
  action: "promote" | "verify" | "reject",
  body: PickActionBody,
  userId: string,
): Promise<Response> {
  const loaded = await loadCurationState(body.messageId);
  if (!loaded) {
    return Response.json({ error: "Curation not found." }, { status: 404 });
  }

  const { metadata, curation } = loaded;

  if (action === "promote") {
    const next = promotePick({
      state: curation,
      ref: body.ref,
      demotedRef: body.demotedRef,
    });
    const promoted = next.tiers.picks.find((p) => p.ref === body.ref);
    const demoted = body.demotedRef
      ? curation.tiers.picks.find((p) => p.ref === body.demotedRef)
      : undefined;
    if (promoted) {
      await writePromoteSignals({ userId, promoted, demoted });
    }
    const updated: MessageFashionCurationMetaV1 = {
      ...next,
      version: 1,
      trace_id: curation.trace_id,
    };
    await persistCuration(body.messageId, metadata, updated);
    return Response.json({ ok: true, curation: updated });
  }

  if (action === "reject") {
    const { state: next, replacement } = rejectPick({
      state: curation,
      ref: body.ref,
    });
    const rejected = curation.tiers.picks.find((p) => p.ref === body.ref);
    if (rejected) {
      await writeRejectSignal({ userId, product: rejected });
    }
    const updated: MessageFashionCurationMetaV1 = {
      ...next,
      version: 1,
      trace_id: curation.trace_id,
    };
    await persistCuration(body.messageId, metadata, updated);
    return Response.json({ ok: true, curation: updated, replacement });
  }

  const item = curation.tiers.unverified.find(
    (u) => u.product_id === body.ref,
  );
  if (!item) {
    return Response.json({ error: "Unverified item not found." }, { status: 404 });
  }
  const verifiedItem = {
    id: item.product_id,
    title: item.title,
    imageUrl: item.image_url,
    displayPrice: item.price
      ? { amount: item.price.amount, currency: item.price.currency }
      : undefined,
    ref: body.ref,
    slot_id: item.slot_id,
    garment: item.garment,
    score_rank: item.score_rank,
  };
  const updated: MessageFashionCurationMetaV1 = {
    ...curation,
    tiers: {
      ...curation.tiers,
      verified: [...curation.tiers.verified, verifiedItem],
      unverified: curation.tiers.unverified.filter(
        (u) => u.product_id !== item.product_id,
      ),
    },
  };
  await persistCuration(body.messageId, metadata, updated);
  return Response.json({ ok: true, curation: updated, verified: verifiedItem });
}
