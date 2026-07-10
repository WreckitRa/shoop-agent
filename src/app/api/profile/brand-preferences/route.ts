import { prisma } from "@/lib/ai-chat/db";
import { brandPreferencePostSchema } from "@/lib/ai-chat/profile/validators";
import { getAuthContext } from "@/lib/auth/session";

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const rows = await prisma.brandPreference.findMany({
      where: { userId: userId },
      orderBy: [{ sentiment: "asc" }, { strength: "desc" }],
    });
    return Response.json({ brandPreferences: rows });
  } catch {
    return Response.json({ error: "Could not load brand prefs." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = brandPreferencePostSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body." }, { status: 400 });
    }
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const b = parsed.data;
    const category = b.category ?? "";

    const row = await prisma.brandPreference.upsert({
      where: {
        userId_brand_category: { userId, brand: b.brand, category },
      },
      create: {
        userId,
        brand: b.brand,
        category,
        sentiment: b.sentiment,
        strength: b.strength ?? 0.6,
        reasons: b.reasons ?? [],
        ownsProducts: b.ownsProducts ?? false,
        aspirational: b.aspirational ?? false,
        confidence: 1,
        evidenceCount: 1,
      },
      update: {
        sentiment: b.sentiment,
        strength: b.strength ?? undefined,
        reasons: b.reasons ?? undefined,
        ownsProducts: b.ownsProducts ?? undefined,
        aspirational: b.aspirational ?? undefined,
        confidence: 1,
        evidenceCount: { increment: 1 },
      },
    });
    return Response.json({ brandPreference: row });
  } catch {
    return Response.json({ error: "Could not save brand pref." }, { status: 500 });
  }
}
