import { fashionMemoryDb } from "@/lib/fashion-memory/db";
import { purgePersonMeasurementFacts } from "@/lib/fashion-memory/facts";
import { getPersonById } from "@/lib/fashion-memory/people";
import {
  deleteGenerationsForPerson,
  listGenerationsForPerson,
} from "./generations";
import {
  deletePrivateObjects,
  listPersonStoragePaths,
} from "./storage";
import type { StoredAvatar } from "./types";

/** Hard delete: source photo, avatar, all generations (storage + rows). */
export async function purgePersonTryonData(params: {
  userId: string;
  personId: string;
}): Promise<void> {
  const person = await getPersonById(params.userId, params.personId);
  if (!person) throw new Error("Person not found");

  const paths = await listPersonStoragePaths(params.userId, params.personId);
  const p = person as typeof person & {
    avatar?: StoredAvatar;
    avatar_source_photo_path?: string;
  };
  if (p.avatar?.storage_path && !paths.includes(p.avatar.storage_path)) {
    paths.push(p.avatar.storage_path);
  }
  if (
    p.avatar_source_photo_path &&
    !paths.includes(p.avatar_source_photo_path)
  ) {
    paths.push(p.avatar_source_photo_path);
  }

  const gens = await listGenerationsForPerson(params.personId);
  for (const g of gens) {
    if (g.outputPath && !paths.includes(g.outputPath)) paths.push(g.outputPath);
  }

  await deletePrivateObjects(paths);
  await deleteGenerationsForPerson(params.personId);

  // Body measurements are privacy-sensitive — purge with person hard-delete.
  await purgePersonMeasurementFacts({
    userId: params.userId,
    personId: params.personId,
  });

  const db = fashionMemoryDb();
  await db
    .from("people")
    .update({
      avatar: null,
      avatar_source_photo_path: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", params.userId)
    .eq("id", params.personId);
  await db.from("avatar_drafts").delete().eq("person_id", params.personId);
}
