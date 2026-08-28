import { prisma } from "@/lib/ai-chat/db";
import type { GuestLocalData } from "@/lib/client/guest-storage";
import { guestUserIdFromSessionId } from "@/lib/auth/guest-session";
import { fashionOwnerUserId } from "@/lib/fashion-memory/auth";
import { fashionMemoryDb } from "@/lib/fashion-memory/db";
import { migrateGuestFashionMemoryToUser } from "@/lib/fashion-memory/migrate-guest";
import { ensureSelfPerson } from "@/lib/fashion-memory/people";
import type { PersonRow } from "@/lib/fashion-memory/types";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";

async function reassignGuestUserId(guestUserId: string, realUserId: string) {
  await prisma.$transaction([
    prisma.conversation.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.productInteraction.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.productCuration.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.cartSession.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.savedAddress.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.categoryPreference.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.brandPreference.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.recipient.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.shoppingIntent.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.tasteTag.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.hardNegative.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.ownedProduct.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.sizingProfile.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.userProfile.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.productEvent.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.biometricConsent.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
    prisma.photoAnalysis.updateMany({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    }),
  ]);
}

/** Import local guest conversations/messages that never reached the DB. */
async function importLocalGuestData(realUserId: string, data: GuestLocalData) {
  for (const summary of data.conversations) {
    const existing = await prisma.conversation.findFirst({
      where: { id: summary.id, userId: realUserId },
    });
    if (existing) continue;

    await prisma.conversation.create({
      data: {
        id: summary.id,
        userId: realUserId,
        title: summary.title,
        archived: summary.archived,
        deletedAt: summary.deletedAt ? new Date(summary.deletedAt) : null,
        pinned: summary.pinned,
        model: summary.model,
        temperature: summary.temperature,
        maxTokens: summary.maxTokens,
        responseStyle: summary.responseStyle,
        systemPrompt: summary.systemPrompt ?? null,
        createdAt: new Date(summary.createdAt),
        updatedAt: new Date(summary.updatedAt),
      },
    });

    const { bootstrapConversationBranch } = await import(
      "@/lib/ai-chat/intent-branch/bootstrap"
    );
    await bootstrapConversationBranch({
      conversationId: summary.id,
      title: summary.title,
    });

    const messages = data.messagesByConversationId[summary.id] ?? [];
    if (messages.length === 0) continue;

    await prisma.message.createMany({
      data: messages.map((m) => ({
        id: m.id,
        conversationId: summary.id,
        role: m.role,
        content: m.content,
        status: m.status,
        model: m.model ?? null,
        finishReason: m.finishReason ?? null,
        error: m.error ?? null,
        metadata: (m.metadata ?? null) as InputJsonValue,
        createdAt: new Date(m.createdAt),
        updatedAt: new Date(m.updatedAt),
      })),
      skipDuplicates: true,
    });
  }
}

/** Move guest-session twin rows onto the signed-in user. */
async function claimGuestAvatar(guestUserId: string, realUserId: string) {
  const sessionUuid = fashionOwnerUserId(guestUserId);
  if (!sessionUuid || sessionUuid === realUserId) return;

  const db = fashionMemoryDb();
  const guestSelf = await db
    .from("people")
    .select("*")
    .eq("user_id", sessionUuid)
    .eq("relation", "self")
    .maybeSingle();
  const guestRow = guestSelf.data as PersonRow | null;
  if (!guestRow) return;

  const realSelf = await ensureSelfPerson(realUserId);
  if (guestRow.id === realSelf.id) {
    await db.from("people").update({ user_id: realUserId }).eq("id", guestRow.id);
    await db
      .from("avatar_drafts")
      .update({ user_id: realUserId })
      .eq("user_id", sessionUuid);
    await prisma.tryonGeneration.updateMany({
      where: { userId: sessionUuid },
      data: { userId: realUserId },
    });
    return;
  }

  const g = guestRow as PersonRow & {
    avatar?: unknown;
    avatar_source_photo_path?: string | null;
  };
  if (g.avatar || g.avatar_source_photo_path) {
    await db
      .from("people")
      .update({
        avatar: g.avatar ?? null,
        avatar_source_photo_path: g.avatar_source_photo_path ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", realSelf.id);
  }

  const draft = await db
    .from("avatar_drafts")
    .select("*")
    .eq("person_id", guestRow.id)
    .maybeSingle();
  if (draft.data) {
    await db.from("avatar_drafts").delete().eq("person_id", realSelf.id);
    await db.from("avatar_drafts").upsert({
      ...draft.data,
      person_id: realSelf.id,
      user_id: realUserId,
    });
    await db.from("avatar_drafts").delete().eq("person_id", guestRow.id);
  }

  await db
    .from("fashion_facts")
    .update({ user_id: realUserId, person_id: realSelf.id })
    .eq("user_id", sessionUuid);

  await prisma.tryonGeneration.updateMany({
    where: { userId: sessionUuid },
    data: { userId: realUserId, personId: realSelf.id },
  });

  await db.from("people").delete().eq("id", guestRow.id);
}

export async function migrateGuestDataToUser(params: {
  guestId: string;
  realUserId: string;
  localData?: GuestLocalData;
}) {
  const guestUserId = guestUserIdFromSessionId(params.guestId);
  await reassignGuestUserId(guestUserId, params.realUserId);
  await claimGuestAvatar(guestUserId, params.realUserId);
  if (params.localData) {
    await importLocalGuestData(params.realUserId, params.localData);
    if (params.localData.fashionMemory) {
      await migrateGuestFashionMemoryToUser({
        realUserId: params.realUserId,
        snapshot: params.localData.fashionMemory,
      });
    }
  }
  return { guestUserId };
}
