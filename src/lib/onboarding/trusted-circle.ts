/**
 * Persist onboarding Trusted Circle names as fashion-memory people.
 * Relation = friend, notes marked trusted_circle for later Ask targeting.
 */
import {
  createPerson,
  listPeopleForUser,
} from "@/lib/fashion-memory/people";

export const TRUSTED_CIRCLE_NOTE = "trusted_circle";
export const TRUSTED_CIRCLE_MAX = 3;

export function normalizeCircleNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = item.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= TRUSTED_CIRCLE_MAX) break;
  }
  return out;
}

export type SaveTrustedCircleResult = {
  names: string[];
  created: number;
  skipped: number;
};

/**
 * Create friend roster rows for circle names. Idempotent on same-name matches.
 */
export async function saveTrustedCirclePeople(params: {
  userId: string;
  names: string[];
}): Promise<SaveTrustedCircleResult> {
  const names = normalizeCircleNames(params.names);
  if (!names.length) {
    return { names: [], created: 0, skipped: 0 };
  }

  const existing = await listPeopleForUser(params.userId);
  const existingKeys = new Set(
    existing
      .filter((p) => p.relation !== "self" && p.name?.trim())
      .map((p) => p.name!.trim().toLowerCase()),
  );

  let created = 0;
  let skipped = 0;
  for (const name of names) {
    if (existingKeys.has(name.toLowerCase())) {
      skipped += 1;
      continue;
    }
    await createPerson({
      userId: params.userId,
      relation: "friend",
      name,
      notes: TRUSTED_CIRCLE_NOTE,
    });
    existingKeys.add(name.toLowerCase());
    created += 1;
  }

  return { names, created, skipped };
}
