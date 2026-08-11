import { loadShareByToken } from "@/lib/ask/create-share";
import { resolveAskShareImageSrc } from "@/lib/ask/ask-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public look photo for Ask cards (friends + owner + OG).
 * Re-signs private try-on storage — never depend on expired signed URLs in DB.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!token?.trim() || token.length > 32) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const share = await loadShareByToken(token.trim());
  if (!share) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const src = await resolveAskShareImageSrc(share);
  if (!src) {
    return Response.json({ error: "Image unavailable." }, { status: 404 });
  }

  if (src.startsWith("data:")) {
    const match = src.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return Response.json({ error: "Image unavailable." }, { status: 404 });
    }
    return new Response(Buffer.from(match[2], "base64"), {
      status: 200,
      headers: {
        "Content-Type": match[1] || "image/jpeg",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  return Response.redirect(src, 302);
}
