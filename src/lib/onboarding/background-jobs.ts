import type { InteractiveTransactionClient } from "@/lib/ai-chat/prisma-types";
import { prisma } from "@/lib/ai-chat/db";
import { logAiChat } from "@/lib/ai-chat/observability";
import { extractShoppingMemory } from "@/lib/ai-chat/shopping-memory/extractor";
import { writeMemoryFromExtraction } from "@/lib/ai-chat/shopping-memory/writer";
import { refreshTypedProfileIntoShoppingView } from "@/lib/onboarding/sync-profile-summary";
import { seedOnboardingIntoFashionMemory } from "@/lib/onboarding/seed-fashion-memory";
import { loadOnboardingProjectionSnapshot } from "@/lib/onboarding/projection-snapshot";

const LOCK_TIMEOUT_MS = 3 * 60_000;
const NOTES_TIMEOUT_MS = 2 * 60_000;

type ProjectionJob = {
  id: string;
  userId: string;
  version: number;
  attempts: number;
  maxAttempts: number;
};

type ExtraNotesJob = {
  id: string;
  userId: string;
  requestKey: string;
  text: string;
  attempts: number;
  maxAttempts: number;
};

const globalForOnboardingJobs = globalThis as unknown as {
  onboardingWorker?: Promise<void>;
};

export async function enqueueOnboardingProjection(
  tx: InteractiveTransactionClient,
  userId: string,
  version: number,
): Promise<void> {
  await tx.onboardingProjectionJob.upsert({
    where: { userId_version: { userId, version } },
    create: { userId, version },
    update: {},
  });
}

export async function enqueueOnboardingExtraNotes(
  tx: InteractiveTransactionClient,
  params: { userId: string; requestKey: string; text: string },
): Promise<void> {
  await tx.onboardingExtraNotesJob.upsert({
    where: { requestKey: params.requestKey },
    create: {
      userId: params.userId,
      requestKey: params.requestKey,
      text: params.text,
    },
    update: {},
  });
}

async function recoverStaleJobs() {
  const staleBefore = new Date(Date.now() - LOCK_TIMEOUT_MS);
  await Promise.all([
    prisma.onboardingProjectionJob.updateMany({
      where: {
        status: "processing",
        lockedAt: { lt: staleBefore },
        attempts: { lt: 3 },
      },
      data: {
        status: "pending",
        lockedAt: null,
        lastError: "Worker lock expired; retrying.",
      },
    }),
    prisma.onboardingExtraNotesJob.updateMany({
      where: {
        status: "processing",
        lockedAt: { lt: staleBefore },
        attempts: { lt: 3 },
      },
      data: {
        status: "pending",
        lockedAt: null,
        lastError: "Worker lock expired; retrying.",
      },
    }),
  ]);
}

async function claimProjection(): Promise<ProjectionJob | null> {
  const candidate = await prisma.onboardingProjectionJob.findFirst({
    where: { status: "pending", attempts: { lt: 3 } },
    orderBy: [{ version: "desc" }, { createdAt: "asc" }],
  });
  if (!candidate) return null;

  const claimed = await prisma.onboardingProjectionJob.updateMany({
    where: { id: candidate.id, status: "pending" },
    data: {
      status: "processing",
      attempts: { increment: 1 },
      lockedAt: new Date(),
      lastError: null,
    },
  });
  if (claimed.count !== 1) return null;
  return prisma.onboardingProjectionJob.findUnique({
    where: { id: candidate.id },
  });
}

async function claimExtraNotes(): Promise<ExtraNotesJob | null> {
  const candidate = await prisma.onboardingExtraNotesJob.findFirst({
    where: { status: "pending", attempts: { lt: 3 } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!candidate) return null;

  const claimed = await prisma.onboardingExtraNotesJob.updateMany({
    where: { id: candidate.id, status: "pending" },
    data: {
      status: "processing",
      attempts: { increment: 1 },
      lockedAt: new Date(),
      lastError: null,
    },
  });
  if (claimed.count !== 1) return null;
  return prisma.onboardingExtraNotesJob.findUnique({
    where: { id: candidate.id },
  });
}

async function processProjection(job: ProjectionJob): Promise<void> {
  try {
    const snapshot = await loadOnboardingProjectionSnapshot(job.userId);
    const [, fashionResult] = await Promise.all([
      refreshTypedProfileIntoShoppingView(job.userId, snapshot),
      seedOnboardingIntoFashionMemory(job.userId, snapshot),
    ]);
    if (!fashionResult.ok && fashionResult.reason !== "not_auth_user") {
      throw new Error(fashionResult.reason ?? "fashion_projection_failed");
    }

    await prisma.onboardingProjectionJob.updateMany({
      where: {
        userId: job.userId,
        version: { lte: job.version },
        status: { in: ["pending", "processing"] },
      },
      data: {
        status: "completed",
        processedAt: new Date(),
        lockedAt: null,
        lastError: null,
      },
    });
  } catch (error) {
    const final = job.attempts >= job.maxAttempts;
    await prisma.onboardingProjectionJob.update({
      where: { id: job.id },
      data: {
        status: final ? "failed" : "pending",
        lockedAt: null,
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
    logAiChat(final ? "error" : "warn", "onboarding_projection_failed", {
      jobId: job.id,
      userId: job.userId,
      version: job.version,
      final,
      error,
    });
  }
}

async function processExtraNotes(job: ExtraNotesJob): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NOTES_TIMEOUT_MS);
  try {
    const extraction = await extractShoppingMemory(
      `The user added optional notes after reviewing their onboarding profile.
Extract useful shopping memories, owned products, recipients, and preferences.
Do not emit profileUpdates or activeIntent and do not reinterpret identity fields.

Notes:
${job.text}`,
      controller.signal,
      {
        maxTokens: 4096,
        audit: {
          userId: job.userId,
          kind: "memory_extract",
          sequence: 0,
          metadata: { source: "onboarding_extra_notes" },
        },
      },
    );
    if (extraction) {
      await writeMemoryFromExtraction(job.userId, null, null, extraction);
    }
    await prisma.onboardingExtraNotesJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        processedAt: new Date(),
        lockedAt: null,
        lastError: null,
      },
    });
  } catch (error) {
    const final = job.attempts >= job.maxAttempts;
    await prisma.onboardingExtraNotesJob.update({
      where: { id: job.id },
      data: {
        status: final ? "failed" : "pending",
        lockedAt: null,
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
    logAiChat(final ? "error" : "warn", "onboarding_extra_notes_failed", {
      jobId: job.id,
      userId: job.userId,
      final,
      error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function drainOnboardingJobs(limit = 4): Promise<void> {
  await recoverStaleJobs();
  for (let i = 0; i < limit; i++) {
    const projection = await claimProjection();
    if (projection) {
      await processProjection(projection);
      continue;
    }
    const notes = await claimExtraNotes();
    if (!notes) return;
    await processExtraNotes(notes);
  }
}

export function kickOnboardingJobWorker(): Promise<void> {
  if (!globalForOnboardingJobs.onboardingWorker) {
    globalForOnboardingJobs.onboardingWorker = drainOnboardingJobs()
      .catch((error) => {
        logAiChat("error", "onboarding_worker_failed", { error });
      })
      .finally(() => {
        globalForOnboardingJobs.onboardingWorker = undefined;
      });
  }
  return globalForOnboardingJobs.onboardingWorker;
}
