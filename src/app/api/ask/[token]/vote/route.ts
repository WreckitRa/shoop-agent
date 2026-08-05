import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/ai-chat/db";
import { loadShareByToken } from "@/lib/ask/create-share";
import { buildLookAskPublic } from "@/lib/ask/public-payload";
import { ASK_VOTE_CHOICES } from "@/lib/ask/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const bodySchema = z
  .object({
    choice: z.enum(ASK_VOTE_CHOICES),
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
      { error: "Invalid vote.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const auth = await getAuthContext();
  const viewerUserId = auth.ok ? auth.userId : null;

  // Prefer stable auth-based key when signed in / guest-sessioned.
  const voterKey =
    viewerUserId ? `user:${viewerUserId}` : parsed.data.voterKey;

  const existing = await prisma.lookAskVote.findUnique({
    where: {
      shareId_voterKey: { shareId: share.id, voterKey },
    },
  });
  if (existing) {
    const fresh = await loadShareByToken(token);
    return Response.json(
      {
        error: "You already voted.",
        share: fresh
          ? buildLookAskPublic({
              share: fresh,
              viewerUserId,
              viewerVoterKey: voterKey,
            })
          : null,
      },
      { status: 409 },
    );
  }

  await prisma.lookAskVote.create({
    data: {
      shareId: share.id,
      voterKey,
      displayName: parsed.data.displayName.slice(0, 40),
      userId: viewerUserId,
      choice: parsed.data.choice,
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
