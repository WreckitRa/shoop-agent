import { prisma } from "@/lib/ai-chat/db";
import { fashionMemoryDb } from "@/lib/fashion-memory/db";
import { isSupabaseAuthUserId } from "@/lib/fashion-memory/auth";
import { deletePrivateObjects } from "@/lib/tryon/storage";
import {
  BIOMETRIC_INACTIVITY_MS,
  PHOTO_MAX_RETENTION_MS,
} from "./constants";
import { recordPrivacyDeletion } from "./deletion-log";
import { hasBiometricResidue, purgeBiometricData } from "./purge";

export async function destroySourcePhotosPastRetention(): Promise<number> {
  const cutoff = new Date(Date.now() - PHOTO_MAX_RETENTION_MS);
  const db = fashionMemoryDb();
  const { data: drafts } = await db
    .from("avatar_drafts")
    .select("person_id, user_id, photo_path, updated_at")
    .not("photo_path", "is", null);
  const { data: people } = await db
    .from("people")
    .select("id, user_id, avatar_source_photo_path, avatar")
    .not("avatar_source_photo_path", "is", null);

  const paths: string[] = [];
  const draftIds: string[] = [];
  const peopleIds: Array<{ userId: string; personId: string }> = [];

  for (const row of drafts ?? []) {
    const updated = row.updated_at ? new Date(String(row.updated_at)) : null;
    if (updated && updated > cutoff) continue;
    if (typeof row.photo_path === "string" && row.photo_path) {
      paths.push(row.photo_path);
      draftIds.push(String(row.person_id));
    }
  }

  for (const row of people ?? []) {
    const path = row.avatar_source_photo_path;
    if (typeof path === "string" && path) {
      paths.push(path);
      peopleIds.push({
        userId: String(row.user_id),
        personId: String(row.id),
      });
    }
  }

  if (paths.length) await deletePrivateObjects([...new Set(paths)]);

  if (draftIds.length) {
    await db
      .from("avatar_drafts")
      .update({ photo_path: null, updated_at: new Date().toISOString() })
      .in("person_id", draftIds);
  }
  for (const person of peopleIds) {
    await db
      .from("people")
      .update({
        avatar_source_photo_path: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", person.userId)
      .eq("id", person.personId);
  }

  const byUser = new Map<string, number>();
  for (const person of peopleIds) {
    byUser.set(person.userId, (byUser.get(person.userId) ?? 0) + 1);
  }
  for (const row of drafts ?? []) {
    const userId = String(row.user_id ?? "");
    if (!userId) continue;
    const updated = row.updated_at ? new Date(String(row.updated_at)) : null;
    if (updated && updated > cutoff) continue;
    if (typeof row.photo_path === "string" && row.photo_path) {
      byUser.set(userId, (byUser.get(userId) ?? 0) + 1);
    }
  }
  for (const [userId, photos] of byUser) {
    await recordPrivacyDeletion({
      userId,
      kind: "source_photo_retention",
      details: { photos },
    });
  }

  return paths.length;
}

async function lastActivityAt(userId: string): Promise<Date | null> {
  const [profile, chat, gen] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: { updatedAt: true },
    }),
    prisma.conversation.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.tryonGeneration.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);
  const times = [profile?.updatedAt, chat?.updatedAt, gen?.updatedAt].filter(
    (d): d is Date => d instanceof Date,
  );
  if (!times.length) return null;
  return new Date(Math.max(...times.map((d) => d.getTime())));
}

export async function destroyInactiveBiometricData(): Promise<number> {
  const cutoff = new Date(Date.now() - BIOMETRIC_INACTIVITY_MS);
  const profiles = await prisma.userProfile.findMany({
    where: { updatedAt: { lt: cutoff } },
    select: { userId: true },
  });
  let purged = 0;
  for (const profile of profiles) {
    if (!isSupabaseAuthUserId(profile.userId)) continue;
    const last = await lastActivityAt(profile.userId);
    if (last && last >= cutoff) continue;
    if (!(await hasBiometricResidue(profile.userId))) continue;
    await purgeBiometricData(profile.userId);
    await recordPrivacyDeletion({
      userId: profile.userId,
      kind: "inactivity",
      details: { lastActivityAt: last?.toISOString() ?? null },
    });
    purged += 1;
  }
  return purged;
}
