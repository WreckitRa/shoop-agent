import { prisma } from "@/lib/ai-chat/db";
import { hardNegativePostSchema } from "@/lib/ai-chat/profile/validators";
import { getAuthContext } from "@/lib/auth/session";

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const rows = await prisma.hardNegative.findMany({
      where: { userId: userId },
      orderBy: [{ scope: "asc" }, { value: "asc" }],
    });
    return Response.json({ hardNegatives: rows });
  } catch {
    return Response.json({ error: "Could not load hard rules." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = hardNegativePostSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body.", issues: parsed.error.flatten() }, { status: 400 });
    }
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const b = parsed.data;
    const category = b.category ?? "";

    const row = await prisma.hardNegative.upsert({
      where: {
        userId_scope_value_category: {
          userId,
          scope: b.scope,
          value: b.value,
          category,
        },
      },
      create: {
        userId,
        scope: b.scope,
        value: b.value,
        category,
        reason: b.reason ?? null,
        note: b.note ?? null,
      },
      update: {
        reason: b.reason ?? undefined,
        note: b.note ?? undefined,
      },
    });
    return Response.json({ hardNegative: row });
  } catch {
    return Response.json({ error: "Could not save hard rule." }, { status: 500 });
  }
}
