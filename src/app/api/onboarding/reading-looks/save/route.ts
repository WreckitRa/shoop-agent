import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/ai-chat/db";
import { saveTryonFeedback } from "@/lib/tryon/generations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  jobIds: z.array(z.string().min(1).max(80)).max(8),
});

export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (auth.isGuest) {
    return Response.json(
      { error: "Sign in to save looks to your moodboard." },
      { status: 401 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const unique = [...new Set(parsed.data.jobIds)];
  const owned = await prisma.tryonGeneration.findMany({
    where: {
      id: { in: unique },
      userId: auth.userId,
      status: "completed",
    },
    select: { id: true },
  });

  for (const row of owned) {
    await saveTryonFeedback({
      generationId: row.id,
      userId: auth.userId,
      rating: 1,
    });
  }

  return Response.json({ ok: true, saved: owned.length });
}
