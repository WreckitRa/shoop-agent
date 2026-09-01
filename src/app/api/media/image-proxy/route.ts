import { getAuthContext } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;

export function isAllowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host.endsWith(".supabase.co") ||
    host.endsWith(".supabase.in") ||
    // FASHN outputs: cdn.fashn.ai today, media.fashn.ai from 2026-09-02.
    host.endsWith(".fashn.ai") ||
    host === "fashn.ai" ||
    host.endsWith(".amazonaws.com") ||
    host.endsWith(".cloudfront.net")
  );
}

/**
 * Same-origin image fetch for client-side background removal (CORS bypass).
 * Only proxies allowlisted storage/CDN hosts for authenticated users.
 */
export async function GET(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const raw = new URL(req.url).searchParams.get("url")?.trim();
  if (!raw) {
    return Response.json({ error: "Missing url." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return Response.json({ error: "Invalid url." }, { status: 400 });
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return Response.json({ error: "Unsupported protocol." }, { status: 400 });
  }
  if (!isAllowedImageHost(target.hostname)) {
    return Response.json({ error: "Host not allowed." }, { status: 403 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      cache: "force-cache",
      headers: { Accept: "image/*,*/*" },
    });
    if (!upstream.ok) {
      return Response.json(
        { error: `Upstream ${upstream.status}` },
        { status: 502 },
      );
    }

    const type = upstream.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/") && type !== "application/octet-stream") {
      return Response.json({ error: "Not an image." }, { status: 415 });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      return Response.json({ error: "Image too large." }, { status: 413 });
    }

    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": type.startsWith("image/") ? type : "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return Response.json({ error: "Proxy failed." }, { status: 502 });
  }
}
