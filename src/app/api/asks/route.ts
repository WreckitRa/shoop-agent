import { getAuthContext } from "@/lib/auth/session";
import {
  listSharesForOwner,
  ownerVoterKey,
} from "@/lib/ask/owner-vote";
import { buildLookAskPublic } from "@/lib/ask/public-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner-only: all Ask-your-friends shares with votes + notes. */
export async function GET() {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;

  const rows = await listSharesForOwner({ ownerUserId: auth.userId });
  const voterKey = ownerVoterKey(auth.userId);

  const shares = rows.map((share) =>
    buildLookAskPublic({
      share,
      viewerUserId: auth.userId,
      viewerVoterKey: voterKey,
    }),
  );

  return Response.json({ ok: true, shares });
}
