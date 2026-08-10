import { prisma } from "@/lib/ai-chat/db";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import { fashionMemoryDb } from "@/lib/fashion-memory/db";
import type { TryonGenerationKind, TryonGenerationStatus } from "@prisma/client";
import {
  TRYON_GLOBAL_DAILY_SPEND_CAP,
  TRYON_USER_DAILY_CAP,
} from "./config";
import { tripGlobalTryonCap } from "./feature-flags";
import { moodboardDisplayTitle } from "./moodboard-title";

export type GenerationRow = {
  id: string;
  personId: string;
  userId: string;
  kind: TryonGenerationKind;
  provider: string;
  inputRefs: Record<string, unknown>;
  outputUrl: string | null;
  outputPath: string | null;
  ms: number | null;
  costEstimate: number | null;
  status: TryonGenerationStatus;
  error: string | null;
  searchId: string | null;
  productRef: string | null;
  avatarVersion: string | null;
  lookId: string | null;
  stepIndex: number | null;
  parentJobId: string | null;
};

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function countUserGenerationsToday(userId: string): Promise<number> {
  if (testGenStore) {
    return [...testGenStore.values()].filter(
      (r) =>
        r.userId === userId &&
        ["completed", "processing", "pending"].includes(r.status),
    ).length;
  }
  const mem = (globalThis as { __tryonGenCount?: Map<string, number> })
    .__tryonGenCount;
  if (process.env.NODE_ENV === "test" && mem) {
    return mem.get(userId) ?? 0;
  }
  return prisma.tryonGeneration.count({
    where: {
      userId,
      createdAt: { gte: startOfUtcDay() },
      status: { in: ["completed", "processing", "pending"] },
    },
  });
}

export async function assertUserGenerationCap(userId: string): Promise<void> {
  const count = await countUserGenerationsToday(userId);
  if (count >= TRYON_USER_DAILY_CAP) {
    throw new TryonCapError(
      "You've hit today's try-on limit — pick your favorites and come back tomorrow.",
    );
  }
}

export async function recordGenerationCost(cost: number): Promise<void> {
  if (testGenStore || process.env.NODE_ENV === "test") {
    const key = "__tryonDailySpend";
    const g = globalThis as { [key]?: number };
    g[key] = (g[key] ?? 0) + cost;
    if ((g[key] ?? 0) >= TRYON_GLOBAL_DAILY_SPEND_CAP) tripGlobalTryonCap();
    return;
  }
  const since = startOfUtcDay();
  const agg = await prisma.tryonGeneration.aggregate({
    where: { createdAt: { gte: since }, status: "completed" },
    _sum: { costEstimate: true },
  });
  const total = (agg._sum.costEstimate ?? 0) + cost;
  if (total >= TRYON_GLOBAL_DAILY_SPEND_CAP) tripGlobalTryonCap();
}

export class TryonCapError extends Error {
  readonly name = "TryonCapError";
}

let testGenStore: Map<string, GenerationRow> | null = null;

export function useInMemoryGenerations(): void {
  testGenStore = new Map();
  (globalThis as { __tryonGenCount?: Map<string, number> }).__tryonGenCount =
    new Map();
}

export function clearInMemoryGenerations(): void {
  testGenStore = null;
  delete (globalThis as { __tryonGenCount?: Map<string, number> })
    .__tryonGenCount;
}

function bumpTestCount(userId: string): void {
  const mem = (globalThis as { __tryonGenCount?: Map<string, number> })
    .__tryonGenCount;
  if (!mem) return;
  mem.set(userId, (mem.get(userId) ?? 0) + 1);
}

export async function createGeneration(params: {
  personId: string;
  userId: string;
  kind: TryonGenerationKind;
  provider: string;
  inputRefs: Record<string, unknown>;
  searchId?: string;
  productRef?: string;
  avatarVersion?: string;
  lookId?: string;
  stepIndex?: number;
  parentJobId?: string;
  skipCapCheck?: boolean;
}): Promise<GenerationRow> {
  if (!params.skipCapCheck) {
    await assertUserGenerationCap(params.userId);
    bumpTestCount(params.userId);
  }

  if (testGenStore) {
    const id = `gen_${testGenStore.size + 1}`;
    const row: GenerationRow = {
      id,
      personId: params.personId,
      userId: params.userId,
      kind: params.kind,
      provider: params.provider,
      inputRefs: params.inputRefs,
      outputUrl: null,
      outputPath: null,
      ms: null,
      costEstimate: null,
      status: "pending",
      error: null,
      searchId: params.searchId ?? null,
      productRef: params.productRef ?? null,
      avatarVersion: params.avatarVersion ?? null,
      lookId: params.lookId ?? null,
      stepIndex: params.stepIndex ?? null,
      parentJobId: params.parentJobId ?? null,
    };
    testGenStore.set(id, row);
    return row;
  }

  // Roster short ids (#abcd) are not Postgres uuids — refuse before Prisma.
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(params.personId) || !uuidRe.test(params.userId)) {
    throw new Error("Couldn't dress this one — try another piece.");
  }

  const row = await prisma.tryonGeneration.create({
    data: {
      personId: params.personId,
      userId: params.userId,
      kind: params.kind,
      provider: params.provider,
      inputRefs: params.inputRefs as InputJsonValue,
      searchId: params.searchId,
      productRef: params.productRef,
      avatarVersion: params.avatarVersion,
      lookId: params.lookId,
      stepIndex: params.stepIndex,
      parentJobId: params.parentJobId,
      status: "pending",
    },
  });
  return prismaRowToGeneration(row);
}

export async function updateGeneration(
  id: string,
  patch: Partial<{
    status: TryonGenerationStatus;
    outputUrl: string;
    outputPath: string;
    ms: number;
    costEstimate: number;
    error: string;
    provider: string;
  }>,
): Promise<GenerationRow> {
  if (testGenStore) {
    const existing = testGenStore.get(id);
    if (!existing) throw new Error(`generation not found: ${id}`);
    const next = { ...existing, ...patch };
    testGenStore.set(id, next);
    if (patch.status === "completed" && patch.costEstimate != null) {
      await recordGenerationCost(patch.costEstimate);
    }
    return next;
  }
  const row = await prisma.tryonGeneration.update({
    where: { id },
    data: patch,
  });
  if (patch.status === "completed" && patch.costEstimate != null) {
    await recordGenerationCost(patch.costEstimate);
  }
  return prismaRowToGeneration(row);
}

export async function getGeneration(
  id: string,
  userId: string,
): Promise<GenerationRow | null> {
  if (testGenStore) {
    const row = testGenStore.get(id);
    if (!row || row.userId !== userId) return null;
    return row;
  }
  const row = await prisma.tryonGeneration.findFirst({
    where: { id, userId },
  });
  return row ? prismaRowToGeneration(row) : null;
}

export async function listChildGenerations(
  parentJobId: string,
  userId: string,
): Promise<GenerationRow[]> {
  if (testGenStore) {
    return [...testGenStore.values()].filter(
      (r) => r.parentJobId === parentJobId && r.userId === userId,
    );
  }
  const rows = await prisma.tryonGeneration.findMany({
    where: { parentJobId, userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(prismaRowToGeneration);
}

export async function findCachedCompareTryon(params: {
  avatarVersion: string;
  productRef: string;
  userId: string;
}): Promise<{ parent: GenerationRow; children: GenerationRow[] } | null> {
  const matchParent = (row: GenerationRow) =>
    row.kind === "single" &&
    row.provider === "compare" &&
    row.status === "completed" &&
    row.avatarVersion === params.avatarVersion &&
    row.productRef === params.productRef &&
    row.userId === params.userId;

  if (testGenStore) {
    for (const row of testGenStore.values()) {
      if (!matchParent(row)) continue;
      const children = [...testGenStore.values()].filter(
        (c) => c.parentJobId === row.id && c.status === "completed" && c.outputUrl,
      );
      if (children.length) return { parent: row, children };
    }
    return null;
  }

  const parent = await prisma.tryonGeneration.findFirst({
    where: {
      kind: "single",
      provider: "compare",
      status: "completed",
      avatarVersion: params.avatarVersion,
      productRef: params.productRef,
      userId: params.userId,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!parent) return null;
  const children = await prisma.tryonGeneration.findMany({
    where: {
      parentJobId: parent.id,
      status: "completed",
      outputUrl: { not: null },
    },
  });
  if (!children.length) return null;
  return {
    parent: prismaRowToGeneration(parent),
    children: children.map(prismaRowToGeneration),
  };
}

export async function findCachedSingleTryon(params: {
  avatarVersion: string;
  productRef: string;
  userId: string;
}): Promise<GenerationRow | null> {
  if (testGenStore) {
    for (const row of testGenStore.values()) {
      if (
        row.kind === "single" &&
        row.status === "completed" &&
        row.avatarVersion === params.avatarVersion &&
        row.productRef === params.productRef &&
        row.userId === params.userId &&
        row.outputUrl &&
        row.provider !== "compare" &&
        !row.parentJobId
      ) {
        return row;
      }
    }
    return null;
  }
  const row = await prisma.tryonGeneration.findFirst({
    where: {
      kind: "single",
      status: "completed",
      avatarVersion: params.avatarVersion,
      productRef: params.productRef,
      userId: params.userId,
      provider: { not: "compare" },
      parentJobId: null,
    },
    orderBy: { createdAt: "desc" },
  });
  return row ? prismaRowToGeneration(row) : null;
}

export async function findCachedOutfitTryon(params: {
  avatarVersion: string;
  cacheKey: string;
  userId: string;
}): Promise<GenerationRow | null> {
  if (testGenStore) {
    for (const row of testGenStore.values()) {
      if (
        row.kind === "outfit" &&
        row.status === "completed" &&
        row.avatarVersion === params.avatarVersion &&
        row.productRef === params.cacheKey &&
        row.userId === params.userId &&
        row.outputUrl &&
        row.provider !== "compare" &&
        !row.parentJobId
      ) {
        return row;
      }
    }
    return null;
  }
  const row = await prisma.tryonGeneration.findFirst({
    where: {
      kind: "outfit",
      status: "completed",
      avatarVersion: params.avatarVersion,
      productRef: params.cacheKey,
      userId: params.userId,
      provider: { not: "compare" },
      parentJobId: null,
    },
    orderBy: { createdAt: "desc" },
  });
  return row ? prismaRowToGeneration(row) : null;
}

export async function findCachedOutfitCompareTryon(params: {
  avatarVersion: string;
  cacheKey: string;
  userId: string;
}): Promise<{ parent: GenerationRow; children: GenerationRow[] } | null> {
  const matchParent = (row: GenerationRow) =>
    row.kind === "outfit" &&
    row.provider === "compare" &&
    row.status === "completed" &&
    row.avatarVersion === params.avatarVersion &&
    row.productRef === params.cacheKey &&
    row.userId === params.userId;

  if (testGenStore) {
    for (const row of testGenStore.values()) {
      if (!matchParent(row)) continue;
      const children = [...testGenStore.values()].filter(
        (c) =>
          c.parentJobId === row.id &&
          c.kind === "outfit" &&
          c.status === "completed" &&
          c.outputUrl,
      );
      if (children.length) return { parent: row, children };
    }
    return null;
  }

  const parent = await prisma.tryonGeneration.findFirst({
    where: {
      kind: "outfit",
      provider: "compare",
      status: "completed",
      avatarVersion: params.avatarVersion,
      productRef: params.cacheKey,
      userId: params.userId,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!parent) return null;
  const children = await prisma.tryonGeneration.findMany({
    where: {
      parentJobId: parent.id,
      kind: "outfit",
      status: "completed",
      outputUrl: { not: null },
    },
  });
  if (!children.length) return null;
  return {
    parent: prismaRowToGeneration(parent),
    children: children.map(prismaRowToGeneration),
  };
}

export async function listGenerationsForPerson(
  personId: string,
): Promise<GenerationRow[]> {
  if (testGenStore) {
    return [...testGenStore.values()].filter((r) => r.personId === personId);
  }
  const rows = await prisma.tryonGeneration.findMany({ where: { personId } });
  return rows.map(prismaRowToGeneration);
}

/** Most recent completed single/outfit try-on with an output image. */
export async function findLatestCompletedTryon(
  userId: string,
): Promise<GenerationRow | null> {
  if (testGenStore) {
    let latest: GenerationRow | null = null;
    for (const row of testGenStore.values()) {
      if (
        row.userId === userId &&
        row.status === "completed" &&
        Boolean(row.outputUrl) &&
        (row.kind === "single" || row.kind === "outfit")
      ) {
        latest = row;
      }
    }
    return latest;
  }
  const row = await prisma.tryonGeneration.findFirst({
    where: {
      userId,
      status: "completed",
      outputUrl: { not: null },
      kind: { in: ["single", "outfit"] },
    },
    orderBy: { createdAt: "desc" },
  });
  return row ? prismaRowToGeneration(row) : null;
}

export async function deleteGenerationsForPerson(personId: string): Promise<void> {
  if (testGenStore) {
    for (const [id, row] of testGenStore) {
      if (row.personId === personId) testGenStore.delete(id);
    }
    return;
  }
  await prisma.tryonGeneration.deleteMany({ where: { personId } });
}

function prismaRowToGeneration(row: {
  id: string;
  personId: string;
  userId: string;
  kind: TryonGenerationKind;
  provider: string;
  inputRefs: unknown;
  outputUrl: string | null;
  outputPath: string | null;
  ms: number | null;
  costEstimate: number | null;
  status: TryonGenerationStatus;
  error: string | null;
  searchId: string | null;
  productRef: string | null;
  avatarVersion: string | null;
  lookId: string | null;
  stepIndex: number | null;
  parentJobId: string | null;
}): GenerationRow {
  return {
    id: row.id,
    personId: row.personId,
    userId: row.userId,
    kind: row.kind,
    provider: row.provider,
    inputRefs: (row.inputRefs ?? {}) as Record<string, unknown>,
    outputUrl: row.outputUrl,
    outputPath: row.outputPath,
    ms: row.ms,
    costEstimate: row.costEstimate,
    status: row.status,
    error: row.error,
    searchId: row.searchId,
    productRef: row.productRef,
    avatarVersion: row.avatarVersion,
    lookId: row.lookId,
    stepIndex: row.stepIndex,
    parentJobId: row.parentJobId,
  };
}

export async function saveTryonFeedback(params: {
  generationId: string;
  userId: string;
  rating: 1 | -1;
}): Promise<void> {
  if (testGenStore) return;
  await prisma.tryonFeedback.upsert({
    where: {
      generationId_userId: {
        generationId: params.generationId,
        userId: params.userId,
      },
    },
    create: {
      generationId: params.generationId,
      userId: params.userId,
      rating: params.rating,
    },
    update: { rating: params.rating },
  });
}

export type MoodboardItem = {
  generationId: string;
  imageUrl: string;
  kind: "item" | "look";
  title: string;
  lovedAt: string;
  searchId: string | null;
  productRef: string | null;
  lookId: string | null;
};

/** Loved try-ons (♥ feedback) — source of truth for the Moodboard. */
export async function listMoodboardTryons(
  userId: string,
  limit = 60,
): Promise<MoodboardItem[]> {
  if (testGenStore) return [];

  const rows = await prisma.tryonFeedback.findMany({
    where: {
      userId,
      rating: 1,
      generation: {
        status: "completed",
        kind: { in: ["single", "outfit"] },
        outputUrl: { not: null },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      generation: {
        select: {
          id: true,
          kind: true,
          outputUrl: true,
          outputPath: true,
          inputRefs: true,
          searchId: true,
          productRef: true,
          lookId: true,
        },
      },
    },
  });

  const items: MoodboardItem[] = [];
  for (const row of rows) {
    const gen = row.generation;
    if (!gen.outputUrl && !gen.outputPath) continue;

    // Same-origin URL — /api/tryon/image re-signs private storage per request.
    // Never hand the browser a stored signed URL (they expire in ~1h).
    const kind = gen.kind === "outfit" ? "look" : "item";
    const inputRefs =
      gen.inputRefs &&
      typeof gen.inputRefs === "object" &&
      !Array.isArray(gen.inputRefs)
        ? (gen.inputRefs as Record<string, unknown>)
        : null;

    items.push({
      generationId: gen.id,
      imageUrl: `/api/tryon/image/${gen.id}`,
      kind,
      title: moodboardDisplayTitle({
        kind,
        lookId: gen.lookId,
        inputRefs,
      }),
      lovedAt: row.createdAt.toISOString(),
      searchId: gen.searchId,
      productRef: gen.productRef,
      lookId: gen.lookId,
    });
  }
  return items;
}

export async function countAvatarRegensToday(personId: string): Promise<number> {
  const db = fashionMemoryDb();
  const since = startOfUtcDay().toISOString();
  const { count } = await db
    .from("tryon_generations")
    .select("id", { count: "exact", head: true })
    .eq("person_id", personId)
    .eq("kind", "avatar")
    .gte("created_at", since);
  if (typeof count === "number") return count;
  if (testGenStore) {
    return [...testGenStore.values()].filter(
      (r) => r.personId === personId && r.kind === "avatar",
    ).length;
  }
  return prisma.tryonGeneration.count({
    where: {
      personId,
      kind: "avatar",
      createdAt: { gte: startOfUtcDay() },
    },
  });
}
