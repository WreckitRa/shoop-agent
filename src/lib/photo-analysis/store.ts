import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/ai-chat/db";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import {
  PHOTO_ANALYSIS_ENGINE_VERSION,
  type PhotoAnalysisPublic,
  type PhotoProfile,
} from "./types";
import { isPhotoProfile } from "./schema";
import { PHOTO_ERROR, publicPhotoError } from "./errors";

export type AnalysisStatus = "pending" | "ready" | "error";
export type RowStatus = "running" | "done";

function asProfile(value: unknown): PhotoProfile | null {
  return isPhotoProfile(value) ? value : null;
}

export function toPublic(row: {
  id: string;
  status: string;
  specStatus: string;
  gptStatus: string;
  specResult: unknown;
  gptResult: unknown;
  specError: string | null;
  gptError: string | null;
  specMs: number | null;
  gptMs: number | null;
  gptModel: string | null;
  engineVersion: string;
  createdAt: Date;
}): PhotoAnalysisPublic {
  return {
    id: row.id,
    status: row.status,
    specStatus: row.specStatus,
    gptStatus: row.gptStatus,
    specResult: asProfile(row.specResult),
    gptResult: asProfile(row.gptResult),
    specError: publicPhotoError(row.specError),
    gptError: publicPhotoError(row.gptError),
    specMs: row.specMs,
    gptMs: row.gptMs,
    gptModel: row.gptModel,
    engineVersion: row.engineVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findLatestAnalysis(userId: string) {
  return prisma.photoAnalysis.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function findByHash(userId: string, photoHash: string) {
  return prisma.photoAnalysis.findUnique({
    where: { userId_photoHash: { userId, photoHash } },
  });
}

export async function upsertRunning(userId: string, photoHash: string) {
  return prisma.photoAnalysis.upsert({
    where: { userId_photoHash: { userId, photoHash } },
    create: {
      userId,
      photoHash,
      status: "running",
      specStatus: "pending",
      gptStatus: "pending",
      engineVersion: PHOTO_ANALYSIS_ENGINE_VERSION,
    },
    update: {
      status: "running",
      specStatus: "pending",
      gptStatus: "pending",
      specResult: Prisma.DbNull,
      gptResult: Prisma.DbNull,
      specError: null,
      gptError: null,
      specMs: null,
      gptMs: null,
      gptModel: null,
      engineVersion: PHOTO_ANALYSIS_ENGINE_VERSION,
    },
  });
}

export async function saveSpecResult(
  id: string,
  result: PhotoProfile,
  ms: number,
) {
  await prisma.photoAnalysis.update({
    where: { id },
    data: {
      specStatus: "ready",
      specResult: result as unknown as InputJsonValue,
      specError: null,
      specMs: ms,
    },
  });
}

export async function saveSpecError(id: string, message: string, ms: number) {
  await prisma.photoAnalysis.updateMany({
    where: { id, specStatus: "pending" },
    data: {
      specStatus: "error",
      specError: publicPhotoError(message) ?? PHOTO_ERROR.failed,
      specMs: ms,
    },
  });
}

export async function saveGptResult(
  id: string,
  result: PhotoProfile,
  ms: number,
  model: string,
) {
  await prisma.photoAnalysis.update({
    where: { id },
    data: {
      gptStatus: "ready",
      gptResult: result as unknown as InputJsonValue,
      gptError: null,
      gptMs: ms,
      gptModel: model,
    },
  });
}

export async function saveGptError(
  id: string,
  message: string,
  ms: number,
  model: string | null,
) {
  await prisma.photoAnalysis.updateMany({
    where: { id, gptStatus: "pending" },
    data: {
      gptStatus: "error",
      gptError: publicPhotoError(message) ?? PHOTO_ERROR.failed,
      gptMs: ms,
      gptModel: model,
    },
  });
}

export async function markDone(id: string) {
  const row = await prisma.photoAnalysis.findUnique({ where: { id } });
  if (!row) return;
  const specDone = row.specStatus !== "pending";
  const gptDone = row.gptStatus !== "pending";
  if (!specDone || !gptDone) return;
  await prisma.photoAnalysis.update({
    where: { id },
    data: { status: "done" },
  });
}
