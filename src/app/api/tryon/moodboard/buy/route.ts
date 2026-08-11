import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { resolveMoodboardCheckoutLines } from "@/lib/tryon/moodboard-buy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    generationId: z.string().min(1).max(80),
  })
  .strict();

/** Resolve checkout-ready lines for a loved try-on (client adds to cart). */
export async function POST(req: Request) {
  const auth = await getAuthContext();
  if (!auth.ok) return auth.response;
  if (auth.isGuest) {
    return Response.json(
      { error: "Sign in to buy from your moodboard." },
      { status: 401 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const { lines, skipped } = await resolveMoodboardCheckoutLines({
      userId: auth.userId,
      generationId: parsed.data.generationId,
    });
    if (!lines.length) {
      return Response.json(
        {
          error:
            skipped > 0
              ? "Those pieces aren't available to buy right now."
              : "No buyable products on this look yet.",
          lines: [],
          skipped,
        },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, lines, skipped });
  } catch {
    return Response.json(
      { error: "Couldn't prepare checkout for this look." },
      { status: 500 },
    );
  }
}
