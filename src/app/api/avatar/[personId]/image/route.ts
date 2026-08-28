import { getAuthContext } from "@/lib/auth/session";
import { requireAvatarOwner } from "@/lib/tryon/avatar/request-auth";
import { getStoredAvatar } from "@/lib/tryon/avatar/service";
import { createSignedUrl } from "@/lib/tryon/storage";
import { respondWithSignedImageSrc } from "@/lib/tryon/signed-image-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin twin image for the home Mirror.
 * Re-signs private storage so <img> tags keep working after the JSON token expires.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ personId: string }> },
) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const owner = await requireAvatarOwner(req, auth, { photoGate: false });
  if (!owner.ok) return owner.response;

  const { personId } = await ctx.params;
  if (!personId?.trim()) {
    return Response.json({ error: "Missing person." }, { status: 400 });
  }

  const avatar = await getStoredAvatar(owner.userId, personId);
  if (!avatar) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  let src = avatar.url?.trim() || "";
  if (avatar.storage_path) {
    try {
      src = await createSignedUrl(avatar.storage_path);
    } catch {
      /* keep stored url */
    }
  }
  if (!src) {
    return Response.json({ error: "Image unavailable." }, { status: 404 });
  }

  return respondWithSignedImageSrc(src, "private, max-age=60");
}
