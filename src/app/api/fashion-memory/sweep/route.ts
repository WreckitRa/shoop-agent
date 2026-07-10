import { z } from "zod";
import { sweepFashionExtractionForConversation } from "@/lib/fashion-memory/extraction/sweep";
import { spawnDetachedFashionExtractionSweep } from "@/lib/fashion-memory/extraction/spawn";
import { getAuthContext } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  /** When true, respond immediately and run extraction detached (next-visit sweep). */
  idle: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }

    const { conversationId, idle } = parsed.data;

    if (idle) {
      spawnDetachedFashionExtractionSweep({
        userId: auth.userId,
        conversationId,
      });
      return Response.json({ ok: true, detached: true });
    }

    const result = await sweepFashionExtractionForConversation({
      userId: auth.userId,
      conversationId,
    });

    return Response.json({ ok: true, ...result });
  } catch {
    return Response.json({ error: "Sweep failed." }, { status: 500 });
  }
}
