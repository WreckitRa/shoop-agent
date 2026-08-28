import { getAuthContext } from "@/lib/auth/session";
import { fashionOwnerUserId } from "@/lib/fashion-memory/auth";
import { purgePersonTryonData } from "@/lib/tryon/delete";
import { getStoredAvatar } from "@/lib/tryon/avatar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ personId: string }> },
) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const ownerId = fashionOwnerUserId(auth.userId);
  if (!ownerId) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const { personId } = await ctx.params;
  const avatar = await getStoredAvatar(ownerId, personId);
  return Response.json({ avatar });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ personId: string }> },
) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  const ownerId = fashionOwnerUserId(auth.userId);
  if (!ownerId) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const { personId } = await ctx.params;
  try {
    await purgePersonTryonData({ userId: ownerId, personId });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
