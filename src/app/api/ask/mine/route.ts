import { getAuthContext } from "@/lib/auth/session";
import {
  loadShareByGenerationForOwner,
  ownerVoterKey,
} from "@/lib/ask/owner-vote";
import { buildLookAskPublic } from "@/lib/ask/public-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only: resolve an Ask share for a try-on generation so the changing-room
 * strip can hydrate / sync the owner's vote.
 */
export async function GET(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const generationId =
    new URL(req.url).searchParams.get("generationId")?.trim() || "";
  if (!generationId || generationId.length > 80) {
    return Response.json({ error: "generationId required." }, { status: 400 });
  }

  const share = await loadShareByGenerationForOwner({
    ownerUserId: auth.userId,
    generationId,
  });
  if (!share) {
    return Response.json({ ok: true, share: null });
  }

  const voterKey = ownerVoterKey(auth.userId);
  return Response.json({
    ok: true,
    share: buildLookAskPublic({
      share,
      viewerUserId: auth.userId,
      viewerVoterKey: voterKey,
    }),
  });
}
