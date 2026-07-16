/**
 * Try-on avatar storage contract.
 *
 * FASHN dress (`model_image`) accepts a raster image as HTTPS URL or base64
 * (`data:image/<type>;base64,...`). There is no FASHN "model handle", mesh, or
 * prediction ID that try-on can reuse — face-to-model output is already the
 * try-on-ready artifact (still a flat image).
 *
 * Best practice (FASHN preprocessing guide): JPEG, ≤2000px longest edge for 1k try-on.
 * We persist the provider output as-is with correct MIME/extension so dress APIs
 * receive accurate content types.
 */

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function extensionForImageContentType(contentType: string): string {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "image/jpeg";
  return MIME_TO_EXT[normalized] ?? "jpg";
}

export function contentTypeFromStoragePath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export function resolveAvatarContentType(
  contentType: string | undefined,
  storagePath: string,
): string {
  if (contentType?.startsWith("image/")) {
    return contentType.split(";")[0]!.trim().toLowerCase();
  }
  return contentTypeFromStoragePath(storagePath);
}

export function avatarPreviewFilename(
  providerKey: string,
  contentType: string,
): string {
  const ext = extensionForImageContentType(contentType);
  return `preview-${providerKey}-${Date.now()}.${ext}`;
}
