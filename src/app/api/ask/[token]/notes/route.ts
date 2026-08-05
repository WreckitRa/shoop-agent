import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/ai-chat/db";
import { loadShareByToken } from "@/lib/ask/create-share";
import { buildLookAskPublic } from "@/lib/ask/public-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const bodySchema = z
  .object({
    body: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(40),
    voterKey: z.string().trim().min(3).max(120),
  })
  .strict();

export async function POST(req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!token || token.length > 32) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const share = await loadShareByToken(token);
  if (!share) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid note.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const auth = await getAuthContext();
  const viewerUserId = auth.ok ? auth.userId : null;
  const voterKey =
    viewerUserId ? `user:${viewerUserId}` : parsed.data.voterKey;

  const hasVoted = share.votes.some((v) => v.voterKey === voterKey);
  const isOwner = viewerUserId === share.ownerUserId;
  if (!hasVoted && !isOwner) {
    return Response.json(
      { error: "Vote before leaving a note." },
      { status: 403 },
    );
  }

  await prisma.lookAskNote.create({
    data: {
      shareId: share.id,
      voterKey,
      displayName: parsed.data.displayName.slice(0, 40),
      userId: viewerUserId,
      body: parsed.data.body.slice(0, 120),
    },
  });

  const fresh = await loadShareByToken(token);
  if (!fresh) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  return Response.json({
    ok: true,
    share: buildLookAskPublic({
      share: fresh,
      viewerUserId,
      viewerVoterKey: voterKey,
    }),
  });
}
