import { getAuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/ai-chat/db";
import { resolveFreshTryonImageUrl } from "@/lib/tryon/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin try-on image for moodboard / home tiles.
 * Re-signs private storage, then redirects so the browser loads a fresh token
 * (stored outputUrl tokens expire in ~1h and break <img> tags).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ generationId: string }> },
) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (auth.isGuest) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const { generationId } = await ctx.params;
  if (!generationId?.trim()) {
    return Response.json({ error: "Missing generation." }, { status: 400 });
  }

  const gen = await prisma.tryonGeneration.findFirst({
    where: {
      id: generationId,
      userId: auth.userId,
      status: "completed",
    },
    select: { outputPath: true, outputUrl: true },
  });
  if (!gen) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const signed = await resolveFreshTryonImageUrl({
    outputPath: gen.outputPath,
    outputUrl: gen.outputUrl,
    expiresInSeconds: 60 * 60,
  });
  if (!signed) {
    return Response.json({ error: "Image unavailable." }, { status: 404 });
  }

  if (signed.startsWith("data:")) {
    const match = signed.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return Response.json({ error: "Image unavailable." }, { status: 404 });
    }
    return new Response(Buffer.from(match[2], "base64"), {
      status: 200,
      headers: {
        "Content-Type": match[1] || "image/jpeg",
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  return Response.redirect(signed, 302);
}
