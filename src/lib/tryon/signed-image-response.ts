/** Serve a data-URI or redirect to an absolute http(s) image. Never throw. */

function dataUriResponse(src: string, cacheControl: string): Response | null {
  if (!src.startsWith("data:")) return null;
  const match = src.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return new Response(Buffer.from(match[2], "base64"), {
    status: 200,
    headers: {
      "Content-Type": match[1] || "image/jpeg",
      "Cache-Control": cacheControl,
    },
  });
}

export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const UNAVAILABLE = Response.json(
  { error: "Image unavailable." },
  { status: 404 },
);

/**
 * Browser <img> follow this; a relative/invalid Location would 404 the
 * whole document if the request is treated as a navigation.
 */
export function respondWithSignedImageSrc(
  src: string,
  cacheControl = "private, max-age=60",
): Response {
  const data = dataUriResponse(src, cacheControl);
  if (data) return data;
  if (!isAbsoluteHttpUrl(src)) return UNAVAILABLE;
  try {
    return Response.redirect(src, 302);
  } catch {
    return UNAVAILABLE;
  }
}
