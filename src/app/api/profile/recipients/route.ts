import { prisma } from "@/lib/ai-chat/db";
import { recipientPostSchema } from "@/lib/ai-chat/profile/validators";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import { getAuthContext } from "@/lib/auth/session";

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const rows = await prisma.recipient.findMany({
      where: { userId: userId },
      orderBy: [{ updatedAt: "desc" }],
    });
    return Response.json({ recipients: rows });
  } catch {
    return Response.json({ error: "Could not load recipients." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const parsed = recipientPostSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid body.", issues: parsed.error.flatten() }, { status: 400 });
    }
    const auth = await getAuthContext();
    if (!auth.ok) return auth.response;
    const userId = auth.userId;
    const b = parsed.data;

    const row = await prisma.recipient.upsert({
      where: { userId_label: { userId, label: b.label.toLowerCase() } },
      create: {
        userId,
        label: b.label.toLowerCase(),
        name: b.name ?? null,
        relationship: b.relationship ?? null,
        ageRange: b.ageRange ?? null,
        birthDate: b.birthDate ? new Date(b.birthDate) : null,
        knownPreferences: b.knownPreferences ?? [],
        dislikes: b.dislikes ?? [],
        favoriteBrands: b.favoriteBrands ?? [],
        dislikedBrands: b.dislikedBrands ?? [],
        sizes: (b.sizes ?? {}) as InputJsonValue,
        importantDates: (b.importantDates ?? []) as InputJsonValue,
        giftHistory: (b.giftHistory ?? []) as InputJsonValue,
        privacyLevel: b.privacyLevel ?? "normal",
        confidence: 1,
        evidenceCount: 1,
      },
      update: {
        name: b.name ?? undefined,
        relationship: b.relationship ?? undefined,
        ageRange: b.ageRange ?? undefined,
        birthDate: b.birthDate ? new Date(b.birthDate) : undefined,
        knownPreferences: b.knownPreferences ?? undefined,
        dislikes: b.dislikes ?? undefined,
        favoriteBrands: b.favoriteBrands ?? undefined,
        dislikedBrands: b.dislikedBrands ?? undefined,
        sizes: b.sizes ? (b.sizes as InputJsonValue) : undefined,
        importantDates: b.importantDates
          ? (b.importantDates as InputJsonValue)
          : undefined,
        giftHistory: b.giftHistory ? (b.giftHistory as InputJsonValue) : undefined,
        privacyLevel: b.privacyLevel ?? undefined,
        confidence: 1,
        evidenceCount: { increment: 1 },
      },
    });

    return Response.json({ recipient: row });
  } catch {
    return Response.json({ error: "Could not save recipient." }, { status: 500 });
  }
}
