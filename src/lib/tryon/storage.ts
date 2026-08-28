import { getSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { TRYON_PRIVATE_BUCKET } from "./config";

export type TryonStorageMode = "memory" | "supabase";

const memoryStore = new Map<string, Uint8Array>();

let storageMode: TryonStorageMode =
  process.env.NODE_ENV === "test" ? "memory" : "supabase";

export function setTryonStorageMode(mode: TryonStorageMode): void {
  storageMode = mode;
  memoryStore.clear();
}

export function clearTryonMemoryStorage(): void {
  memoryStore.clear();
}

function storagePath(userId: string, personId: string, kind: string, name: string) {
  return `${userId}/${personId}/${kind}/${name}`;
}

let bucketEnsured = false;

/** Create private try-on bucket on first use (idempotent). */
export async function ensureTryonBucket(): Promise<void> {
  if (storageMode === "memory" || bucketEnsured) return;

  const client = getSupabaseAdminClient();
  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) {
    throw new Error(`tryon bucket list failed: ${listError.message}`);
  }
  if (buckets?.some((b) => b.name === TRYON_PRIVATE_BUCKET)) {
    bucketEnsured = true;
    return;
  }

  const { error: createError } = await client.storage.createBucket(
    TRYON_PRIVATE_BUCKET,
    {
      public: false,
      fileSizeLimit: 15 * 1024 * 1024,
    },
  );
  if (
    createError &&
    !/already exists|duplicate/i.test(createError.message)
  ) {
    throw new Error(`tryon bucket setup failed: ${createError.message}`);
  }
  bucketEnsured = true;
}

export function resetTryonBucketEnsuredForTests(): void {
  bucketEnsured = false;
}

const STORAGE_RETRY_DELAYS_MS = [400, 1200, 2800];

export function isTransientTryonStorageError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|network|econnreset|etimedout|econnrefused|socket|und_err|other side closed|hang up|\b(429|502|503|504)\b/i.test(
    msg,
  );
}

async function withTryonStorageRetries<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= STORAGE_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (
        attempt >= STORAGE_RETRY_DELAYS_MS.length ||
        !isTransientTryonStorageError(err)
      ) {
        throw err;
      }
      await new Promise((r) =>
        setTimeout(r, STORAGE_RETRY_DELAYS_MS[attempt]),
      );
    }
  }
  throw last;
}

export async function uploadPrivateObject(params: {
  userId: string;
  personId: string;
  kind: "source-photo" | "avatar" | "tryon";
  filename: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<{ path: string }> {
  const path = storagePath(
    params.userId,
    params.personId,
    params.kind,
    params.filename,
  );
  if (storageMode === "memory") {
    memoryStore.set(path, params.bytes);
    return { path };
  }
  return withTryonStorageRetries(async () => {
    await ensureTryonBucket();
    const client = getSupabaseAdminClient();
    const { error } = await client.storage
      .from(TRYON_PRIVATE_BUCKET)
      .upload(path, params.bytes, {
        contentType: params.contentType,
        upsert: true,
      });
    if (error) throw new Error(`tryon upload failed: ${error.message}`);
    return { path };
  });
}

export async function createSignedUrl(
  path: string,
  expiresInSeconds = 3600,
): Promise<string> {
  if (storageMode === "memory") {
    const bytes = memoryStore.get(path);
    if (!bytes) throw new Error(`memory object missing: ${path}`);
    const b64 = Buffer.from(bytes).toString("base64");
    return `data:image/jpeg;base64,${b64}`;
  }
  return withTryonStorageRetries(async () => {
    await ensureTryonBucket();
    const client = getSupabaseAdminClient();
    const { data, error } = await client.storage
      .from(TRYON_PRIVATE_BUCKET)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? "signed url failed");
    }
    return data.signedUrl;
  });
}

/**
 * Recover the private object path from a (possibly expired) signed URL.
 * createSignedUrl needs `userId/personId/tryon/file.jpg` — not the bucket prefix.
 */
export function tryonPathFromStoredUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const u = new URL(url);
    const signMarker = `/object/sign/${TRYON_PRIVATE_BUCKET}/`;
    const publicMarker = `/object/public/${TRYON_PRIVATE_BUCKET}/`;
    for (const marker of [signMarker, publicMarker]) {
      const idx = u.pathname.indexOf(marker);
      if (idx >= 0) {
        return decodeURIComponent(u.pathname.slice(idx + marker.length));
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Fresh signed URL from outputPath, or by recovering the path from a stale outputUrl. */
export async function resolveFreshTryonImageUrl(params: {
  outputPath?: string | null;
  outputUrl?: string | null;
  expiresInSeconds?: number;
}): Promise<string | null> {
  const path =
    params.outputPath?.trim() ||
    tryonPathFromStoredUrl(params.outputUrl) ||
    null;
  if (!path) return null;
  try {
    return await createSignedUrl(
      path,
      params.expiresInSeconds ?? 60 * 60,
    );
  } catch {
    return null;
  }
}

export async function deletePrivateObjects(paths: string[]): Promise<void> {
  if (!paths.length) return;
  if (storageMode === "memory") {
    for (const p of paths) memoryStore.delete(p);
    return;
  }
  const client = getSupabaseAdminClient();
  const { error } = await client.storage
    .from(TRYON_PRIVATE_BUCKET)
    .remove(paths);
  if (error) throw new Error(`tryon delete failed: ${error.message}`);
}

export async function listPersonStoragePaths(
  userId: string,
  personId: string,
): Promise<string[]> {
  if (storageMode === "memory") {
    const prefix = `${userId}/${personId}/`;
    return [...memoryStore.keys()].filter((k) => k.startsWith(prefix));
  }
  const client = getSupabaseAdminClient();
  const prefixes = ["source-photo", "avatar", "tryon"] as const;
  const out: string[] = [];
  for (const kind of prefixes) {
    const folder = `${userId}/${personId}/${kind}`;
    const { data, error } = await client.storage
      .from(TRYON_PRIVATE_BUCKET)
      .list(folder, { limit: 500 });
    if (error) continue;
    for (const item of data ?? []) {
      if (item.name) out.push(`${folder}/${item.name}`);
    }
  }
  return out;
}

export async function persistProviderImage(params: {
  userId: string;
  personId: string;
  kind: "avatar" | "tryon";
  filename: string;
  imageUrl: string;
  imageBytes?: Uint8Array;
  contentType?: string;
}): Promise<{ path: string; signedUrl: string; contentType: string }> {
  let bytes = params.imageBytes;
  let contentType = params.contentType ?? "image/jpeg";
  if (!bytes) {
    if (params.imageUrl.startsWith("data:")) {
      const match = params.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error("invalid data url");
      contentType = match[1];
      bytes = Uint8Array.from(Buffer.from(match[2], "base64"));
    } else {
      const downloaded = await withTryonStorageRetries(async () => {
        const res = await fetch(params.imageUrl);
        if (!res.ok) throw new Error(`fetch provider image ${res.status}`);
        const buf = await res.arrayBuffer();
        return {
          bytes: new Uint8Array(buf),
          contentType: res.headers.get("content-type") ?? contentType,
        };
      });
      bytes = downloaded.bytes;
      contentType = downloaded.contentType;
    }
  }
  const { path } = await uploadPrivateObject({
    userId: params.userId,
    personId: params.personId,
    kind: params.kind,
    filename: params.filename,
    bytes,
    contentType,
  });
  const signedUrl = await createSignedUrl(path);
  return { path, signedUrl, contentType };
}
