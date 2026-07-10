import {
  CURATION_JOBS_PER_KICK,
  CURATION_PIPELINE_TIMEOUT_MS,
  CURATION_WORKER_DEFER_MS,
} from "./constants";
import { productCurationJobPayloadSchema } from "./job-payload";
import { runCuratorPass, type CuratorContext } from "./curator";
import { prisma } from "../db";
import { logAiChat } from "../observability";
import { patchAssistantProductSearchCuration } from "../chat-service";
import type { ProductCurationJobPayload } from "./job-payload";

type ProductCurationJobRow = {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string;
  searchKey: string;
  payload: unknown;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
};

type ProductCurationJobDelegate = {
  upsert: (args: object) => Promise<unknown>;
  updateMany: (args: object) => Promise<{ count: number }>;
  findFirst: (args: object) => Promise<ProductCurationJobRow | null>;
  findUnique: (args: object) => Promise<ProductCurationJobRow | null>;
  update: (args: object) => Promise<unknown>;
};

const globalForCurationJobs = globalThis as unknown as {
  productCurationJobWorkerRunning?: boolean;
  productCurationWorkerTimer?: ReturnType<typeof setTimeout>;
};

function jobDelegate(): ProductCurationJobDelegate | null {
  const d = (prisma as unknown as { productCurationJob?: unknown })
    .productCurationJob;
  if (!d || (typeof d !== "object" && typeof d !== "function")) return null;
  return d as ProductCurationJobDelegate;
}

export async function enqueueProductCurationJob(params: {
  userId: string;
  conversationId: string;
  messageId: string;
  searchKey: string;
  payload: ProductCurationJobPayload;
}): Promise<boolean> {
  const jobs = jobDelegate();
  if (!jobs) return false;

  await jobs.upsert({
    where: {
      messageId_searchKey: {
        messageId: params.messageId,
        searchKey: params.searchKey,
      },
    },
    create: {
      userId: params.userId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      searchKey: params.searchKey,
      payload: params.payload,
      status: "pending",
      attempts: 0,
      lastError: null,
      lockedAt: null,
      processedAt: null,
    },
    update: {
      userId: params.userId,
      conversationId: params.conversationId,
      payload: params.payload,
      status: "pending",
      lastError: null,
      lockedAt: null,
      processedAt: null,
    },
  });

  logAiChat("info", "curator_job_enqueued", {
    conversationId: params.conversationId,
    messageId: params.messageId,
    searchKey: params.searchKey,
    cardCount: params.payload.cards.length,
    query: params.payload.searchInput.query.slice(0, 120),
  });
  return true;
}

async function claimNextJob(): Promise<ProductCurationJobRow | null> {
  const jobs = jobDelegate();
  if (!jobs) return null;

  const staleBefore = new Date(Date.now() - CURATION_PIPELINE_TIMEOUT_MS * 2);
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

function curatorContextFromJob(job: ProductCurationJobRow): CuratorContext | null {
  const parsed = productCurationJobPayloadSchema.safeParse(job.payload);
  if (!parsed.success) {
    logAiChat("warn", "curator_job_payload_parse_failed", {
      jobId: job.id,
      messageId: job.messageId,
      searchKey: job.searchKey,
      issues: parsed.error.issues.slice(0, 5).map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return null;
  }
  const payload = parsed.data as ProductCurationJobPayload;
  return {
    userId: job.userId,
    conversationId: job.conversationId,
    messageId: job.messageId,
    userMessageId: payload.userMessageId ?? null,
    searchKey: job.searchKey,
    searchInput: payload.searchInput,
    cards: payload.cards,
    memoryQueryHint: payload.memoryQueryHint,
    preBuiltMemoryXml: payload.preBuiltMemoryXml,
    displayLimit: payload.displayLimit,
    shoppingModeMeta: payload.shoppingModeMeta ?? null,
    buyerContext: payload.buyerContext,
    auditSequence: payload.promptSequence,
  };
}

async function processJob(job: ProductCurationJobRow) {
  const jobs = jobDelegate();
  if (!jobs) return;

  const ctx = curatorContextFromJob(job);
  if (!ctx) {
    await jobs.update({
      where: { id: job.id },
      data: {
        status: "failed",
        lastError: "Invalid curation job payload.",
        lockedAt: null,
      },
    });
    logAiChat("error", "curator_job_invalid_payload", {
      jobId: job.id,
      messageId: job.messageId,
      searchKey: job.searchKey,
    });
    return;
  }

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), CURATION_PIPELINE_TIMEOUT_MS);

  try {
    const outcome = await runCuratorPass(ctx, ({ picks, fallback }) => {
      void patchAssistantProductSearchCuration({
        messageId: job.messageId,
        searchKey: job.searchKey,
        curatedPicks: picks,
        curationFallback: fallback,
      }).catch((error) => {
        logAiChat("warn", "curator_job_patch_failed", {
          jobId: job.id,
          messageId: job.messageId,
          searchKey: job.searchKey,
          error,
        });
      });
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

    logAiChat("info", "curator_job_completed", {
      jobId: job.id,
      conversationId: job.conversationId,
      messageId: job.messageId,
      searchKey: job.searchKey,
      attempts: job.attempts,
      pickCount: outcome.picks.length,
      fallback: outcome.fallback,
      latencyMs: outcome.latencyMs,
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

    logAiChat(final ? "error" : "warn", "curator_job_failed", {
      jobId: job.id,
      conversationId: job.conversationId,
      messageId: job.messageId,
      searchKey: job.searchKey,
      attempts: job.attempts,
      final,
      error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function drainProductCurationJobs(limit = CURATION_JOBS_PER_KICK) {
  for (let i = 0; i < limit; i++) {
    const job = await claimNextJob();
    if (!job) return;
    await processJob(job);
  }
}

function runCurationJobWorkerNow() {
  if (globalForCurationJobs.productCurationJobWorkerRunning) return;
  globalForCurationJobs.productCurationJobWorkerRunning = true;
  void drainProductCurationJobs()
    .catch((error) => {
      logAiChat("error", "curator_worker_error", { error });
    })
    .finally(() => {
      globalForCurationJobs.productCurationJobWorkerRunning = false;
    });
}

/** Schedule curator work after enqueue (debounced coalescing). */
export function scheduleProductCurationJobWorker() {
  const existing = globalForCurationJobs.productCurationWorkerTimer;
  if (existing) clearTimeout(existing);

  globalForCurationJobs.productCurationWorkerTimer = setTimeout(() => {
    globalForCurationJobs.productCurationWorkerTimer = undefined;
    runCurationJobWorkerNow();
  }, CURATION_WORKER_DEFER_MS);
}

/** Kick the worker immediately (e.g. from /api/chat). */
export function kickProductCurationJobWorker() {
  scheduleProductCurationJobWorker();
}
