import { Prisma, PrismaClient } from "@prisma/client";

import { logAiChat } from "./observability";

/**
 * Prisma singleton.
 *
 * 1. Caps the per-process connection pool (`connection_limit`) and sets
 *    `connect_timeout` / `pool_timeout` for Supabase's session pooler (hard cap
 *    15 clients project-wide).
 *
 * 2. Retries on pool exhaustion with backoff — never opens a new client (that
 *    makes EMAXCONNSESSION worse). Reconnects only on dead TCP sessions.
 *
 * 3. Does NOT recreate the client when typed delegates are missing — restart
 *    `npm run dev` after `prisma generate` instead.
 */

const POOL_LIMIT = Number(
  process.env.PRISMA_CONNECTION_LIMIT ??
    (process.env.NODE_ENV === "development" ? "2" : "5"),
);
const CONNECT_TIMEOUT_S = Number(process.env.PRISMA_CONNECT_TIMEOUT ?? "15");
const POOL_TIMEOUT_S = Number(process.env.PRISMA_POOL_TIMEOUT ?? "15");

const POOL_EXHAUSTION_DELAYS_MS = [250, 500, 1000, 2000, 3000];

/** Bump when PhotoAnalysis columns change so a hot reload drops the stale client. */
const PRISMA_RUNTIME_EPOCH = "photo-analysis-v3";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaEpoch?: string;
  prismaOverride?: PrismaClient;
  prismaWarnedMissingDelegates?: boolean;
  prismaReconnecting?: Promise<void>;
};

/** E2E/test — swap Prisma client without module mocking. */
export function setPrismaClientOverride(client: PrismaClient | null): void {
  globalForPrisma.prismaOverride = client ?? undefined;
}

export function getPrismaClientOverride(): PrismaClient | undefined {
  return globalForPrisma.prismaOverride;
}

function appendQueryParam(url: string, key: string, value: string | number): string {
  if (!url || new RegExp(`[?&]${key}=`).test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${key}=${value}`;
}

function ensureDatabaseUrl(url: string): string {
  if (!url) return url;
  let out = appendQueryParam(url, "connection_limit", POOL_LIMIT);
  out = appendQueryParam(out, "connect_timeout", CONNECT_TIMEOUT_S);
  out = appendQueryParam(out, "pool_timeout", POOL_TIMEOUT_S);
  return out;
}

function createPrismaClient(): PrismaClient {
  const url = ensureDatabaseUrl(process.env.DATABASE_URL ?? "");
  return new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}

function isPoolExhaustionError(error: unknown): boolean {
  if (error instanceof Error) {
    const m = error.message.toLowerCase();
    return (
      m.includes("emaxconnsession") ||
      m.includes("max clients reached") ||
      m.includes("too many connections") ||
      m.includes("remaining connection slots")
    );
  }
  return false;
}

function isConnectionError(error: unknown): boolean {
  if (isPoolExhaustionError(error)) return false;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1001", "P1002", "P1008", "P1017"].includes(error.code);
  }
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Error) {
    const m = error.message.toLowerCase();
    return (
      m.includes("kind: closed") ||
      m.includes("connection closed") ||
      (m.includes("connection") &&
        (m.includes("terminated") ||
          m.includes("reset") ||
          m.includes("closed")))
    );
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reconnectPrisma(): Promise<void> {
  if (globalForPrisma.prismaReconnecting) {
    return globalForPrisma.prismaReconnecting;
  }

  globalForPrisma.prismaReconnecting = (async () => {
    const old = globalForPrisma.prisma;
    if (old) {
      try {
        await old.$disconnect();
      } catch {
        /* ignore */
      }
    }
    globalForPrisma.prisma = createPrismaClient();
    await globalForPrisma.prisma.$connect();
    logAiChat("info", "prisma_reconnected", {});
  })().finally(() => {
    globalForPrisma.prismaReconnecting = undefined;
  });

  return globalForPrisma.prismaReconnecting;
}

async function runWithConnectionRetry<T>(
  prop: string | symbol,
  fn: () => Promise<T>,
): Promise<T> {
  let reconnected = false;

  for (let attempt = 0; attempt <= POOL_EXHAUSTION_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (
        isPoolExhaustionError(error) &&
        attempt < POOL_EXHAUSTION_DELAYS_MS.length
      ) {
        const delayMs = POOL_EXHAUSTION_DELAYS_MS[attempt]!;
        logAiChat("warn", "prisma_pool_exhausted_retry", {
          attempt: attempt + 1,
          delayMs,
          op: String(prop),
        });
        await sleep(delayMs);
        continue;
      }

      const reconnectable =
        !reconnected &&
        typeof prop === "string" &&
        prop !== "$disconnect" &&
        prop !== "$on" &&
        isConnectionError(error);
      if (reconnectable) {
        reconnected = true;
        await reconnectPrisma();
        continue;
      }

      throw error;
    }
  }

  throw new Error("prisma retry exhausted");
}

function client(): PrismaClient {
  if (globalForPrisma.prismaOverride) {
    return globalForPrisma.prismaOverride;
  }
  if (globalForPrisma.prismaEpoch !== PRISMA_RUNTIME_EPOCH) {
    const old = globalForPrisma.prisma;
    globalForPrisma.prisma = undefined;
    globalForPrisma.prismaEpoch = PRISMA_RUNTIME_EPOCH;
    if (old) void old.$disconnect().catch(() => undefined);
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  const c = globalForPrisma.prisma;

  if (
    !globalForPrisma.prismaWarnedMissingDelegates &&
    !hasShoppingDelegates(c)
  ) {
    globalForPrisma.prismaWarnedMissingDelegates = true;
    logAiChat("error", "prisma_missing_shopping_delegates", {
      hint: "Run `npx prisma generate` and restart the server to pick up the new schema.",
    });
  }

  return c;
}

/** True when this runtime's generated client includes the typed-projection models. */
function hasShoppingDelegates(c: PrismaClient): boolean {
  const p = c as unknown as Record<string, { findUnique?: unknown; findMany?: unknown }>;
  const required = [
    "userProfile",
    "sizingProfile",
    "categoryPreference",
    "brandPreference",
    "recipient",
    "shoppingIntent",
    "tasteTag",
    "hardNegative",
    "ownedProduct",
    "onboardingProjectionJob",
    "onboardingExtraNotesJob",
    "conversationContextSummary",
    "cartSession",
    "savedAddress",
  ];
  for (const name of required) {
    const d = p[name];
    if (!d) return false;
    if (typeof d.findUnique !== "function" && typeof d.findMany !== "function") {
      return false;
    }
  }
  return true;
}

/**
 * Lazy proxy: resolves the (cached) singleton on every property access without
 * forcing import-time DB initialization. Async model calls retry on pool
 * exhaustion (backoff) or stale connections (single reconnect).
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol, receiver) {
    const c = client();
    const value = Reflect.get(c, prop, receiver);
    if (typeof value === "function") {
      return (...args: unknown[]) => {
        const bound = (value as (...a: unknown[]) => unknown).bind(c);
        const result = bound(...args);
        if (result && typeof (result as Promise<unknown>).then === "function") {
          return runWithConnectionRetry(prop, () => result as Promise<unknown>);
        }
        return result;
      };
    }
    return value;
  },
});
