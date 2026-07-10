/**
 * Merge stored recipient memory into a SearchBrief before the engine runs.
 * Ensures gift planning has interests, age, brands, etc. even when the chat
 * model omitted them on the tool call.
 */
import { prisma } from "../db";
import { resolveOccasionAmbiguity } from "./brief-occasion";
import {
  applyProvenanceToBrief,
  tagListProvenance,
} from "./brief-provenance";
import type { SearchBrief } from "./types";

function mergeStringLists(
  a: string[] | undefined,
  b: string[] | undefined,
): string[] | undefined {
  const merged = [...new Set([...(a ?? []), ...(b ?? [])].map((s) => s.trim()).filter(Boolean))];
  return merged.length ? merged : a ?? b;
}

/** Load buyer profile signals and resolve occasion ambiguity for self-shopping. */
export async function enrichSearchBriefFromProfile(
  userId: string,
  brief: SearchBrief,
): Promise<SearchBrief> {
  if (brief.recipient.kind === "other") return brief;

  const profile = await prisma.userProfile
    .findUnique({
      where: { userId },
      select: {
        workEnvironment: true,
        lifestyleTags: true,
        occupation: true,
      },
    })
    .catch(() => null);

  if (!profile) return brief;

  let enriched = resolveOccasionAmbiguity(brief, profile);

  for (const tag of profile.lifestyleTags ?? []) {
    const t = tag.trim().toLowerCase();
    if (!t) continue;
    const inNice = enriched.niceToHaves.some((n) => n.toLowerCase().includes(t));
    const inMust = enriched.mustHaves.some((m) => m.toLowerCase().includes(t));
    if (!inNice && !inMust && enriched.niceToHaves.length < 8) {
      enriched = applyProvenanceToBrief(
        { ...enriched, niceToHaves: [...enriched.niceToHaves, tag] },
        { niceToHaves: tagListProvenance([tag], "persona_inferred") },
      );
    }
  }

  return enriched;
}

export async function enrichSearchBriefFromMemory(
  userId: string,
  brief: SearchBrief,
): Promise<SearchBrief> {
  if (brief.recipient.kind !== "other") return brief;

  const label = brief.recipient.label?.trim().toLowerCase();
  if (!label) return brief;

  const row = await prisma.recipient
    .findUnique({
      where: { userId_label: { userId, label } },
      select: {
        name: true,
        ageRange: true,
        knownPreferences: true,
        favoriteBrands: true,
        sizes: true,
      },
    })
    .catch(() => null);

  if (!row) return brief;

  const sizes =
    row.sizes && typeof row.sizes === "object"
      ? (row.sizes as Record<string, string>)
      : undefined;
  const sizeHints = sizes
    ? Object.entries(sizes)
        .filter(([, v]) => typeof v === "string" && v.trim())
        .map(([k, v]) => `${k} ${v}`)
    : [];

  return {
    ...brief,
    recipient: {
      ...brief.recipient,
      name: brief.recipient.name ?? row.name ?? undefined,
      ageRange: brief.recipient.ageRange ?? row.ageRange ?? undefined,
      knownInterests: mergeStringLists(
        brief.recipient.knownInterests,
        [...row.knownPreferences, ...sizeHints],
      ),
      favoriteBrands: mergeStringLists(
        brief.recipient.favoriteBrands,
        row.favoriteBrands,
      ),
    },
  };
}
