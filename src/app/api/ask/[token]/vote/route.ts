import { z } from "zod";
import { trackProductEvent } from "@/lib/analytics/track";
import { getAuthContext } from "@/lib/auth/session";
import { loadShareByToken } from "@/lib/ask/create-share";
import { upsertOwnerAskVote } from "@/lib/ask/owner-vote";
import { buildLookAskPublic } from "@/lib/ask/public-payload";
import { prisma } from "@/lib/ai-chat/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const bodySchema = z
  .object({
    choice: z.enum(["no", "meh", "almost", "love", "a", "b"]),
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

  const pollMode =
    share.pollMode === "compare" && share.altImageUrl?.trim()
      ? "compare"
      : "rate";
  const allowed =
    pollMode === "compare"
      ? (["a", "b"] as const)
      : (["no", "meh", "almost", "love"] as const);

  const auth = await getAuthContext();
  const viewerUserId = auth.ok ? auth.userId : null;

  // Prefer stable auth-based key when signed in / guest-sessioned.
  const voterKey =
    viewerUserId ? `user:${viewerUserId}` : parsed.data.voterKey;

  const isOwner = Boolean(viewerUserId) && viewerUserId === share.ownerUserId;

  // Owner strip vote — create or change freely; display name is the asker.
  // Rate strip choices map onto a|b when the share is comparative.
  if (isOwner && viewerUserId) {
    let ownerChoice = parsed.data.choice;
    if (pollMode === "compare" && !["a", "b"].includes(ownerChoice)) {
      ownerChoice =
        ownerChoice === "love" || ownerChoice === "almost" ? "a" : "b";
    } else if (!(allowed as readonly string[]).includes(ownerChoice)) {
      return Response.json(
        { error: "That choice isn't on this poll." },
        { status: 400 },
      );
    }
    await upsertOwnerAskVote({
      shareId: share.id,
      ownerUserId: viewerUserId,
      askerName: share.askerName,
      choice: ownerChoice,
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

  if (!(allowed as readonly string[]).includes(parsed.data.choice)) {
    return Response.json(
      { error: "That choice isn't on this poll." },
      { status: 400 },
    );
  }

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

  trackProductEvent({
    name: "friend_vote_received",
    userId: share.ownerUserId,
    props: {
      share_id: share.id,
      token,
      choice: parsed.data.choice,
      voter_user_id: viewerUserId,
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
