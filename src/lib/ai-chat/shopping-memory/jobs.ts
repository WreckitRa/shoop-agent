import { MEMORY_PIPELINE_TIMEOUT_MS } from "../constants";
import { prisma } from "../db";
import { logAiChat } from "../observability";
import { processUserMessageShoppingMemory } from "./pipeline";

type ShoppingMemoryJobRow = {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string;
  text: string;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
};

type ShoppingMemoryJobDelegate = {
  upsert: (args: object) => Promise<unknown>;
  updateMany: (args: object) => Promise<{ count: number }>;
  findFirst: (args: object) => Promise<ShoppingMemoryJobRow | null>;
  findUnique: (args: object) => Promise<ShoppingMemoryJobRow | null>;
  update: (args: object) => Promise<unknown>;
};

const globalForMemoryJobs = globalThis as unknown as {
  shoppingMemoryJobWorkerRunning?: boolean;
};

function jobDelegate(): ShoppingMemoryJobDelegate | null {
  const d = (prisma as unknown as { shoppingMemoryJob?: unknown })
    .shoppingMemoryJob;
  if (!d || (typeof d !== "object" && typeof d !== "function")) return null;
  return d as ShoppingMemoryJobDelegate;
}

export async function enqueueShoppingMemoryJob(params: {
  userId: string;
  conversationId: string;
  messageId: string;
  text: string;
}): Promise<boolean> {
  const jobs = jobDelegate();
  if (!jobs) return false;

  await jobs.upsert({
    where: { messageId: params.messageId },
    create: {
      ...params,
      status: "pending",
      attempts: 0,
      lastError: null,
      lockedAt: null,
      processedAt: null,
    },
    update: {
      text: params.text,
      status: "pending",
      lastError: null,
      lockedAt: null,
      processedAt: null,
    },
  });

  logAiChat("info", "shopping_memory_job_enqueued", {
    conversationId: params.conversationId,
    messageId: params.messageId,
  });
  return true;
}

async function claimNextJob(): Promise<ShoppingMemoryJobRow | null> {
  const jobs = jobDelegate();
  if (!jobs) return null;

  const staleBefore = new Date(Date.now() - MEMORY_PIPELINE_TIMEOUT_MS * 2);
  await jobs.updateMany({
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
  });

  const candidate = await jobs.findFirst({
    where: {
      status: "pending",
      attempts: { lt: 3 },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!candidate) return null;

  const claimed = await jobs.updateMany({
    where: {
      id: candidate.id,
      status: "pending",
    },
    data: {
      status: "processing",
      attempts: { increment: 1 },
      lockedAt: new Date(),
      lastError: null,
    },
  });
  if (claimed.count !== 1) return null;

  return jobs.findUnique({ where: { id: candidate.id } });
}

async function processJob(job: ShoppingMemoryJobRow) {
  const jobs = jobDelegate();
  if (!jobs) return;

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), MEMORY_PIPELINE_TIMEOUT_MS);

  try {
    await processUserMessageShoppingMemory({
      userId: job.userId,
      conversationId: job.conversationId,
      messageId: job.messageId,
      text: job.text,
      signal: ac.signal,
    });

    await jobs.update({
      where: { id: job.id },
      data: {
        status: "completed",
        processedAt: new Date(),
        lockedAt: null,
        lastError: null,
      },
    });

    logAiChat("info", "shopping_memory_job_completed", {
      jobId: job.id,
      conversationId: job.conversationId,
      messageId: job.messageId,
      attempts: job.attempts,
    });
  } catch (error) {
    const final = job.attempts >= job.maxAttempts;
    await jobs.update({
      where: { id: job.id },
      data: {
        status: final ? "failed" : "pending",
        lockedAt: null,
        lastError: error instanceof Error ? error.message : String(error),
      },
    });

    logAiChat(final ? "error" : "warn", "shopping_memory_job_failed", {
      jobId: job.id,
      conversationId: job.conversationId,
      messageId: job.messageId,
      attempts: job.attempts,
      final,
      error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function drainShoppingMemoryJobs(limit = 3) {
  for (let i = 0; i < limit; i++) {
    const job = await claimNextJob();
    if (!job) return;
    await processJob(job);
  }
}

export function kickShoppingMemoryJobWorker() {
  if (globalForMemoryJobs.shoppingMemoryJobWorkerRunning) return;
  globalForMemoryJobs.shoppingMemoryJobWorkerRunning = true;
  void drainShoppingMemoryJobs()
    .catch((error) => {
      logAiChat("error", "shopping_memory_worker_error", { error });
    })
    .finally(() => {
      globalForMemoryJobs.shoppingMemoryJobWorkerRunning = false;
    });
}
