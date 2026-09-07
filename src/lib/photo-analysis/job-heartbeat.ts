import { prisma } from "@/lib/ai-chat/db";

const PHOTO_JOB_HEARTBEAT_MS = 15_000;

async function touchPhotoJob(
  id: string,
  kind: "analysis" | "verdict",
): Promise<void> {
  if (kind === "verdict") {
    await prisma.$executeRaw`
      UPDATE "PhotoAnalysis" SET "updatedAt" = NOW()
      WHERE id = ${id} AND "verdictStatus" = 'running'
    `;
    return;
  }
  await prisma.$executeRaw`
    UPDATE "PhotoAnalysis" SET "updatedAt" = NOW()
    WHERE id = ${id} AND status = 'running'
  `;
}

/** Keep updatedAt fresh while the job is actually running so GET can detect a dead after(). */
export function startPhotoJobHeartbeat(
  id: string,
  kind: "analysis" | "verdict",
): () => void {
  const tick = () => {
    void touchPhotoJob(id, kind);
  };
  tick();
  const timer = setInterval(tick, PHOTO_JOB_HEARTBEAT_MS);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}
