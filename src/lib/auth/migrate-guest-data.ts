import { prisma } from "@/lib/ai-chat/db";
import { Prisma } from "@prisma/client";
import type { GuestLocalData } from "@/lib/client/guest-storage";
import { guestUserIdFromSessionId } from "@/lib/auth/guest-session";
import { fashionOwnerUserId } from "@/lib/fashion-memory/auth";
import { fashionMemoryDb } from "@/lib/fashion-memory/db";
import { migrateGuestFashionMemoryToUser } from "@/lib/fashion-memory/migrate-guest";
import { ensureSelfPerson } from "@/lib/fashion-memory/people";
import type { PersonRow } from "@/lib/fashion-memory/types";
import type { InputJsonValue, InteractiveTransactionClient } from "@/lib/ai-chat/prisma-types";
import { personHasStoredAvatar } from "@/lib/tryon/avatar/service";
import type { StoredAvatar } from "@/lib/tryon/types";

function claimRowFields<T extends { userId: string; createdAt: Date; updatedAt: Date }>(
  row: T,
): Omit<T, "userId" | "createdAt" | "updatedAt"> {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => key !== "userId" && key !== "createdAt" && key !== "updatedAt",
    ),
  ) as Omit<T, "userId" | "createdAt" | "updatedAt">;
}

async function claimUserProfile(
  tx: InteractiveTransactionClient,
  guestUserId: string,
  realUserId: string,
) {
  const guest = await tx.userProfile.findUnique({
    where: { userId: guestUserId },
  });
  if (!guest) return;
  const real = await tx.userProfile.findUnique({
    where: { userId: realUserId },
  });
  if (!real) {
    await tx.userProfile.update({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    });
    return;
  }

  const guestFields = claimRowFields(guest);
  await tx.userProfile.update({
    where: { userId: realUserId },
    data: {
      ...guestFields,
      ageAttestedAt: real.ageAttestedAt ?? guest.ageAttestedAt,
      termsAcceptedAt: real.termsAcceptedAt ?? guest.termsAcceptedAt,
      termsVersion: real.termsVersion ?? guest.termsVersion,
      birthDate: real.birthDate ?? guest.birthDate,
      onboardingStarted: guest.onboardingStarted || real.onboardingStarted,
      onboardingCompleted: guest.onboardingCompleted || real.onboardingCompleted,
    } as Prisma.UserProfileUpdateInput,
  });
  await tx.userProfile.delete({ where: { userId: guestUserId } });
}

async function claimSizingProfile(
  tx: InteractiveTransactionClient,
  guestUserId: string,
  realUserId: string,
) {
  const guest = await tx.sizingProfile.findUnique({
    where: { userId: guestUserId },
  });
  if (!guest) return;
  const real = await tx.sizingProfile.findUnique({
    where: { userId: realUserId },
  });
  if (!real) {
    await tx.sizingProfile.update({
      where: { userId: guestUserId },
      data: { userId: realUserId },
    });
    return;
  }

  const guestFields = claimRowFields(guest);
  await tx.sizingProfile.update({
    where: { userId: realUserId },
    data: guestFields as Prisma.SizingProfileUpdateInput,
  });
  await tx.sizingProfile.delete({ where: { userId: guestUserId } });
}

async function reassignGuestUserId(guestUserId: string, realUserId: string) {
  await prisma.$transaction(async (tx) => {
    await claimUserProfile(tx, guestUserId, realUserId);
    await claimSizingProfile(tx, guestUserId, realUserId);
    await Promise.all([
      tx.conversation.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.productInteraction.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.productCuration.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.cartSession.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.savedAddress.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.categoryPreference.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.brandPreference.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.recipient.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.shoppingIntent.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.tasteTag.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.hardNegative.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.ownedProduct.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.productEvent.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.biometricConsent.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
      tx.photoAnalysis.updateMany({
        where: { userId: guestUserId },
        data: { userId: realUserId },
      }),
    ]);
  });
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
export async function claimGuestAvatar(guestUserId: string, realUserId: string) {
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
    avatar?: StoredAvatar | null;
    avatar_source_photo_path?: string | null;
  };
  const draft = await db
    .from("avatar_drafts")
    .select("*")
    .eq("person_id", guestRow.id)
    .maybeSingle();
  const fromDraft = twinFromDraftPreview(draft.data);
  const guestTwin = personHasStoredAvatar(g.avatar) ? g.avatar : fromDraft;
  const realHasTwin = personHasStoredAvatar(
    (realSelf as PersonRow & { avatar?: StoredAvatar | null }).avatar,
  );

  if (guestTwin && !realHasTwin) {
    await db
      .from("people")
      .update({
        avatar: guestTwin,
        avatar_source_photo_path: g.avatar_source_photo_path ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", realSelf.id);
  }

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

function twinFromDraftPreview(draft: unknown): StoredAvatar | null {
  if (!draft || typeof draft !== "object") return null;
  const row = draft as {
    preview_path?: unknown;
    preview_url?: unknown;
    attributes?: unknown;
  };
  const path =
    typeof row.preview_path === "string" ? row.preview_path.trim() : "";
  if (!path) return null;
  return {
    url: typeof row.preview_url === "string" ? row.preview_url : "",
    storage_path: path,
    attributes:
      row.attributes && typeof row.attributes === "object"
        ? (row.attributes as StoredAvatar["attributes"])
        : {},
    created_at: new Date().toISOString(),
    version: `av_${Date.now()}`,
  };
}

export async function migrateGuestDataToUser(params: {
  guestId: string;
  realUserId: string;
  localData?: GuestLocalData;
  /** Login: attach the guest twin without importing chats onto the account. */
  avatarOnly?: boolean;
}) {
  const guestUserId = guestUserIdFromSessionId(params.guestId);
  if (params.avatarOnly) {
    await claimGuestAvatar(guestUserId, params.realUserId);
    return { guestUserId };
  }
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
