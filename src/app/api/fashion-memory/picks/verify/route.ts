import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { handleFashionPickAction } from "@/lib/fashion-memory/curation/picks-route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  messageId: z.string().min(1),
  ref: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }
    return handleFashionPickAction("verify", parsed.data, auth.userId);
  } catch {
    return Response.json({ error: "Verify failed." }, { status: 500 });
  }
}
