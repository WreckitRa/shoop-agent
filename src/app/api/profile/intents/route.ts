import { prisma } from "@/lib/ai-chat/db";
import { intentPostSchema } from "@/lib/ai-chat/profile/validators";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import { getAuthContext } from "@/lib/auth/session";

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const rows = await prisma.shoppingIntent.findMany({
      where: {
        userId,
        ...(status === "active" ||
        status === "paused" ||
        status === "completed" ||
        status === "expired"
          ? { status }
          : {}),
      },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { updatedAt: "desc" }],
    });
    return Response.json({ intents: rows });
  } catch {
    return Response.json({ error: "Could not load intents." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const raw = await req.json();
    const parsed = intentPostSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body.", issues: parsed.error.flatten() }, { status: 400 });
    }
    const b = parsed.data;

    const row = await prisma.shoppingIntent.create({
      data: {
        userId,
        intentName: b.intentName,
        description: b.description ?? null,
        category: b.category ?? null,
        subcategory: b.subcategory ?? null,
        recipientId: b.recipientId ?? null,
        constraints: (b.constraints ?? {}) as InputJsonValue,
        priority: b.priority ?? "medium",
        neededBy: b.neededBy ? new Date(b.neededBy) : null,
        confidence: 1,
        evidenceCount: 1,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    return Response.json({ intent: row });
  } catch {
    return Response.json({ error: "Could not create intent." }, { status: 500 });
  }
}
