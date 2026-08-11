import { prisma } from "@/lib/ai-chat/db";
import {
  createSignedUrl,
  resolveFreshTryonImageUrl,
  tryonPathFromStoredUrl,
} from "@/lib/tryon/storage";

/** Same-origin ask look image — re-signs private try-on storage (never store signed URLs). */
export function publicAskImagePath(token: string): string {
  const t = token.trim();
  return `/api/ask/${encodeURIComponent(t)}/image`;
}

function storagePathFromShareImageUrl(imageUrl: string): string | null {
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("path:")) {
    const path = trimmed.slice("path:".length).trim();
    return path || null;
  }
  if (trimmed.startsWith("/api/ask/")) return null;
  return tryonPathFromStoredUrl(trimmed);
}

/**
 * Fresh image URL for an Ask share (signed private storage or null).
 * Used by `/api/ask/[token]/image` and OG fetch.
 */
export async function resolveAskShareImageSrc(share: {
  token: string;
  ownerUserId: string;
  generationId: string | null;
  imageUrl: string;
}): Promise<string | null> {
  if (share.generationId?.trim()) {
    const gen = await prisma.tryonGeneration.findFirst({
      where: {
        id: share.generationId.trim(),
        userId: share.ownerUserId,
        status: "completed",
      },
      select: { outputPath: true, outputUrl: true },
    });
    if (gen) {
      const fromGen = await resolveFreshTryonImageUrl({
        outputPath: gen.outputPath,
        outputUrl: gen.outputUrl,
        expiresInSeconds: 60 * 60,
      });
      if (fromGen) return fromGen;
    }
  }

  const path = storagePathFromShareImageUrl(share.imageUrl);
  if (path) {
    try {
      return await createSignedUrl(path, 60 * 60);
    } catch {
      /* fall through */
    }
  }

  // Legacy absolute CDN / signed URL — may still work briefly.
  if (/^https?:\/\//i.test(share.imageUrl.trim())) {
    return share.imageUrl.trim();
  }

  return null;
}

/** Persistable image field: prefer private path so we can re-sign later. */
export async function durableAskImageStorageRef(params: {
  userId: string;
  generationId?: string | null;
  fallbackImageUrl: string;
}): Promise<string> {
  const generationId = params.generationId?.trim();
  if (generationId) {
    const gen = await prisma.tryonGeneration.findFirst({
      where: {
        id: generationId,
        userId: params.userId,
        status: "completed",
      },
      select: { outputPath: true, outputUrl: true },
    });
    if (gen?.outputPath?.trim()) {
      return `path:${gen.outputPath.trim()}`;
    }
    const recovered = tryonPathFromStoredUrl(gen?.outputUrl);
    if (recovered) return `path:${recovered}`;
  }

  const fromFallback = tryonPathFromStoredUrl(params.fallbackImageUrl);
  if (fromFallback) return `path:${fromFallback}`;

  // Last resort: keep URL (may expire) — resolveAskShareImageSrc still tries it.
  return params.fallbackImageUrl.trim();
}
