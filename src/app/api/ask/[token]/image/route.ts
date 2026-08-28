import { loadShareByToken } from "@/lib/ask/create-share";
import { resolveAskShareImageSrc } from "@/lib/ask/ask-image";
import { respondWithSignedImageSrc } from "@/lib/tryon/signed-image-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function respondWithSrc(src: string) {
  return respondWithSignedImageSrc(src, "public, max-age=300");
}

/**
 * Public look photo for Ask cards (friends + owner + OG).
 * Re-signs private try-on storage — never depend on expired signed URLs in DB.
 * `?side=alt` serves the challenger look on comparative shares.
 */
export async function GET(
  req: Request,
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

  const side = new URL(req.url).searchParams.get("side");
  const wantAlt = side === "alt" || side === "b";
  if (wantAlt) {
    const altUrl = share.altImageUrl?.trim();
    if (!altUrl) {
      return Response.json({ error: "Image unavailable." }, { status: 404 });
    }
    const src = await resolveAskShareImageSrc({
      token: share.token,
      ownerUserId: share.ownerUserId,
      generationId: share.altGenerationId,
      imageUrl: altUrl,
    });
    if (!src) {
      return Response.json({ error: "Image unavailable." }, { status: 404 });
    }
    return respondWithSrc(src);
  }

  const src = await resolveAskShareImageSrc(share);
  if (!src) {
    return Response.json({ error: "Image unavailable." }, { status: 404 });
  }
  return respondWithSrc(src);
}
