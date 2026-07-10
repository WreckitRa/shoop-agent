import { getAuthContext } from "@/lib/auth/session";
import { extractFashionMemoryFromTurn } from "@/lib/fashion-memory/extraction/llm-extract";
import type { FashionExtractionContext } from "@/lib/fashion-memory/extraction/assemble-context";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  context: z.object({
    roster: z.string(),
    snapshots: z.string(),
    messages: z.string(),
    currentDate: z.string(),
    personShortIds: z.record(z.string(), z.string()),
  }),
});

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }

    const result = await extractFashionMemoryFromTurn({
      context: parsed.data.context as FashionExtractionContext,
      signal: req.signal,
    });

    return Response.json(result);
  } catch {
    return Response.json({ error: "Extraction failed." }, { status: 500 });
  }
}
