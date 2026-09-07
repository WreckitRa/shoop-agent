import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/ai-chat/db";
import { PHOTO_ERROR, publicPhotoError } from "./errors";
import {
  parseStylePhotoAnalysis,
  parseStylePhotoPreflight,
  type StylePhotoAnalysis,
  type StylePhotoPreflight,
} from "./result";
import { parseStyleUserReview, type StyleUserReview } from "./review";
import {
  PHOTO_ANALYSIS_ENGINE_VERSION,
  type PhotoAnalysisPublic,
} from "./types";
export { NOPHOTO_HASH } from "./types";
import { parseStylistVerdict, VERDICT_STALE_MS, type StylistVerdict } from "./verdict";
import { ANALYSIS_STALE_MS } from "./analyze";
import type { PhotoUsageTokens } from "./openai";

/**
 * PhotoAnalysis is queried via SQL, not the Prisma delegate.
 * The running Next process can keep a bakeoff-era client that still names
 * specStatus / gptStatus and does not know `gate`.
 */
export type PhotoAnalysisRow = {
  id: string;
  photoHash: string;
  status: string;
  gate: unknown;
  result: unknown;
  userReview: unknown;
  verdict: unknown;
  verdictStatus: string;
  verdictError: string | null;
  verdictMs: number | null;
  verdictModel: string | null;
  verdictTokens: unknown;
  error: string | null;
  ms: number | null;
  model: string | null;
  engineVersion: string;
  createdAt: Date;
  updatedAt: Date;
};

function jsonSql(value: unknown): Prisma.Sql {
  if (value == null) return Prisma.sql`NULL`;
  return Prisma.sql`${JSON.stringify(value)}::jsonb`;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

function asInt(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapRow(raw: Record<string, unknown>): PhotoAnalysisRow {
  return {
    id: String(raw.id),
    photoHash: String(raw.photoHash),
    status: String(raw.status),
    gate: raw.gate,
    result: raw.result,
    userReview: raw.userReview,
    verdict: raw.verdict,
    verdictStatus: String(raw.verdictStatus ?? "idle"),
    verdictError: raw.verdictError == null ? null : String(raw.verdictError),
    verdictMs: asInt(raw.verdictMs),
    verdictModel: raw.verdictModel == null ? null : String(raw.verdictModel),
    verdictTokens: raw.verdictTokens ?? null,
    error: raw.error == null ? null : String(raw.error),
    ms: asInt(raw.ms),
    model: raw.model == null ? null : String(raw.model),
    engineVersion: String(raw.engineVersion),
    createdAt: asDate(raw.createdAt),
    updatedAt: asDate(raw.updatedAt ?? raw.createdAt),
  };
}

async function queryRows(sql: Prisma.Sql): Promise<PhotoAnalysisRow[]> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(sql);
  return rows.map(mapRow);
}

export function toPublic(row: PhotoAnalysisRow): PhotoAnalysisPublic {
  return {
    id: row.id,
    photoHash: row.photoHash,
    status: row.status,
    gate: parseStylePhotoPreflight(row.gate),
    result: parseStylePhotoAnalysis(row.result),
    userReview: parseStyleUserReview(row.userReview),
    verdict: parseStylistVerdict(row.verdict),
    verdictStatus: row.verdictStatus,
    verdictError: publicPhotoError(row.verdictError),
    verdictMs: row.verdictMs,
    verdictModel: row.verdictModel,
    error: publicPhotoError(row.error),
    ms: row.ms,
    model: row.model,
    engineVersion: row.engineVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findLatestAnalysis(userId: string) {
  const rows = await queryRows(Prisma.sql`
    SELECT
      id, "photoHash", status, gate, result, "userReview",
      verdict, "verdictStatus", "verdictError", "verdictMs", "verdictModel",
      error, ms, model, "engineVersion", "createdAt", "updatedAt"
    FROM "PhotoAnalysis"
    WHERE "userId" = ${userId}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function findByHash(userId: string, photoHash: string) {
  const rows = await queryRows(Prisma.sql`
    SELECT
      id, "photoHash", status, gate, result, "userReview",
      verdict, "verdictStatus", "verdictError", "verdictMs", "verdictModel",
      error, ms, model, "engineVersion", "createdAt", "updatedAt"
    FROM "PhotoAnalysis"
    WHERE "userId" = ${userId} AND "photoHash" = ${photoHash}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

/** Insert a PhotoAnalysis row if missing. Never wipes an existing analysis. */
export async function ensureVerdictAnchor(userId: string, photoHash: string) {
  const rows = await queryRows(Prisma.sql`
    INSERT INTO "PhotoAnalysis" (
      id, "userId", "photoHash", status, "verdictStatus", "engineVersion", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${userId}, ${photoHash}, 'done', 'idle',
      ${PHOTO_ANALYSIS_ENGINE_VERSION}, NOW()
    )
    ON CONFLICT ("userId", "photoHash") DO UPDATE SET
      "updatedAt" = "PhotoAnalysis"."updatedAt"
    RETURNING
      id, "photoHash", status, gate, result, "userReview",
      verdict, "verdictStatus", "verdictError", "verdictMs", "verdictModel",
      error, ms, model, "engineVersion", "createdAt", "updatedAt"
  `);
  const row = rows[0];
  if (!row) throw new Error("PhotoAnalysis anchor returned no row.");
  return row;
}

export async function upsertRunning(userId: string, photoHash: string) {
  const rows = await queryRows(Prisma.sql`
    INSERT INTO "PhotoAnalysis" (
      id, "userId", "photoHash", status, "verdictStatus", "engineVersion", "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${userId}, ${photoHash}, 'running', 'idle',
      ${PHOTO_ANALYSIS_ENGINE_VERSION}, NOW()
    )
    ON CONFLICT ("userId", "photoHash") DO UPDATE SET
      status = 'running',
      gate = NULL,
      result = NULL,
      "userReview" = NULL,
      verdict = NULL,
      "verdictStatus" = 'idle',
      "verdictError" = NULL,
      "verdictMs" = NULL,
      "verdictModel" = NULL,
      "verdictTokens" = NULL,
      error = NULL,
      ms = NULL,
      model = NULL,
      "engineVersion" = EXCLUDED."engineVersion",
      "updatedAt" = NOW()
    RETURNING
      id, "photoHash", status, gate, result, "userReview",
      verdict, "verdictStatus", "verdictError", "verdictMs", "verdictModel",
      error, ms, model, "engineVersion", "createdAt", "updatedAt"
  `);
  const row = rows[0];
  if (!row) throw new Error("PhotoAnalysis upsert returned no row.");
  return row;
}

/** If after() died mid-analysis, surface a timeout instead of polling forever. */
export async function expireStaleRunningAnalysis(
  row: PhotoAnalysisRow,
): Promise<PhotoAnalysisRow> {
  if (row.status !== "running") return row;
  const age = Date.now() - row.updatedAt.getTime();
  if (age < ANALYSIS_STALE_MS) return row;
  await saveError(row.id, PHOTO_ERROR.timeout, age, row.model);
  return {
    ...row,
    status: "done",
    error: PHOTO_ERROR.timeout,
    ms: age,
    updatedAt: new Date(),
  };
}

/** If after() died mid-verdict, surface a timeout instead of polling forever. */
export async function expireStaleRunningVerdict(
  row: PhotoAnalysisRow,
): Promise<PhotoAnalysisRow> {
  if (row.verdictStatus !== "running") return row;
  const age = Date.now() - row.updatedAt.getTime();
  if (age < VERDICT_STALE_MS) return row;
  await saveVerdictError(row.id, PHOTO_ERROR.timeout, age, row.verdictModel);
  return {
    ...row,
    verdictStatus: "done",
    verdictError: PHOTO_ERROR.timeout,
    verdictMs: age,
    updatedAt: new Date(),
  };
}

export async function saveGate(opts: {
  id: string;
  gate: StylePhotoPreflight;
  ms: number;
  model: string;
}) {
  await prisma.$executeRaw`
    UPDATE "PhotoAnalysis" SET
      gate = ${jsonSql(opts.gate)},
      status = 'running',
      error = NULL,
      ms = ${opts.ms},
      model = ${opts.model},
      "updatedAt" = NOW()
    WHERE id = ${opts.id}
  `;
}

export async function saveOutcome(opts: {
  id: string;
  gate?: StylePhotoPreflight;
  result: StylePhotoAnalysis | null;
  ms: number;
  model: string;
  keepGate?: boolean;
}) {
  if (opts.keepGate) {
    await prisma.$executeRaw`
      UPDATE "PhotoAnalysis" SET
        status = 'done',
        result = ${jsonSql(opts.result)},
        error = NULL,
        ms = ${opts.ms},
        model = ${opts.model},
        "updatedAt" = NOW()
      WHERE id = ${opts.id}
    `;
    return;
  }
  await prisma.$executeRaw`
    UPDATE "PhotoAnalysis" SET
      status = 'done',
      gate = ${jsonSql(opts.gate ?? null)},
      result = ${jsonSql(opts.result)},
      error = NULL,
      ms = ${opts.ms},
      model = ${opts.model},
      "updatedAt" = NOW()
    WHERE id = ${opts.id}
  `;
}

export async function saveReview(id: string, review: StyleUserReview) {
  await prisma.$executeRaw`
    UPDATE "PhotoAnalysis" SET
      "userReview" = ${jsonSql(review)},
      verdict = CASE
        WHEN "verdictStatus" = 'running' THEN verdict
        ELSE NULL
      END,
      "verdictStatus" = CASE
        WHEN "verdictStatus" = 'running' THEN 'running'
        ELSE 'idle'
      END,
      "verdictError" = CASE
        WHEN "verdictStatus" = 'running' THEN "verdictError"
        ELSE NULL
      END,
      "verdictMs" = CASE
        WHEN "verdictStatus" = 'running' THEN "verdictMs"
        ELSE NULL
      END,
      "verdictModel" = CASE
        WHEN "verdictStatus" = 'running' THEN "verdictModel"
        ELSE NULL
      END,
      "verdictTokens" = CASE
        WHEN "verdictStatus" = 'running' THEN "verdictTokens"
        ELSE NULL
      END,
      "updatedAt" = NOW()
    WHERE id = ${id}
  `;
}

export async function saveVerdictRunning(id: string) {
  await prisma.$executeRaw`
    UPDATE "PhotoAnalysis" SET
      "verdictStatus" = 'running',
      "verdictError" = NULL,
      "updatedAt" = NOW()
    WHERE id = ${id}
  `;
}

export async function saveVerdict(
  id: string,
  verdict: StylistVerdict,
  ms: number,
  model: string,
  tokens?: PhotoUsageTokens | null,
) {
  await prisma.$executeRaw`
    UPDATE "PhotoAnalysis" SET
      "verdictStatus" = 'done',
      verdict = ${jsonSql(verdict)},
      "verdictError" = NULL,
      "verdictMs" = ${ms},
      "verdictModel" = ${model},
      "verdictTokens" = ${jsonSql(tokens ?? null)},
      "updatedAt" = NOW()
    WHERE id = ${id}
  `;
}

export async function saveVerdictError(
  id: string,
  message: string,
  ms: number,
  model: string | null,
) {
  const error = publicPhotoError(message) ?? PHOTO_ERROR.failed;
  await prisma.$executeRaw`
    UPDATE "PhotoAnalysis" SET
      "verdictStatus" = 'done',
      verdict = NULL,
      "verdictError" = ${error},
      "verdictMs" = ${ms},
      "verdictModel" = ${model},
      "verdictTokens" = NULL,
      "updatedAt" = NOW()
    WHERE id = ${id}
  `;
}

export async function saveError(
  id: string,
  message: string,
  ms: number,
  model: string | null,
) {
  const error = publicPhotoError(message) ?? PHOTO_ERROR.failed;
  await prisma.$executeRaw`
    UPDATE "PhotoAnalysis" SET
      status = 'done',
      result = NULL,
      error = ${error},
      ms = ${ms},
      model = ${model},
      "updatedAt" = NOW()
    WHERE id = ${id}
  `;
}
